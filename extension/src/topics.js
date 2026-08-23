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
 * Rung 1 was written when the profile list rendered no chips at all (charter
 * §1). It renders them on SOME rows now — 9 of 77 on the account this was
 * re-measured against — which is why it is a FLOOR and not an answer: what
 * the page gave up for free is kept, and every repo it did not name still
 * climbs. A measurement is true on a date, not forever.
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

    const wanted = [];
    for (const name of names) {
      const hit = cache[name];
      if (hit && hit.at > freshAfter && Array.isArray(hit.topics)) found.set(name, hit);
      else wanted.push(name);
    }

    /* ── THE CEILING ────────────────────────────────────────────────────────
     * This loop is the highest-volume thing the extension does: one
     * authenticated same-origin fetch per repo, and until now it read however
     * many it was handed. There is a backoff for when GitHub says stop
     * (below), and there was nothing at all for "do not start" — so an
     * account the API cannot see was 400 requests that nobody chose, on a page
     * the reader opened to look at a list.
     *
     * The ceiling does not read less for its own sake. It makes reading a lot
     * a DECISION: read `scrapeMax`, say how many are left, and let the reader
     * ask for the rest (`deferred`, surfaced by view.js as `read N more`).
     * That is the same move the unread count already makes — a cost you can
     * see and answer instead of one that simply happens.
     *
     * THE CACHE IS WHAT MAKES *CONTINUE* CHEAP. Everything read on this pass
     * is written below, so asking for the rest re-reads none of it: a second
     * pass with the ceiling lifted fetches exactly the ones deferred here.
     *
     * A ceiling of 0 or less is read as "no ceiling", so a reader who wants
     * the old behaviour can have it, and `readAll` lifts it for one pass. */
    const max = settings.readAll ? 0 : Number(settings.scrapeMax) || 0;
    const todo = max > 0 ? wanted.slice(0, max) : wanted;
    const deferred = max > 0 ? wanted.length - todo.length : 0;

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
      /* NOT counted as unread. An unread repo is one we TRIED and failed to
       * read, and its cure is rescan; a deferred one was never attempted and
       * its cure is a button. Saying them in one number would put the blame
       * for a deliberate ceiling on GitHub. */
      deferred,
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

    /* ── RUNG 1 IS A FLOOR, NOT AN ANSWER FOR EVERYONE ──────────────────────
     * This used to read `if (answered() > 0) return` — one row carrying chips
     * ended the ladder for the whole collection. It was written when the
     * profile list rendered no chips at all, so the branch could only ever
     * fire when every row had them; GitHub started rendering them on SOME rows
     * and the same line became a short circuit.
     *
     * MEASURED on a real 77-repo account: 9 rows carried chips, so the run
     * returned `via page` for all 77 and left 68 in Ungrouped having asked
     * nobody about them — for zero requests, with `warning: ""`, reading
     * exactly like success.
     *
     * And it did not only cost grouping. The record it returns carries three
     * fields, so `find` lost descriptions, READMEs, languages and licences;
     * the audit's whole repositories half went to "not asked"; and the canary
     * cannot fire from here at all, because `health` is "" on this path and
     * `pageHealth` only ever sees pages rung 4 read. The run that would notice
     * GitHub moving the sidebar was the run that never happened.
     *
     * So the gate is now "everyone answered", and what the chips DID answer is
     * kept as a floor the rungs below only add to. */
    const fromChips = answered();
    const asked = names.filter(Boolean).length;
    if (asked > 0 && fromChips >= asked) {
      return { topics, facts, source: "page", warning: "", health: "" };
    }

    // Rungs 2 and 3 — the API, via the worker. One call answers everyone.
    let warning = "";
    /* EVERY RUNG THAT CONTRIBUTED, IN THE ORDER IT WAS CLIMBED. One name was
     * enough while a run could only ever be one rung. With chips as a floor a
     * single render is routinely two or three, and `via page` alone would now
     * hide the requests that actually answered most of the collection — which
     * is P.IV pointing the wrong way. The honest answer is a list. */
    const rungs = [];
    if (fromChips) rungs.push("page");

    let reply = await askWorker({
      type: "repos",
      user: S.owner(),
      token: mine ? (settings.token || "") : "",
    });

    if (mine && settings.token) {
      rungs.push("api (token)");
      /* A pasted token that has expired must be SAID, not silently ignored:
       * the user cannot otherwise tell an expired credential from an untagged
       * repository (P.IV). */
      if (!reply.ok && (reply.status === 401 || reply.status === 403)) {
        warning = "token rejected (" + reply.status + ")";
        /* ── THE FALLBACK IS A REQUEST, NOT A LABEL ──────────────────────────
         * This branch used to set the source line to `api (public)` and stop.
         * The public endpoint was never asked. So the sentence the whole
         * product stakes its trust on named a rung that had not run, and
         * because `byName` stayed empty EVERY repo fell through as missing:
         * one expired token turned a one-request page into a page that reads
         * every repository you own, one at a time.
         *
         * The public endpoint needs no credential and answers every public
         * repo in the same one call. Only what it genuinely cannot see — the
         * private ones — should reach rung 4. */
        reply = await askWorker({ type: "repos", user: S.owner(), token: "" });
        rungs[rungs.length - 1] = "api (public)";
        if (!reply.ok) warning += " · api unavailable";
      } else if (!reply.ok) {
        warning = "api unavailable";
      }
    } else {
      rungs.push("api (public)");
      if (!reply.ok) warning = "api unavailable";
    }

    const byName = new Map();
    (reply.repos || []).forEach((r) => byName.set(r.full_name, S.factsFromApi(r)));
    /* THE FLOOR HOLDS HERE OR IT HOLDS NOWHERE. This line used to be a plain
     * `byName.get(n) || { name: n, topics: [] }`, which overwrites a repo the
     * chips already answered with an empty record the moment the API cannot
     * see it — handing rung 4 a bill for repos that were answered for free.
     * The API wins when it answered, because it carries ten fields to the
     * chips' one; otherwise the chips stand. */
    const chips = facts;
    facts = names.map((n, i) =>
      byName.get(n) ||
      ((chips[i] && chips[i].topics || []).length ? chips[i] : { name: n, topics: [] }));
    topics = facts.map((f) => f.topics || []);

    // Rung 4 — whatever the API could not see. Private repos land here.
    let health = "";
    const missing = names.filter((n, i) => n && !topics[i].length && !byName.has(n));

    /* The whole cost of the ladder is here, and it is spent on the reader's
     * own session. It is not spent on anyone else's profile. */
    let deferred = 0;
    if (missing.length && !mine) {
      warning = warning || ("someone else's profile — free rungs only, " +
                            missing.length + " unread");
      return { topics, facts, source: rungs.join(" + ") + " · not yours",
               warning, health: "", deferred: 0 };
    }

    if (missing.length) {
      const r = await scrape(missing, settings, onProgress);
      const { found, fetched, seen, halted, unread } = r;
      deferred = r.deferred;
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
        rungs.push(fetched ? "repo pages" : "repo pages (cached)");
      }
    }

    /* `deferred` is not a warning. Nothing went wrong — a ceiling the reader
     * can lift is a choice offered, and view.js draws it as the button that
     * lifts it. Putting it in the amber sentence beside "token rejected" would
     * teach the reader to read a deliberate limit as a fault. */
    return { topics, facts, source: rungs.join(" + "), warning, health, deferred };
  };
})(globalThis.Shelves);
