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

  /* ── A RATE LIMIT IS A TIME, NOT A FAULT ──────────────────────────────────
   * When the worker says `rateLimited`, nothing is broken: the token is fine,
   * the network is fine, GitHub has simply counted to its ceiling for this
   * hour. The one thing the reader can usefully be told is WHEN it comes back
   * (P.IV) — so the sentence carries the reset as a local 24-hour clock, and
   * says "later" rather than inventing a time when GitHub did not give one.
   * HH:MM without a date is deliberate: a reset is at most an hour away (a
   * Retry-After somewhat more), never far enough to need a day named. */
  function rateSentence(resetAt) {
    const at = typeof resetAt === "number" && isFinite(resetAt) && resetAt > 0
      ? new Date(resetAt) : null;
    if (!at || isNaN(at.getTime())) return "GitHub rate limit — retry later";
    const two = (n) => String(n).padStart(2, "0");
    return "GitHub rate limit — retry after " + two(at.getHours()) + ":" + two(at.getMinutes());
  }

  /** Bounded concurrency over a shared iterator: N workers pulling one list. */
  async function pool(items, width, fn) {
    const it = items[Symbol.iterator]();
    const workers = Array.from({ length: Math.max(1, Math.min(width, items.length)) }, async () => {
      for (const item of it) await fn(item);
    });
    await Promise.all(workers);
  }

  /* HOW MANY FRESH RECORDS A COLD PASS MAY HOLD UNWRITTEN. Ten is about two
   * seconds of reading at concurrency six, and one storage write per ten repo
   * pages is noise beside the ten requests that earned it. */
  const FLUSH_EVERY = 10;

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
     * is written as it is read, so asking for the rest re-reads none of it: a second
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

    /* ── PAY ONCE MEANS WRITE AS YOU GO ─────────────────────────────────────
     * The pass used to write its cache once, after the LAST fetch landed.
     * `S.session` is memory only, so a reader who closed the tab, or left it
     * in the background long enough to be discarded, twenty fetches into a
     * hundred lost all twenty — and the next visit paid for them again.
     * P.VIII held only for a pass that ran to the end, which is exactly the
     * pass a slow cold run is least likely to be.
     *
     * So the records are flushed every FLUSH_EVERY reads, and once more the
     * moment the page is going away: `visibilitychange` to hidden is the last
     * event a tab reliably gets before it is frozen or discarded, `pagehide`
     * covers a close or a full navigation, and `freeze` is Chrome saying so
     * outright. And once the tab IS hidden every read is written as it lands,
     * because the discard that follows sends nothing to flush on.
     *
     * PERIODIC WRITES ARE CHAINED, NEVER CONCURRENT. Each one writes the whole
     * object, so two in flight could land out of order and the older snapshot
     * would win. `unsaved` counts reads not yet handed to a write, so a flush
     * with nothing new is free, and a write that FAILS hands its count back
     * so the next flush retries it rather than believing it landed.
     *
     * THE LAST-CHANCE WRITE DOES NOT QUEUE. Chained behind a write still in
     * flight, it would wait for a storage callback — a task, and a frozen or
     * unloading page runs no more tasks — so the records it exists to save
     * would die in the queue. It is issued from inside the handler instead.
     * Every snapshot is a superset of the one before it, so the worst a
     * reordering can do is let the previous snapshot land second, which costs
     * the records since then and never anything older.
     *
     * A CLEARED CACHE STAYS CLEARED. `rescan` here, or Clear in the options
     * page, empties the store while this pass still holds the old records in
     * memory; the next flush would have written them all back and the reload
     * would have found the cache it was told to forget. So the pass stops —
     * no more writes, no more fetches — the moment the epoch moves (same tab)
     * or the store is seen emptied (another context). */
    let unsaved = 0;
    let writing = Promise.resolve();
    const born = S.cache.epoch();
    let forgotten = false;
    const gone = () => forgotten || (forgotten = S.cache.epoch() !== born);
    /* ONLY WHAT THIS PASS LEARNED GOES OUT. Handing over the whole in-memory
     * copy — read when the pass began, minutes ago — is what let a cold pass
     * erase every record the top-up wrote from another tab meanwhile, and the
     * top-up erase the pass's. `fresh` holds the records read since the last
     * write that landed; `put` merges them into the store as it is NOW. */
    let fresh = {};
    const write = (now) => {
      const batch = fresh;
      fresh = {};
      unsaved = 0;
      const back = () => {
        if (gone()) return;
        Object.keys(batch).forEach((k) => { if (!fresh[k]) fresh[k] = batch[k]; });
        unsaved = Object.keys(fresh).length;
      };
      /* CALLED, NOT SCHEDULED: the storage call leaves inside this very
       * tick, which is what lets a leaving handler issue it before the page
       * freezes. */
      let p;
      try {
        p = Promise.resolve(now ? S.cache.putNow(batch, settings)
                                : S.cache.put(batch, settings));
      } catch (e) {
        p = Promise.reject(e);
      }
      return p.then((ok) => { if (ok === false) back(); }, back);
    };
    const flush = () => {
      if (!unsaved || gone()) return writing;
      writing = writing.then(() => (unsaved && !gone() ? write() : undefined));
      return writing;
    };
    const leaving = (e) => {
      if (e && e.type === "visibilitychange" && document.visibilityState !== "hidden") return;
      if (!unsaved || gone()) return;
      writing = write(true);
    };
    const emptied = (changes, area) => {
      const c = area === "local" && changes && changes.repoFacts;
      if (c && !(c.newValue && Object.keys(c.newValue).length)) forgotten = true;
    };
    const LEAVE = ["visibilitychange", "freeze"];   // on document; pagehide is on window
    const on = typeof document !== "undefined" && document.addEventListener;
    const watch = (add) => {
      const m = add ? "addEventListener" : "removeEventListener";
      if (on) LEAVE.forEach((t) => document[m](t, leaving));
      if (on && typeof window !== "undefined") window[m]("pagehide", leaving);
      try {
        const ev = chrome.storage.onChanged;
        add ? ev.addListener(emptied) : ev.removeListener(emptied);
      } catch (e) {
        /* no chrome.storage — the same-tab epoch still guards rescan */
      }
    };
    watch(true);

    try {
      await pool(todo, settings.concurrency, async (name) => {
        /* STOP WHEN GITHUB SAYS STOP. Measured against a server answering 429 to
         * everything: this loop issued all forty requests anyway, and showed the
         * reader a page of Ungrouped repos with no explanation at all. It is the
         * highest-volume path in the extension — hundreds of authenticated
         * same-origin fetches — and it was the only one with no backoff, while
         * warm.js, which makes six, had one. That asymmetry is how a convenience
         * gets somebody rate-limited on their own account. */
        if (halted || gone()) return;
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
          fresh[name] = facts;
            /* HIDDEN, EVERY READ IS THE LAST ONE. A background tab is the only
           * kind Chrome discards, and a discard sends no event at all — so
           * the batch of ten that is right for a tab someone is watching is
           * up to nine records thrown away for one nobody is. */
          const behind = typeof document !== "undefined" &&
                         document.visibilityState === "hidden";
          if (++unsaved >= (behind ? 1 : FLUSH_EVERY)) flush();
          }
        } catch (e) {
          /* one unreachable repo must not sink the page (P.III) */
        }
        done++;
        if (onProgress) onProgress(done, todo.length);
      });

    } finally {
      /* Even if the pool threw: a `leaving` left attached would write this
       * pass's stale snapshot on every tab switch for the life of the page. */
      watch(false);
    }

    // Pay once, remember it (P.VIII) — whatever the last flush did not cover.
    await flush();
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
  /* ── WHAT THIS VISIT HAS ALREADY READ ───────────────────────────────────
   * GitHub's Type and Language menus do not navigate. They fetch, and then
   * REPLACE the children of `#user-repositories-list` — measured: our host is
   * removed, a new `<ul>` with new `<li>` elements arrives, every `data-sh-*`
   * on every row is gone, and no `turbo:*` event fires at all, so the
   * MutationObserver is the only thing that notices. We cannot keep the rows:
   * they are genuinely different elements.
   *
   * What survives is the JAVASCRIPT CONTEXT — measured, a marker set on
   * `window` before the filter was still there after it. So the one thing
   * worth keeping is the answer: a repo whose facts this visit has already
   * paid for must never be paid for twice because the reader touched a
   * dropdown. Signed out that is one API call saved; on an account whose
   * private repos reach rung 4 it is one authenticated page read per repo,
   * every time a menu is touched.
   *
   * A Map and not a store: it dies with the page, so it can never serve
   * yesterday's topics, and `rescan` — which reloads — is unaffected by it. */
  S.session = new Map();

  S.resolve = async function resolve(rows, names, settings, onProgress) {
    let topics = rows.map((li) => S.topicsIn(li));
    let facts = names.map((n, i) => ({ name: n, topics: topics[i], via: "page-chips" }));

    /* The memo outranks a chip for the same reason the API does: it carries
     * ten fields where a chip carries one. It never overrides a repo the page
     * itself answered with MORE topics — it cannot, they are the same repo. */
    let remembered = 0;
    names.forEach((n, i) => {
      const seen = n && S.session.get(n);
      if (!seen) return;
      /* A chip the page is showing now beats a remembered empty: the reader
       * may have tagged the repo in another tab since. */
      if (!(topics[i] || []).length) topics[i] = seen.topics || [];
      facts[i] = seen;
      remembered++;
    });

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
    /* EVERY REPO ANSWERED means no rung below has anything to do — whether the
     * page answered them or this visit already had. */
    if (asked > 0 && (fromChips >= asked || remembered >= asked)) {
      return {
        topics, facts, warning: "", health: "", deferred: 0,
        source: remembered >= asked && remembered
          ? (fromChips > remembered ? "page + already read" : "already read")
          : "page",
      };
    }

    // Rungs 2 and 3 — the API, via the worker. One call answers everyone.
    let warning = "";
    /* EVERY RUNG THAT CONTRIBUTED, IN THE ORDER IT WAS CLIMBED. One name was
     * enough while a run could only ever be one rung. With chips as a floor a
     * single render is routinely two or three, and `via page` alone would now
     * hide the requests that actually answered most of the collection — which
     * is P.IV pointing the wrong way. The honest answer is a list. */
    const rungs = [];
    if (fromChips > remembered) rungs.push("page");
    if (remembered) rungs.push("already read");

    let reply = await askWorker({
      type: "repos",
      user: S.owner(),
      token: mine ? (settings.token || "") : "",
    });

    if (mine && settings.token) {
      rungs.push("api (token)");
      /* A pasted token that has expired must be SAID, not silently ignored:
       * the user cannot otherwise tell an expired credential from an untagged
       * repository (P.IV).
       *
       * ── BUT A 403 IS NOT ALWAYS THE TOKEN ─────────────────────────────────
       * This branch used to read every 401 AND every 403 as "token rejected".
       * GitHub says bad credentials with 401. It says RATE LIMIT with 403 (or
       * 429) plus `x-ratelimit-remaining: 0` / `retry-after` — so an hour of
       * heavy browsing was blamed on a perfectly good token, and the reader
       * was told to replace a credential that had nothing wrong with it.
       *
       * The worker reads those headers and says `rateLimited` (with the reset
       * as `resetAt`); a 403 WITHOUT them is still a refusal — a fine-grained
       * token that was never given this account's repos — and still says
       * "token rejected (403)".
       *
       * ── AND A RATE LIMIT GETS NO SECOND REQUEST ───────────────────────────
       * The public retry below is right for a rejected token: a different
       * door, a different credential, a real chance. On a rate limit it buys
       * nothing. The unauthenticated quota is SMALLER (60/hr per IP against
       * 5,000), it is already the one most likely spent, and the toolbar used
       * to read "token rejected (403) · api unavailable" — two clauses, both
       * wrong, for a request that could not succeed. So it is skipped, the
       * rung keeps its true name `api (token)`, and rung 4 — same-origin repo
       * pages, a different quota altogether — reads what is missing. */
      if (!reply.ok && reply.rateLimited) {
        warning = rateSentence(reply.resetAt);
      } else if (!reply.ok && (reply.status === 401 || reply.status === 403)) {
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
        /* The public door can be spent even when the token was simply wrong,
         * and then it is the reset time the reader needs, not "unavailable". */
        if (!reply.ok) {
          warning += " · " + (reply.rateLimited ? rateSentence(reply.resetAt) : "api unavailable");
        }
      } else if (!reply.ok) {
        warning = "api unavailable";
      }
    } else {
      rungs.push("api (public)");
      if (!reply.ok) {
        warning = reply.rateLimited ? rateSentence(reply.resetAt) : "api unavailable";
      }
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
      /* SIGNED OUT IS SAID AS SIGNED OUT. It may well be the reader's own
       * profile, and "someone else's" would be a guess presented as a fact;
       * the remedy is different too — sign in, not go home (P.IV). */
      const out = S.signedIn() === false;
      warning = warning || ((out ? "signed out" : "someone else's profile") +
                            " — free rungs only, " + missing.length + " unread");
      return { topics, facts,
               source: rungs.join(" + ") + (out ? " · signed out" : " · not yours"),
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
    /* Remembered for the rest of this visit, so a dropdown cannot make the page
     * pay for the same repositories again.
     *
     * KEYED ON WHETHER A RUNG ANSWERED, NOT ON WHETHER IT FOUND ANYTHING.
     * "this repo genuinely has no topics" is an answer and it is the commonest
     * one — the same fact `ladder-floor` leans on when the API settles an
     * untagged repo for free. Remembering only the tagged ones left every
     * untagged repo forcing the whole ladder to climb again on the next
     * dropdown, which on a 68-untagged account is the entire cost.
     *
     * `via: "page-chips"` is NOT an answer: it is the absence of a chip, which
     * is exactly what rung 1 is forbidden to treat as one. And a repo rung 4
     * could not read has no `via` at all, so it is retried rather than
     * remembered as empty. */
    names.forEach((n, i) => {
      const f = facts[i];
      if (n && f && f.via && f.via !== "page-chips") S.session.set(n, f);
    });

    return { topics, facts, source: rungs.join(" + "), warning, health, deferred };
  };
})(globalThis.Shelves);
