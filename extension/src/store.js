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
  };

  const CACHE_KEY = "topicCache";

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
    return s;
  };

  S.saveSettings = (patch) => set("sync", patch);
  S.saveToken = (token) => set("local", { token: String(token || "").trim() });

  /* ---- topic cache: { "owner/name": { at: ms, topics: [] } } ------------ */

  S.cache = {
    async read() {
      const got = await get("local", { [CACHE_KEY]: {} });
      const c = got[CACHE_KEY];
      return c && typeof c === "object" ? c : {};
    },
    write(cache) {
      return set("local", { [CACHE_KEY]: cache });
    },
    clear() {
      return set("local", { [CACHE_KEY]: {} });
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
