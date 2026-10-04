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
    /* THE CEILING ON THE HIGHEST-VOLUME PATH. Rung 4 reads one page per repo
     * and, until this existed, read as many as it was handed — so an account
     * the API cannot see is 400 authenticated fetches nobody chose. The point
     * is not to read less; it is to make reading a lot a DECISION. Above this
     * many, the run reads this many, says how many are left, and offers to
     * read the rest (view.js's `read N more`).
     *
     * 100 because it is far above what a normal account ever reaches through
     * rung 4 — the API answers every public repo in one request, so what
     * reaches here is usually just the private tail — and far below the
     * number at which a page load becomes a network event. */
    scrapeMax: 100,
  };

  const CACHE_KEY = "topicCache";   // what the fact cache used to be called
  const FACTS_KEY = "repoFacts";
  const NOTES_KEY = "notes";
  const MAP_KEY = "shelfMap";
  const OVER_KEY = "overrides";
  const PIN_KEY = "pins";
  const MAX_FACTS = 3000;   // far above any real account, far below the quota
  const MAX_THEIRS = 5;     // profiles that are not the reader's, kept at once

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

  /* ---- the write that can say WHY it failed ------------------------------
   * `set` answered a boolean, and a boolean is enough for every content-script
   * writer here: a lost cache write costs a refetch, and there is nobody
   * looking at the page to tell. THE OPTIONS PAGE IS THE ONE WRITER WITH A
   * READER IN FRONT OF IT, and the thing it writes — the shelf list — is the
   * only setting typed by hand. chrome.storage.sync refuses writes for
   * reasons the reader can act on (an item over 8,192 bytes, more than 120
   * writes a minute), so "it failed" is not enough; it has to be "it failed,
   * and this is what to change". `issue` keeps the lastError message, `write`
   * hands it over, and `set` is `write` reduced back to the boolean every
   * existing caller expects — resolved in the SAME callback tick as before,
   * so no caller's timing moves. */
  function issue(area, obj, done) {
    const st = api();
    if (!st || !st[area]) {
      done({ ok: false, error: "chrome.storage." + area + " is not available here" });
      return;
    }
    try {
      st[area].set(obj, () => {
        // chrome.runtime.lastError must be READ or Chrome logs it as unchecked.
        const err = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError;
        if (err) done({ ok: false, error: String((err && err.message) || err) });
        else done({ ok: true, error: null });
      });
    } catch (e) {
      done({ ok: false, error: String((e && e.message) || e) });
    }
  }

  function write(area, obj) {
    return new Promise((resolve) => issue(area, obj, resolve));
  }

  function set(area, obj) {
    return new Promise((resolve) => issue(area, obj, (r) => resolve(r.ok)));
  }

  /* `get`, but with the failure kept instead of folded into defaults. Folding
   * is right for a content script (P.III: a missing input costs grouping,
   * never the page) and WRONG for the options page: defaults shown in place
   * of an unreadable store are exactly what a Save would then write over the
   * reader's real settings. */
  function read(area, defaults) {
    const st = api();
    if (!st || !st[area]) {
      return Promise.resolve({ ok: false, value: { ...defaults },
                               error: "chrome.storage." + area + " is not available here" });
    }
    return new Promise((resolve) => {
      try {
        st[area].get(defaults, (got) => {
          const err = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError;
          if (err) resolve({ ok: false, value: { ...defaults }, error: String((err && err.message) || err) });
          else resolve({ ok: true, value: { ...defaults, ...(got || {}) }, error: null });
        });
      } catch (e) {
        resolve({ ok: false, value: { ...defaults }, error: String((e && e.message) || e) });
      }
    });
  }

  /* HOW BIG CHROME THINKS A SYNC ITEM IS: the key plus the UTF-8 bytes of the
   * value's JSON. Measured BEFORE writing, so a shelf list over the per-item
   * quota is refused here with its size on screen instead of costing one of
   * the 120 writes a minute to learn the same thing from Chrome. */
  const SYNC_LIMITS = {
    QUOTA_BYTES: 102400,
    QUOTA_BYTES_PER_ITEM: 8192,
    MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
    MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
  };
  function syncBytes(key, value) {
    const json = JSON.stringify(value === undefined ? null : value);
    let n;
    if (typeof TextEncoder === "function") n = new TextEncoder().encode(json).length;
    else n = unescape(encodeURIComponent(json)).length;
    return String(key).length + n;
  }

  /* ---- one writer at a time, across every github.com tab -----------------
   * EVERY STORE HERE IS ONE OBJECT, and chrome.storage has no transactions:
   * a write replaces the whole value. So read-modify-write in two tabs at once
   * is a lost update by construction — whichever lands last erases the other's
   * work. The sharp case was the fact cache: a cold pass held its copy for
   * minutes while the top-up in any other github.com tab held its own for ten
   * seconds, and the later write took the earlier one's records with it.
   * `notes`, `overrides`, `pins` and the shelf map have the same shape with a
   * narrower window.
   *
   * Two fixes, and they fix different halves:
   *
   *   RE-READ AND MERGE AT THE MOMENT OF WRITING. A writer hands over only what
   *     IT changed; the rest comes from the store as it stands now, not as it
   *     stood when the writer started. That alone shrinks the window from
   *     minutes to one storage round-trip.
   *   AND HOLD A LOCK ACROSS THAT ROUND-TRIP. Every writer that matters is a
   *     content script on github.com, and the Web Locks API is per ORIGIN — so
   *     `navigator.locks` is a real mutual exclusion between those tabs, which
   *     closes the round-trip too.
   *
   * THE LOCK IS AN AID, NEVER A GATE (P.III). A page script shares the origin
   * and could hold the same name; a frozen tab could sit on it. So the wait is
   * bounded, and past it — or with no Locks API at all (the options page's
   * own origin, a harness) — the write proceeds merged but unlocked, which is
   * still the first fix. A write that never happens is worse than a narrow
   * race. In-tab writers are additionally queued per store, so two writes
   * from one page can never interleave even where the lock is unavailable. */
  const LOCK_WAIT_MS = 2000;
  const queues = {};
  function atomically(name, fn) {
    const run = () => {
      const locks = typeof navigator !== "undefined" && navigator && navigator.locks;
      if (!locks || typeof locks.request !== "function") return fn();
      let ctl = null;
      try { ctl = new AbortController(); } catch (e) { /* no signal: wait unbounded */ }
      const timer = ctl ? setTimeout(() => ctl.abort(), LOCK_WAIT_MS) : null;
      const opts = ctl ? { signal: ctl.signal } : {};
      return locks.request("shelves:" + name, opts, () => {
        if (timer) clearTimeout(timer);
        return fn();
      }).catch((e) => {
        if (timer) clearTimeout(timer);
        if (e && e.name === "AbortError") return fn();   // waited long enough
        throw e;
      });
    };
    const next = (queues[name] || Promise.resolve()).then(run, run);
    queues[name] = next.catch(() => {});
    return next;
  }
  S._atomically = atomically;     // exposed for the harness, used nowhere else

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
  /** @returns {Promise<{ok: boolean, error: string|null}>} — `set` with its reason. */
  S.write = (area, obj) => write(area, obj);
  /** @returns {Promise<{ok: boolean, value: object, error: string|null}>} */
  S.read = (area, defaults) => read(area, defaults || {});
  S.SYNC_LIMITS = SYNC_LIMITS;
  S.syncBytes = syncBytes;
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

  let epoch = 0;

  /* THE STORE AS THIS TAB LAST SAW IT, kept current by every read, every
   * write and every `onChanged` — for the one writer that cannot afford a
   * round-trip (`putNow`). A copy, because callers mutate what `read` gives
   * them. */
  let mirror = null;
  /* `put`s this tab has issued that have not landed, so a `putNow` can carry
   * their records and they can carry its: see `putNow`. */
  const pending = new Set();
  const newer = (into, add) => {
    Object.keys(add || {}).forEach((k) => {
      const mine = add[k];
      const theirs = into[k];
      if (!mine) return;
      if (!theirs || (mine.at || 0) >= (theirs.at || 0)) into[k] = mine;
    });
    return into;
  };
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      const c = area === "local" && changes && changes[FACTS_KEY];
      if (c) mirror = c.newValue && typeof c.newValue === "object" ? { ...c.newValue } : {};
    });
  } catch (e) {
    /* no chrome.storage here — `putNow` falls back to what reads have shown */
  }

  S.cache = {
    async read() {
      const got = await get("local", { [FACTS_KEY]: {}, [CACHE_KEY]: {} });
      const c = got[FACTS_KEY];
      const old = got[CACHE_KEY];
      const out = (c && typeof c === "object" && Object.keys(c).length) ? c
        : (old && typeof old === "object" ? old : {});
      mirror = { ...out };
      return out;
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
      /* EVERY WRITE IS ALSO A SWEEP, once the reader is known. `S.viewer` is
       * absent in the options page, which loads this file without dom.js;
       * there the write is exactly what it was. */
      const who = typeof S.viewer === "function" ? S.viewer() : "";
      const kept = S.cache.sweep(cache, who).cache;
      const out = S.cache.prune(kept, settings);
      mirror = { ...out };
      return set("local", { [FACTS_KEY]: out });
    },
    /* THE WRITE EVERY WRITER USES. `records` is only what this writer
     * learned — never its whole copy — merged into the store as it stands
     * now, under the lock. Per key the NEWER `at` wins, so a slow writer can
     * never put back an older read of a repo another tab has since
     * refreshed; and since the rest is re-read rather than carried, a key
     * another tab added, or a clear that emptied the store, is respected.
     * An empty `records` is still a write: the sweep and prune run against
     * the store, which is how the top-up's cleanup lands without a snapshot.
     * @returns {Promise<boolean>} */
    put(records, settings) {
      const job = { add: records && typeof records === "object" ? records : {},
                    extra: {}, sent: false, late: {} };
      pending.add(job);
      const done = () => { pending.delete(job); };
      return atomically(FACTS_KEY, async () => {
        const now = await S.cache.read();
        const merged = newer(newer({ ...now }, job.add), job.extra);
        job.sent = true;
        return S.cache.write(merged, settings);
      }).then((ok) => {
        done();
        /* A `putNow` AFTER THIS ONE WAS SENT could not ride in it, and if this
         * write landed second it erased that one's records. Put them back —
         * a page alive to run this callback is alive to write once more. */
        if (Object.keys(job.late).length) return S.cache.put(job.late, settings).then(() => ok);
        return ok;
      }, (e) => { done(); throw e; });
    },
    /* THE WRITE A DYING PAGE CAN STILL MAKE. `put` waits for a lock and a
     * read, and both answer with a callback — a task, which a page being
     * frozen or unloaded never runs, so the records a leaving handler exists
     * to save would die in the queue. This one is issued in the same tick:
     * merged onto the mirror instead of a fresh read, unlocked.
     *
     * Two `put`s from this tab may still be in flight beside it, and whichever
     * lands second would otherwise erase the other. So it carries their
     * records, and hands its own to each of them to carry — every write this
     * tab makes from here on is a superset, in whatever order they land. The
     * window left is another tab writing in the same instant, against a
     * mirror one `onChanged` behind: one round-trip, once, at the moment the
     * page goes away. */
    putNow(records, settings) {
      const add = records && typeof records === "object" ? records : {};
      const merged = { ...(mirror || {}) };
      pending.forEach((job) => { newer(newer(merged, job.add), job.extra); });
      newer(merged, add);
      pending.forEach((job) => { newer(job.sent ? job.late : job.extra, add); });
      return S.cache.write(merged, settings);
    },
    /* ONLY THE READER'S OWN REPOSITORIES BELONG HERE. Rung 4 runs only on a
     * profile that is `isMine()`, so a record owned by anybody else is a
     * leftover of the signed-out bug — which counted every profile on GitHub
     * as the reader's and cached a hundred of a stranger's repo pages per
     * visit. Age could never clear them: the top-up refreshes `at` on
     * everything it finds, so a polluted record was re-fetched, with the
     * reader's session cookie, forever.
     *
     * PURE, and an unknown reader decides nothing. With no readable login
     * there is no "own" to keep, and sweeping on a guess would throw away
     * the reader's real cache and charge them a cold run to earn it back. */
    sweep(cache, viewer) {
      const c = cache && typeof cache === "object" ? cache : {};
      const who = String(viewer || "").trim().toLowerCase();
      if (!who) return { cache: c, dropped: 0 };
      const out = {};
      let dropped = 0;
      Object.keys(c).forEach((k) => {
        if (String(k).split("/")[0].toLowerCase() === who) out[k] = c[k];
        else dropped++;
      });
      return { cache: out, dropped };
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
      epoch++;
      mirror = {};
      return atomically(FACTS_KEY, () => set("local", { [FACTS_KEY]: {}, [CACHE_KEY]: {} }));
    },
    /* WHICH CLEAR THIS IS. A cold pass holds the whole cache in memory and
     * flushes it as it goes, so a `rescan` pressed mid-pass would be undone by
     * the pass's next write — every record the reader just asked to forget,
     * written straight back before the reload landed. A pass notes the epoch
     * it was born in and stops writing the moment it moves. */
    epoch() {
      return epoch;
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
    set(name, textIn) {
      return atomically(NOTES_KEY, async () => {
        const notes = await this.read();
        const t = String(textIn == null ? "" : textIn).trim().slice(0, 2000);
        if (t) notes[String(name || "").toLowerCase()] = t;
        else delete notes[String(name || "").toLowerCase()];
        const ok = await this.write(notes);
        return { ok, notes };
      });
    },
  };

  /* ---- overrides: { "owner/name": "shelf label" } ----------------------- */
  /* THE ONLY SHELF THIS EXTENSION CAN PUT A REPO ON WITHOUT GITHUB'S HELP.
   *
   * Everything else here derives a shelf from something GitHub holds — a topic
   * chip, an API field, a repo page. On an account that has never tagged
   * anything that machinery is correct and useless: measured on a real
   * profile, 68 of 77 repos carry no topics and can only ever land in the
   * leftovers shelf. An override is the reader answering the question
   * themselves.
   *
   * IT IS READ-ONLY ABOUT GITHUB, WHICH IS THE WHOLE DESIGN. P.I forbids
   * editing topics; the roadmap's "deliberately not doing" says so in as many
   * words. This reaches the same outcome from the other side: the opinion
   * lives in the browser, and uninstalling still undoes everything.
   *
   * LOCAL, and exempt from `cache.clear()`, for exactly the reason notes are:
   * no request re-derives it. It is the second thing in this file that a
   * rescan must not take, and the two are now the whole of that category. */
  S.overrides = {
    async read() {
      const got = await get("local", { [OVER_KEY]: {} });
      const o = got[OVER_KEY];
      return o && typeof o === "object" ? o : {};
    },
    write(all) {
      return set("local", { [OVER_KEY]: all });
    },
    /** An empty label REMOVES the override, so putting a repo back where its
     *  topics say it belongs needs no second verb — and cannot leave a key
     *  behind claiming an opinion the reader has withdrawn. */
    set(name, labelIn) {
      return this.setMany({ [String(name || "")]: labelIn });
    },
    /** Several in ONE locked read-modify-write. Accepting a suggestion pins
     *  every repo it named, and doing that as a read in main.js and a write
     *  later was the same lost update with the caller holding the stale copy. */
    setMany(map) {
      return atomically(OVER_KEY, async () => {
        const all = await this.read();
        let any = false;
        Object.keys(map || {}).forEach((name) => {
          const key = String(name || "").toLowerCase();
          const label = String(map[name] == null ? "" : map[name]).trim().slice(0, 60);
          if (!key) return;
          any = true;
          if (label) all[key] = label;
          else delete all[key];
        });
        if (!any) return { ok: false, overrides: all };
        const ok = await this.write(all);
        return { ok, overrides: all };
      });
    },
  };

  /* ---- pins: { "owner/name": true } ------------------------------------- */
  /* THE TOP OF A SHELF IS THE ONLY PLACE ON THIS PAGE WITH A VIEW. A shelf of
   * thirty is a scroll like any other; the three you are actually working on
   * belong where the eye lands. Ordering is the cheapest possible edit — the
   * rows are already there, nothing is fetched, nothing is hidden.
   *
   * Local and rescan-proof for the same reason as notes and overrides: no
   * request re-derives which repositories matter to you this month. The three
   * of them are now the whole of the category. */
  S.pins = {
    async read() {
      const got = await get("local", { [PIN_KEY]: {} });
      const o = got[PIN_KEY];
      return o && typeof o === "object" ? o : {};
    },
    write(all) {
      return set("local", { [PIN_KEY]: all });
    },
    /** The value is WHEN, not `true`. The page shows pinned rows in the order
     *  they were pinned — which is the order the reader watched them rise in —
     *  and without a stamp the next load re-derived that block in GitHub's own
     *  source order instead, so the page quietly rearranged itself. */
    toggle(name, when) {
      return atomically(PIN_KEY, async () => {
        const all = await this.read();
        const key = String(name || "").toLowerCase();
        if (!key) return { ok: false, pins: all };
        if (all[key]) delete all[key];
        else all[key] = when || Date.now();
        const ok = await this.write(all);
        return { ok, pins: all, on: !!all[key] };
      });
    },
  };

  /* ---- the one write to the reader's own configuration ------------------ */
  /* Every other write in this file is derived, disposable or private. This one
   * is the reader's setup, so it is deliberately small and deliberately
   * additive: a suggestion accepted becomes an ORDINARY shelf, indistinguishable
   * from one typed into the options page, editable and removable there. There
   * is no "suggested shelf" state to migrate later.
   *
   * Appending, never reordering: `settings.groups` is also the shelves' drawing
   * order, and quietly rearranging a reader's page is not what pressing `add`
   * asked for. */
  S.groups = {
    /** @param {string|string[]} labelIn — one shelf, or several in one write. */
    add(labelIn) {
      return atomically("groups", () => this._add(labelIn));
    },
    async _add(labelIn) {
      const want = (Array.isArray(labelIn) ? labelIn : [labelIn])
        .map((l) => String(l == null ? "" : l).trim().slice(0, 60))
        .filter(Boolean);
      if (!want.length) return { ok: false, groups: [] };
      const settings = await S.load();
      const groups = Array.isArray(settings.groups) ? settings.groups.slice() : [];
      const has = (l) => groups.some((g) => g.toLowerCase() === l.toLowerCase());
      const added = want.filter((l) => !has(l));
      if (!added.length) return { ok: true, groups, already: true };
      added.forEach((l) => groups.push(l));
      /* ONE WRITE FOR THE WHOLE ACCEPT, not one per label. Each write to a
       * non-QUIET key reloads the page (main.js), so a loop here would be a
       * loop of page loads, each racing the next. */
      const ok = await set("sync", { groups });
      return { ok, groups, added };
    },
  };

  /* ---- the three things nothing can rebuild, and the way out --------------
   * The fact cache is derived and a rescan re-earns it. `settings.groups` is
   * a few words you can retype. Your NOTES, your OVERRIDES and your PINS are
   * none of that: no request re-derives a sentence you wrote about a repo, or
   * the fact that this one belongs on that shelf.
   *
   * And the charter lists "uninstalling is a complete undo" as a FEATURE,
   * which it is — right up until it is pointed at the one category P.I
   * exempts from being derivable. Those two sentences are both true and
   * together they mean the only irreplaceable thing here lives in exactly one
   * place, on one machine, deliberately out of sync, with no way off it. A
   * profile reset, a new laptop or a mis-click on *Remove extension* takes it.
   *
   * PURE, so the merge can be tested without a file picker: `pack` builds the
   * object and `merge` decides what an incoming one is allowed to do. The
   * options page does the file I/O and nothing else.
   */
  const BACKUP_KEYS = [NOTES_KEY, OVER_KEY, PIN_KEY];

  S.backup = {
    keys: BACKUP_KEYS,

    async pack(now) {
      const got = await get("local", { [NOTES_KEY]: {}, [OVER_KEY]: {}, [PIN_KEY]: {} });
      const out = { shelves: 1, exported: now || Date.now() };
      BACKUP_KEYS.forEach((k) => {
        out[k] = got[k] && typeof got[k] === "object" ? got[k] : {};
      });
      return out;
    },

    /**
     * @returns {{stores, added, kept, skipped}}
     *
     * MERGE, NEVER OVERWRITE, and on a collision the INCUMBENT wins. Importing
     * is something a reader does when they are worried about losing something;
     * a silent overwrite of the sentence they wrote this morning is the one
     * unrecoverable act this extension would be capable of. `kept` is reported
     * so "nothing happened" and "you already had all of it" are different
     * sentences on screen.
     */
    merge(current, incoming) {
      const stores = {};
      let added = 0, kept = 0, skipped = 0;
      const src = incoming && typeof incoming === "object" ? incoming : {};
      BACKUP_KEYS.forEach((key) => {
        const have = (current && current[key] && typeof current[key] === "object")
          ? current[key] : {};
        const out = { ...have };
        const from = src[key];
        if (from && typeof from === "object" && !Array.isArray(from)) {
          Object.keys(from).forEach((rawName) => {
            /* A KEY OUT OF A FILE IS NOT A KEY YET. `__proto__` assigned on an
             * object literal walks straight up the prototype chain, and a name
             * that is not `owner/repo` names nothing this page can ever draw —
             * so it would sit in the store for ever, unreachable and
             * unremovable through the UI. */
            const name = String(rawName).toLowerCase();
            const parts = name.split("/");
            if (parts.length !== 2 || !S.safeRepo(parts[0], parts[1])) {
              skipped++;
              return;
            }
            if (Object.prototype.hasOwnProperty.call(out, name)) {
              kept++;
              return;
            }
            const v = from[rawName];
            /* Each store has one shape, and a value of any other shape is not
             * something this reader wrote — it is something that got in. */
            const ok = key === NOTES_KEY ? (typeof v === "string" && v.trim())
              : key === OVER_KEY ? (typeof v === "string" && v.trim())
              : (v === true || typeof v === "number");
            if (!ok) {
              skipped++;
              return;
            }
            out[name] = key === PIN_KEY
              ? (typeof v === "number" ? v : 1)
              : String(v).trim().slice(0, key === NOTES_KEY ? 2000 : 60);
            added++;
          });
        }
        stores[key] = out;
      });
      return { stores, added, kept, skipped };
    },

    /* All three stores at once, so all three locks, always nested in the
     * same order, so two restores can never deadlock each other. */
    restore(incoming) {
      return atomically(NOTES_KEY, () => atomically(OVER_KEY, () => atomically(PIN_KEY, async () => {
        const current = await get("local", { [NOTES_KEY]: {}, [OVER_KEY]: {}, [PIN_KEY]: {} });
        const res = this.merge(current, incoming);
        const ok = await set("local", res.stores);
        return { ok, ...res };
      })));
    },
  };

  /* ---- the shelf map: what the profile page worked out, left for the ----
   * ---- pages that cannot work it out for themselves ---------------------
   *
   * { "<owner>": { at, order: [labels], counts: {label: n},
   *                on: {"owner/repo": label}, status: {…} } }
   *
   * `on` and not `names`: this comment said `names` for as long as the code
   * wrote a list of every repository here, which was the most sensitive thing
   * in the store persisted for a feature nobody built. What replaced it
   * answers the question the repo page actually asks — which shelf am I on —
   * and the comment is corrected rather than deleted so the next reader can
   * tell a rename from a field they are failing to find.
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
   *
   * `status` IS THE TOOLBAR LINE, WRITTEN DOWN, and it is here for a second
   * reader with a harder problem than the repo page: the toolbar popup has no
   * content script, no page and no DOM to count. Anything it shows is either
   * read from this block or invented, and an invented count that disagrees
   * with the page is worse than a popup that says nothing — so the page that
   * knows writes the numbers AND the sentences that qualify them.
   *
   * TWO OF THOSE FIELDS ARE DELIBERATELY NULLABLE. `total` is the profile's
   * own repository count read off GitHub's nav, and it is null whenever it may
   * not be quoted — under a Type / Language / search filter the counter counts
   * the collection while the list shows a fraction of it, so "12 of 400" would
   * state a relationship that does not exist. `unread` is null for the third
   * state, "there are more and I cannot say how many", which is not the same
   * claim as 0 and must never be flattened into it: 0 means the page is
   * complete. A missing number costs one qualifier; a wrong one costs the
   * reader their reason to believe the numbers beside it.
   *
   * `mine` is in there for the same reason the nullable fields are: a
   * stranger's profile is still shelved, so a record is still written, and a
   * surface with no DOM cannot tell that record from the reader's own. Keeping
   * it and labelling it is what lets the popup say the extension stood down;
   * withholding it would make that indistinguishable from never having opened
   * the profile at all.
   *
   * It is never written from a provisional render — see `publishMap` — so a
   * popup opened mid-run reads the last completed pass, never the cache's
   * first draft.
   */

  S.shelfmap = {
    async read(owner) {
      const got = await get("local", { [MAP_KEY]: {} });
      const all = got[MAP_KEY];
      const m = all && typeof all === "object" ? all[String(owner || "").toLowerCase()] : null;
      return m && typeof m === "object" ? m : null;
    },
    write(owner, map) {
      return atomically(MAP_KEY, () => this._write(owner, map));
    },
    async _write(owner, map) {
      const got = await get("local", { [MAP_KEY]: {} });
      const all = (got[MAP_KEY] && typeof got[MAP_KEY] === "object") ? got[MAP_KEY] : {};
      all[String(owner || "").toLowerCase()] = { ...map, at: Date.now() };

      /* PROFILES THAT ARE NOT THE READER'S ARE KEPT, BUT NOT HOARDED.
       *
       * A stranger's tab is shelved and therefore recorded, which is what lets
       * the popup report a page visibly covered in shelves instead of shrugging
       * at it. The reader's own profiles are a handful and are the point of
       * this map, so they are never evicted. Other people's are a browsing
       * history, and a map that grew one permanent entry per profile ever
       * passed through would be a record of where the reader has been, kept
       * forever, for a panel that only ever asks about the tab in front of it.
       *
       * So the newest few survive and the rest fall off. `mark.js` reads this
       * map only for a page that passed `isMine()`, so an evicted stranger
       * costs nothing a re-shelve on the next visit does not already pay. */
      const theirs = Object.keys(all)
        .filter((k) => all[k] && all[k].status && all[k].status.mine === false)
        .sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
      theirs.slice(MAX_THEIRS).forEach((k) => delete all[k]);

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

  /* ---- how tightly the page is drawn ------------------------------------ */
  /* PER PROFILE, IN localStorage, BESIDE THE COLLAPSE STATE — because it is
   * the same kind of thing: a reading posture, not a preference. It does not
   * belong in `settings` and must not ride sync, for a reason that is easy to
   * miss: the right density depends on the SCREEN, and sync would carry the
   * choice made on a 27-inch monitor to a laptop where it is wrong.
   *
   * Per profile rather than global because the collections differ — your own
   * 77 repos want compact, a stranger's four do not. */
  S.density = {
    key(owner) {
      return "shelves:density:" + owner;
    },
    read(owner) {
      try {
        return localStorage.getItem(this.key(owner)) === "compact" ? "compact" : "roomy";
      } catch (e) {
        return "roomy";
      }
    },
    write(owner, value) {
      try {
        localStorage.setItem(this.key(owner), value === "compact" ? "compact" : "roomy");
      } catch (e) {
        /* private mode or a full quota — the page simply opens roomy again */
      }
    },
  };

  /* ---- when the reader was last on this page ---------------------------- */
  /* WHAT GITHUB CANNOT TELL YOU. It knows when every repo was pushed; it has
   * no idea when YOU last looked, so "three of these moved since you were
   * here" is a sentence only something living in your browser can say.
   *
   * localStorage, per profile, beside the other two postures — it is a fact
   * about this machine's reading, not a preference, and syncing it would make
   * "since you were last here" mean "since you were last here on any of four
   * computers", which is not a sentence anyone wants.
   *
   * READ ONCE PER VISIT AND STAMPED ONCE. Every render reading and rewriting
   * it would make the answer zero forever: the second pass of a progressive
   * render, or a Type/Language filter, would each count as "last time". */
  S.seen = {
    /* ONCE PER PAGE, NOT ONCE PER `run()`. GitHub's Type and Language menus
     * destroy the host, the observer re-enters `run()`, and the second pass
     * re-read the stamp it had written milliseconds earlier — so "3 since you
     * were here" became nothing the moment the reader touched a dropdown.
     * `run()` is documented idempotent; this was the one piece of state where
     * calling it twice differed from calling it once. */
    _done: false,
    key(owner) {
      return "shelves:seen:" + owner;
    },
    read(owner) {
      try {
        return Number(localStorage.getItem(this.key(owner))) || 0;
      } catch (e) {
        return 0;
      }
    },
    stamp(owner, now) {
      if (this._done) return;
      this._done = true;
      try {
        localStorage.setItem(this.key(owner), String(now || Date.now()));
      } catch (e) {
        /* no memory of this visit; next time simply says nothing */
      }
    },
  };

  /* ---- the workbench's place in the queue ------------------------------- */
  /* HOW FAR THROUGH THE UNTAGGED REPOS THE READER HAS WALKED. Deliberately the
   * shallowest storage in this file: localStorage, per profile, not synced,
   * not in chrome.storage at all.
   *
   * It is a bookmark in a chore, not a preference and not data — losing it
   * costs one repeat of a tab you already closed, which is why none of the
   * ceremony the other stores need applies here. It lives beside `collapse`
   * because that is the other thing on this page that remembers where you
   * were rather than what you decided.
   *
   * IT MUST BE WRAPPED BY THE CALLER, not clamped. The untagged list shrinks
   * every time the reader tags something, so a bookmark taken against five
   * repos is routinely read against two — and `Math.min` turns that into the
   * one index past the end, which opens nothing and never recovers. Both
   * callers take it modulo the live length. */
  S.bench = {
    key(owner) {
      return "shelves:bench:" + owner;
    },
    at(owner) {
      try {
        return Math.max(0, Number(localStorage.getItem(this.key(owner))) || 0);
      } catch (e) {
        return 0;
      }
    },
    set(owner, n) {
      try {
        localStorage.setItem(this.key(owner), String(Math.max(0, n | 0)));
      } catch (e) {
        /* the walk simply restarts from the top next time */
      }
    },
  };
})(globalThis.Shelves);
