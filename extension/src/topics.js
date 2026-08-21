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

    const todo = [];
    for (const name of names) {
      const hit = cache[name];
      if (hit && hit.at > freshAfter && Array.isArray(hit.topics)) found.set(name, hit.topics);
      else todo.push(name);
    }

    let done = 0;
    if (onProgress) onProgress(0, todo.length);

    await pool(todo, settings.concurrency, async (name) => {
      try {
        const res = await fetch("/" + name, { credentials: "same-origin" });
        if (res.ok) {
          const doc = new DOMParser().parseFromString(await res.text(), "text/html");
          // Scope to the sidebar so a README full of /topics/ links cannot lie.
          const scope =
            doc.querySelector('.Layout-sidebar, [data-testid="repository-sidebar"]') || doc;
          const topics = S.topicsIn(scope);
          found.set(name, topics);
          cache[name] = { at: Date.now(), topics };
        }
      } catch (e) {
        /* one unreachable repo must not sink the page (P.III) */
      }
      done++;
      if (onProgress) onProgress(done, todo.length);
    });

    // Pay once, remember it (P.VIII).
    if (todo.length) await S.cache.write(cache);
    return { found, fetched: todo.length };
  }

  /**
   * @returns {{topics: string[][], source: string, warning: string}}
   *          topics is parallel to `rows`.
   */
  S.resolve = async function resolve(rows, names, settings, onProgress) {
    let topics = rows.map((li) => S.topicsIn(li));
    const answered = () => topics.filter((t) => t.length).length;

    // Rung 1 — the page itself.
    if (answered() > 0) {
      return { topics, source: "page", warning: "" };
    }

    // Rungs 2 and 3 — the API, via the worker. One call answers everyone.
    let warning = "";
    let source = "";
    const reply = await askWorker({
      type: "repos",
      user: S.owner(),
      token: settings.token || "",
    });

    const byName = new Map();
    (reply.repos || []).forEach((r) => byName.set(r.full_name, r.topics || []));
    topics = names.map((n) => byName.get(n) || []);

    if (settings.token) {
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
    const missing = names.filter((n, i) => n && !topics[i].length && !byName.has(n));
    if (missing.length) {
      const { found, fetched } = await scrape(missing, settings, onProgress);
      if (found.size) {
        topics = names.map((n, i) => (topics[i].length ? topics[i] : found.get(n) || []));
        // Name the cache explicitly: "repo pages" when nothing was fetched
        // would leave the user unable to tell a warm run from a cold one (P.IV).
        const rung = fetched ? "repo pages" : "repo pages (cached)";
        source = source.startsWith("api (token)") ? "token + " + rung : rung;
      }
    }

    return { topics, source, warning };
  };
})(globalThis.Shelves);
