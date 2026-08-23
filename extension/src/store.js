/* SHELVES — store.js
 *
 * Every piece of persisted state, and the only file that knows chrome.storage
 * exists. Three stores, deliberately different:
 *
 *   settings  chrome.storage.sync   follows the user between browsers
 *   token     chrome.storage.local  a credential must NEVER ride sync (P.II)
 *   cache     chrome.storage.local  derived, disposable, per-repo topics
 *
 * Nothing here throws. A store that cannot be read is an empty store, because
 * principle III says a missing input costs grouping and never the page.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  const DEFAULTS = {
    groups: [],            // ordered topic names; empty => auto-group
    otherLabel: "Ungrouped",
    startCollapsed: false,
    cacheDays: 7,
    concurrency: 6,        // repo-page fetches in flight
    fetchAllPages: true,
    maxPages: 10,
    /* OFF, AND IT HAS TO BE. Everything else here spends a request the reader
     * asked for by opening a page; the top-up spends requests on pages they
     * opened for another reason entirely. That is a different kind of cost and
     * it needs a different kind of consent (P.II), so it is opt-in and stays
     * opt-in even though it is the single biggest improvement to a cold run. */
    prewarm: false,
    warmBatch: 6,          // repo pages per visit, at concurrency 1
  };

  const CACHE_KEY = "topicCache";   // what the fact cache used to be called
  const FACTS_KEY = "repoFacts";
  const NOTES_KEY = "notes";
  const MAP_KEY = "shelfMap";
  const MAX_FACTS = 3000;   // far above any real account, far below the quota

  const api = () =>
    (typeof chrome !== "undefined" && chrome && chrome.storage) ? chrome.storage : null;

  function get(area, defaults) {
    const st = api();
    if (!st || !st[area]) return Promise.resolve({ ...defaults });
    return new Promise((resolve) => {
      try {
        st[area].get(defaults, (got) => {
          // chrome.runtime.lastError must be READ or Chrome logs it as unchecked.
          const err = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError;
          resolve(err ? { ...defaults } : { ...defaults, ...(got || {}) });
        });
      } catch (e) {
        resolve({ ...defaults });
      }
    });
  }

  function set(area, obj) {
    const st = api();
    if (!st || !st[area]) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        st[area].set(obj, () => {
          const err = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError;
          resolve(!err);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  S.DEFAULTS = DEFAULTS;

  /** Settings + token, merged into one object for the caller's convenience. */
  S.load = async function load() {
    const [sync, local] = await Promise.all([
      get("sync", DEFAULTS),
      get("local", { token: "" }),
    ]);
    const s = { ...sync, token: String(local.token || "").trim() };
    // Defend against a hand-edited or half-migrated store.
    if (!Array.isArray(s.groups)) s.groups = [];
    s.groups = s.groups.map((g) => String(g).trim()).filter(Boolean);
    s.cacheDays = Number(s.cacheDays) || DEFAULTS.cacheDays;
    s.concurrency = Math.max(1, Math.min(12, Number(s.concurrency) || DEFAULTS.concurrency));
    s.maxPages = Number(s.maxPages) || DEFAULTS.maxPages;
    s.prewarm = s.prewarm === true;      // anything but an explicit true is off
    s.warmBatch = Math.max(1, Math.min(20, Number(s.warmBatch) || DEFAULTS.warmBatch));
    return s;
  };

  S.saveSettings = (patch) => set("sync", patch);
  S.saveToken = (token) => set("local", { token: String(token || "").trim() });

  /* ---- the fact cache -------------------------------------------------- */
  /* { "owner/name": { at: ms, topics: [], description, language, stars, … } }
   *
   * This was `topicCache` and held one field. It is the same store with the
   * rest of what the repo page was already telling us kept instead of thrown
   * away, so the key changed with it — a cache whose name lies about what is
   * in it is how the next reader ends up re-fetching for facts it already has.
   *
   * A cache written by the old version is still VALID here: `{at, topics}` is
   * a fact record with nine absent fields, which is a shape every reader
   * already handles. So it is adopted rather than discarded, and nobody pays
   * seventy-six requests for an upgrade. */

  S.cache = {
    async read() {
      const got = await get("local", { [FACTS_KEY]: {}, [CACHE_KEY]: {} });
      const c = got[FACTS_KEY];
      if (c && typeof c === "object" && Object.keys(c).length) return c;
      const old = got[CACHE_KEY];
      return old && typeof old === "object" ? old : {};
    },
    /* IT NEVER FORGOT ANYTHING, AND THAT WAS THE BUG. There was no eviction
     * path in the whole extension: an entry written once lived forever, and
     * `warm.js` refreshes everything it finds — so a single visit to a
     * stranger's 300-repo profile left the reader's browser quietly
     * re-fetching somebody else's repositories for as long as the extension
     * was installed. The profile narrowing above stops those entries being
     * written; this stops the ones already there from being immortal.
     *
     * The floors are generous on purpose. Pruning at the TTL would fight the
     * top-up, which exists precisely to refresh things around it, so an entry
     * has to be untouched for four TTLs (and at least 90 days) before it goes.
     * The count cap is the backstop for the case age cannot catch: 3000 is far
     * above any real account and far below anything that would strain the
     * quota. Newest survive, because those are the ones being looked at. */
    write(cache, settings) {
      return set("local", { [FACTS_KEY]: S.cache.prune(cache, settings) });
    },
    prune(cache, settings, now) {
      const c = cache && typeof cache === "object" ? cache : {};
      const days = Math.max(90, (Number((settings || {}).cacheDays) || 7) * 4);
      const cut = (now || Date.now()) - days * 86400000;
      let rows = Object.keys(c)
        .map((k) => [k, (c[k] && c[k].at) || 0])
        .filter(([, at]) => at > cut)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_FACTS);
      const out = {};
      rows.forEach(([k]) => { out[k] = c[k]; });
      return out;
    },
    /* Rescan forgets what it can rebuild and NOTHING ELSE. The notes below are
     * the user's own words: no request re-derives them, so nothing here is
     * allowed to touch them (P.I's "reconstructible" is a claim about this
     * store, and notes are the one part of it that is not). */
    clear() {
      return set("local", { [FACTS_KEY]: {}, [CACHE_KEY]: {} });
    },
  };

  /* ---- notes: { "owner/name": "the user's own words" } ------------------ */
  /* A private margin on your own repositories, which GitHub offers nowhere.
   * chrome.storage.LOCAL, like the token and for a different reason: sync
   * caps an item at 8KB and a hundred notes would silently stop saving. */

  S.notes = {
    async read() {
      const got = await get("local", { [NOTES_KEY]: {} });
      const n = got[NOTES_KEY];
      return n && typeof n === "object" ? n : {};
    },
    write(notes) {
      return set("local", { [NOTES_KEY]: notes });
    },
    /** Empty text REMOVES the key — an empty note is not a note, and keeping
     *  it would make the note marker lie about which rows carry one. */
    async set(name, textIn) {
      const notes = await this.read();
      const t = String(textIn == null ? "" : textIn).trim().slice(0, 2000);
      if (t) notes[String(name || "").toLowerCase()] = t;
      else delete notes[String(name || "").toLowerCase()];
      const ok = await this.write(notes);
      return { ok, notes };
    },
  };

  /* ---- the shelf map: what the profile page worked out, left for the ----
   * ---- pages that cannot work it out for themselves ---------------------
   *
   * { "<owner>": { at, order: [labels], counts: {label: n}, names: [...] } }
   *
   * A repo's OWN page can see its topics but not its neighbours', and the
   * shelf a repo lands on — and, more sharply, the COLOUR that shelf wears —
   * are both properties of the whole collection. `identity()` resolves palette
   * collisions across every label at once, so a page that knows one label
   * cannot reproduce the answer; it can only guess a different one, and a mark
   * that disagrees with the shelves is worse than no mark.
   *
   * So the profile page writes down what it worked out and the repo page reads
   * it. Derived, disposable and rebuilt on every render, exactly like the fact
   * cache — losing it costs the chip its colour and nothing else.
   */

  S.shelfmap = {
    async read(owner) {
      const got = await get("local", { [MAP_KEY]: {} });
      const all = got[MAP_KEY];
      const m = all && typeof all === "object" ? all[String(owner || "").toLowerCase()] : null;
      return m && typeof m === "object" ? m : null;
    },
    async write(owner, map) {
      const got = await get("local", { [MAP_KEY]: {} });
      const all = (got[MAP_KEY] && typeof got[MAP_KEY] === "object") ? got[MAP_KEY] : {};
      all[String(owner || "").toLowerCase()] = { ...map, at: Date.now() };
      return set("local", { [MAP_KEY]: all });
    },
  };

  /* ---- which shelves are open: page-local, per profile ------------------ */

  S.collapse = {
    key(owner) {
      return "shelves:open:" + owner;
    },
    read(owner) {
      try {
        return JSON.parse(localStorage.getItem(this.key(owner)) || "{}") || {};
      } catch (e) {
        return {};
      }
    },
    write(owner, state) {
      try {
        localStorage.setItem(this.key(owner), JSON.stringify(state));
      } catch (e) {
        /* private mode, quota, disabled storage — a forgotten shelf is not a bug */
      }
    },
  };
})(globalThis.Shelves);
