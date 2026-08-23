/* SHELVES — topics.js
 *
 * THE LADDER. Answers "which topics does each of these repositories have",
 * climbing from free to expensive and stopping the moment everything is
 * answered:
 *
 *   1. chips already in the page          free
 *   2. api.github.com WITH a token        1-2 requests, sees private
 *   3. api.github.com without one         1-2 requests, public only
 *   4. each remaining repo's own page     1 request each, sees private
 *
 * Rung 1 yields nothing today (charter §1: the profile list renders no topic
 * chips) but costs nothing and becomes the whole answer for free if GitHub
 * ever restores them.
 *
 * Rung 4 is what makes SHELVES correct with NO configuration: the private
 * repos a token would have covered are read from their own pages instead,
 * using the session the user already has.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  /* Cross-origin work belongs to the service worker (P.VII): from here an
   * Authorization header would meet CORS preflight and the page's CSP. */
  function askWorker(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (reply) => {
          const err = chrome.runtime && chrome.runtime.lastError;
          resolve(err || !reply ? { ok: false, status: 0, repos: [] } : reply);
        });
      } catch (e) {
        resolve({ ok: false, status: 0, repos: [] });
      }
    });
  }

  /** Bounded concurrency over a shared iterator: N workers pulling one list. */
  async function pool(items, width, fn) {
    const it = items[Symbol.iterator]();
    const workers = Array.from({ length: Math.max(1, Math.min(width, items.length)) }, async () => {
      for (const item of it) await fn(item);
    });
    await Promise.all(workers);
  }

  /* MEASURED (charter §7): a repo's OWN page carries its topics in the
   * sidebar, and a same-origin fetch here rides the user's session cookie —
   * the only route to a private repo's topics without a credential. */
  async function scrape(names, settings, onProgress) {
    const found = new Map();
    const cache = await S.cache.read();
    const freshAfter = Date.now() - settings.cacheDays * 86400000;
    /* Tallied over the pages actually READ this run, never over the cached
     * ones. A warm cache would otherwise vote on the shape of markup nobody
     * fetched today, and the canary would keep repeating last week's verdict
     * long after the page it was about had changed again. */
    const seen = { pages: 0, meta: 0, sidebar: 0, counter: 0, time: 0 };

    const todo = [];
    for (const name of names) {
      const hit = cache[name];
      if (hit && hit.at > freshAfter && Array.isArray(hit.topics)) found.set(name, hit);
      else todo.push(name);
    }

    let done = 0;
    let read = 0;
    let halted = 0;          // the status GitHub stopped us with, if any
    if (onProgress) onProgress(0, todo.length);

    await pool(todo, settings.concurrency, async (name) => {
      /* STOP WHEN GITHUB SAYS STOP. Measured against a server answering 429 to
       * everything: this loop issued all forty requests anyway, and showed the
       * reader a page of Ungrouped repos with no explanation at all. It is the
       * highest-volume path in the extension — hundreds of authenticated
       * same-origin fetches — and it was the only one with no backoff, while
       * warm.js, which makes six, had one. That asymmetry is how a convenience
       * gets somebody rate-limited on their own account. */
      if (halted) return;
      try {
        const res = await fetch("/" + name, { credentials: "same-origin" });
        if (res.status === 429 || res.status === 403) {
          halted = res.status;
          return;
        }
        if (res.ok) {
          read++;
          const doc = new DOMParser().parseFromString(await res.text(), "text/html");
          /* ONE PARSE, TEN FACTS (facts.js). Topics are still scoped to the
           * sidebar in there, so a README full of /topics/ links cannot lie;
           * everything else this page was already telling us is now kept
           * instead of dropped, for exactly the same one request. */
          const facts = S.factsFrom(doc, name);
          facts.at = Date.now();
          /* The canary counts the ANCHORS this parse could find, then the
           * evidence is dropped: `saw` is a fact about the parse, not about
           * the repository, and caching it would mean a page read in March
           * still voting on whether the markup is intact in August. */
          seen.pages++;
          Object.keys(seen).forEach((k) => {
            if (k !== "pages" && facts.saw && facts.saw[k]) seen[k]++;
          });
          delete facts.saw;
          found.set(name, facts);
          cache[name] = facts;
        }
      } catch (e) {
        /* one unreachable repo must not sink the page (P.III) */
      }
      done++;
      if (onProgress) onProgress(done, todo.length);
    });

    // Pay once, remember it (P.VIII).
    if (read) await S.cache.write(cache, settings);
    return {
      found, fetched: todo.length, seen, halted,
      unread: todo.length - read,
    };
  }

  /**
   * @returns {{topics: string[][], facts: object[], source: string,
   *            warning: string, health: string}}
   *          both arrays are parallel to `rows`; a facts entry is never null,
   *          only empty, so no caller needs a guard for the difference.
   *          `health` is the canary's sentence, or "" when nothing is wrong
   *          and when too few pages were read to have an opinion.
   */
  S.resolve = async function resolve(rows, names, settings, onProgress) {
    let topics = rows.map((li) => S.topicsIn(li));
    let facts = names.map((n, i) => ({ name: n, topics: topics[i], via: "page-chips" }));
    const answered = () => topics.filter((t) => t.length).length;

    /* ── WHOSE PROFILE IS THIS ──────────────────────────────────────────────
     * On somebody else's Repositories tab the two expensive rungs are not just
     * costly, they are WRONG:
     *
     *   the token answers `/user/repos` — the reader's OWN repositories, which
     *     tell you nothing about the page you are standing on, and send a
     *     credential to a request that cannot use it;
     *   rung 4 fetches every one of a stranger's repo pages with the reader's
     *     session cookie and caches them permanently, so one click on a link
     *     costs hundreds of authenticated requests and a cache the background
     *     top-up then refreshes forever.
     *
     * So a stranger's profile gets the FREE rungs only: page chips, plus the
     * public API for their username. That is one or two requests, no
     * credential, no scraping and no cache write — and it still shelves the
     * page, which is why this is a narrowing rather than a refusal. */
    const mine = S.isMine();

    // Rung 1 — the page itself.
    if (answered() > 0) {
      return { topics, facts, source: "page", warning: "", health: "" };
    }

    // Rungs 2 and 3 — the API, via the worker. One call answers everyone.
    let warning = "";
    let source = "";
    const reply = await askWorker({
      type: "repos",
      user: S.owner(),
      token: mine ? (settings.token || "") : "",
    });

    const byName = new Map();
    (reply.repos || []).forEach((r) => byName.set(r.full_name, S.factsFromApi(r)));
    facts = names.map((n, i) => byName.get(n) || { name: n, topics: [] });
    topics = facts.map((f) => f.topics || []);

    if (mine && settings.token) {
      source = "api (token)";
      /* A pasted token that has expired must be SAID, not silently ignored:
       * the user cannot otherwise tell an expired credential from an untagged
       * repository (P.IV). */
      if (!reply.ok && (reply.status === 401 || reply.status === 403)) {
        warning = "token rejected (" + reply.status + ")";
        source = "api (public)";
      } else if (!reply.ok) {
        warning = "api unavailable";
      }
    } else {
      source = "api (public)";
      if (!reply.ok) warning = "api unavailable";
    }

    // Rung 4 — whatever the API could not see. Private repos land here.
    let health = "";
    const missing = names.filter((n, i) => n && !topics[i].length && !byName.has(n));

    /* The whole cost of the ladder is here, and it is spent on the reader's
     * own session. It is not spent on anyone else's profile. */
    if (missing.length && !mine) {
      warning = warning || ("someone else's profile — free rungs only, " +
                            missing.length + " unread");
      return { topics, facts, source: source + " · not yours", warning, health: "" };
    }

    if (missing.length) {
      const { found, fetched, seen, halted, unread } =
        await scrape(missing, settings, onProgress);
      health = S.pageHealth(seen);
      /* P.IV — an unread repo is Ungrouped for a REASON, and the reader
       * cannot tell that from an untagged one by looking. */
      if (halted) {
        warning = "GitHub asked us to slow down (" + halted + ") — " + unread +
                  " unread; try rescan in a few minutes";
      } else if (unread) {
        warning = warning || (unread + " unread — press rescan to try again");
      }
      if (found.size) {
        facts = names.map((n, i) => (topics[i].length ? facts[i] : found.get(n) || facts[i]));
        topics = facts.map((f) => (f && f.topics) || []);
        // Name the cache explicitly: "repo pages" when nothing was fetched
        // would leave the user unable to tell a warm run from a cold one (P.IV).
        const rung = fetched ? "repo pages" : "repo pages (cached)";
        source = source.startsWith("api (token)") ? "token + " + rung : rung;
      }
    }

    return { topics, facts, source, warning, health };
  };
})(globalThis.Shelves);
