/* SHELVES — warm.js
 *
 * NEVER PAY FOR A COLD RUN TWICE.
 *
 * A first visit with an empty cache is fifteen seconds of fetching before the
 * page is usable — seventy-six repo pages at concurrency six — and the cache
 * expires, so it comes back every week. That cost is unavoidable the first
 * time and completely avoidable every time after, because the reader is on
 * github.com for other reasons all day long and the cache could have been
 * topped up quietly while they were.
 *
 * ── WHERE THIS RUNS, AND WHY IT IS NOT THE SERVICE WORKER ─────────────────
 * It was designed as a worker plus the `alarms` permission, which is the
 * obvious shape and the wrong one. The worker cannot ride the session cookie
 * the way a same-origin fetch from the page does, so it could only ever have
 * warmed what api.github.com answers — which is exactly the half that does NOT
 * need warming, since one API call answers every public repo at once. The
 * expensive half is the private repos, and the only thing that can read those
 * is a same-origin fetch from a github.com page.
 *
 * So the top-up lives in the page. That is principle VII arriving at the same
 * answer it always does, and it drops a permission rather than adding one: no
 * `alarms`, no new host access, nothing in the manifest at all.
 *
 * ── THE GUARDS, WHICH ARE THE ACTUAL FEATURE ──────────────────────────────
 * Everything else in this extension spends a request on a page the reader
 * opened to see the result. This spends requests on pages they opened for
 * something else, which is a different kind of cost and needs a different kind
 * of consent — so:
 *
 *   OFF by default, opt-in in options, and it stays that way (P.II).
 *   NEVER on the profile tab. The foreground run owns that page; two writers
 *     on one cache is a race with no upside, and the ladder is already doing
 *     this work there, better.
 *   ONLY repos already in the cache. It refreshes what it has seen; it never
 *     discovers. A first run is still cold — the point is that the second
 *     week never is.
 *   ONE at a time, with a gap. Concurrency six is right when a reader is
 *     waiting and rude when nobody is.
 *   A SMALL BUDGET per visit (`warmBatch`, default 6).
 *   ONLY WHEN VISIBLE. A background tab is not a reader; it is a tab someone
 *     forgot, and it should not be issuing requests for an hour.
 *   STOP DEAD on the first non-ok response. A 429 means back off, and a
 *     background job that retries into a rate limit is how a quiet feature
 *     gets an account throttled for the foreground one.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  const GAP_MS = 900;          // between fetches: nobody is waiting
  const START_MS = 3000;       // after load: never compete with the page itself

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const visible = () =>
    typeof document === "undefined" || document.visibilityState !== "hidden";

  /**
   * @returns {{warmed: number, why: string}} — `why` names the reason it did
   *          nothing, because a silent background job that has quietly stopped
   *          working is indistinguishable from one that is up to date (P.IV).
   */
  S.warm = async function warm(settings, opts) {
    const o = opts || {};
    const now = o.now || Date.now();

    if (!settings.prewarm) return { warmed: 0, why: "off" };
    if (S.isRepoTab()) return { warmed: 0, why: "the profile tab warms itself" };
    if (!visible()) return { warmed: 0, why: "tab not visible" };

    const cache = await S.cache.read();
    const names = Object.keys(cache);
    if (!names.length) return { warmed: 0, why: "nothing cached to refresh yet" };

    /* HALFWAY THROUGH THE TTL, not at the end of it. Refreshing on expiry means
     * the reader still meets a cold entry every time they arrive first; topping
     * up from the midpoint means the entry is almost always replaced before
     * anyone waits on it, which is the entire point of doing this at all. */
    const ttl = settings.cacheDays * 86400000;
    const due = names
      .filter((n) => {
        const at = cache[n] && cache[n].at;
        return !at || now - at > ttl / 2;
      })
      /* Stalest first, so a budget of six spent over many visits still covers
       * the whole cache instead of circling the same six names. */
      .sort((a, b) => ((cache[a] || {}).at || 0) - ((cache[b] || {}).at || 0))
      .slice(0, settings.warmBatch);

    if (!due.length) return { warmed: 0, why: "cache is fresh" };

    let warmed = 0;
    let why = "";
    for (const name of due) {
      if (!visible()) { why = "tab hidden partway"; break; }
      try {
        const res = await fetch("/" + name, { credentials: "same-origin" });
        if (!res.ok) {
          /* One refusal ends the visit. A background job that keeps knocking
             through a 429 is how a convenience gets the foreground throttled. */
          why = "stopped on HTTP " + res.status;
          break;
        }
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");
        const facts = S.factsFrom(doc, name);
        facts.at = Date.now();
        delete facts.saw;          // a parse's evidence is not a repo's fact
        cache[name] = facts;
        warmed++;
      } catch (e) {
        why = "stopped on a network error";
        break;
      }
      await sleep(o.gap == null ? GAP_MS : o.gap);
    }

    if (warmed) await S.cache.write(cache, settings);
    return { warmed, why: why || "topped up " + warmed + " of " + due.length };
  };

  /** Kicked from main.js on any github.com page that is not the profile tab. */
  S.warmLater = function warmLater(delay) {
    setTimeout(async () => {
      try {
        const settings = await S.load();
        const out = await S.warm(settings);
        if (out.warmed) console.debug("[shelves] warmed", out.warmed, "repos");
      } catch (e) {
        /* A top-up that fails costs a later run its warm cache and nothing
         * else. It must never be visible on a page the reader opened for
         * something completely different. */
      }
    }, delay == null ? START_MS : delay);
  };
})(globalThis.Shelves);
