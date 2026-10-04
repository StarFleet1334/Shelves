/* SHELVES — tests/harness.js
 *
 *   node tests/harness.js            all scenarios
 *   node tests/harness.js 3 5        only those, by index
 *   node tests/harness.js facts note only those, by keyword — what a roadmap
 *                                    proof should use, because an index moves
 *                                    when a scenario is inserted above it
 *   a selector that names nothing FAILS; it never passes emptily
 *
 * Assertions are on counts and membership, never on "it did not throw".
 */
"use strict";

const { build, makeLocks, readShelves, settle, type, writeNote, openVocab, pickTerm,
        pickGap, readMark, profilePage } = require("./world");

let failures = 0;
const results = [];

function check(name, fn) {
  return { name, fn };
}

function assert(ctx, cond, msg) {
  if (!cond) ctx.bad.push(msg);
}

function byLabel(view) {
  return Object.fromEntries(view.shelves.map((s) => [s.label, s]));
}

/* THE PROFILE NAV, WHICH world.js DOES NOT RENDER. `repoTotal` reads GitHub's
   own Repositories counter, and world.js builds the list without the nav above
   it — so the fixture for it has to be put on the page here. Inserted before
   anything else in the body, as it is on the real page, and replacing any
   previous one so a scenario can walk several shapes of counter.

   `text` defaults to `title`: GitHub writes both, and the interesting cases are
   exactly the ones where they disagree ("1.2k" against "1,234") or where one of
   them is missing. */
function navCounter(win, spec) {
  const had = win.document.getElementById("sh-test-nav");
  if (had) had.remove();
  const nav = win.document.createElement("nav");
  nav.id = "sh-test-nav";
  const a = win.document.createElement("a");
  a.id = "repositories-tab";
  a.setAttribute("href", "/octo?tab=repositories");
  a.setAttribute("data-tab-item", "repositories");
  const c = win.document.createElement("span");
  c.id = "repositories-repo-tab-count";
  c.className = "Counter";
  if (spec.title != null) c.setAttribute("title", String(spec.title));
  c.textContent = String(spec.text != null ? spec.text : (spec.title || ""));
  a.appendChild(c);
  nav.appendChild(a);
  win.document.body.insertBefore(nav, win.document.body.firstChild);
  return c;
}

/* A PAGE THAT ALWAYS HAS A PAGE AFTER IT — what a 13-page profile looks like to
   a ceiling of three, which is the one shape world.js's `page2` cannot build:
   its second page deliberately ends the chain. Chipped, so the rows it merges
   are answered by the page itself and the scenario measures pagination rather
   than the ladder. */
function endlessPage(n) {
  return profilePage("octo", [
    { name: "p" + n + "a", chips: ["keep"] },
    { name: "p" + n + "b", chips: ["keep"] },
  ], "/octo?tab=repositories&page=" + (n + 2));
}

/* TURBO DRIVE, AS IT ACTUALLY BEHAVES ON A BACK BUTTON. Leaving a page, Turbo
   fires `turbo:before-cache` on the document and THEN deep-clones the body into
   its snapshot cache — `cloneNode(true)`, so the snapshot has every element and
   attribute and not one listener. Coming back, it swaps that clone in as the
   body and fires `turbo:render` and `turbo:load`. The JavaScript context is
   the same one throughout: `S.lastFilter`, `S._keys` and every closure the
   first pass made are still alive, attached to a host that is now detached.

   `cache: false` skips the event and clones anyway — the shape where our
   listener did not run, or Turbo took its snapshot some other way. The clone
   is returned so a scenario can inspect what was actually cached. */
function turboLeave(win, opts) {
  const doc = win.document;
  if (!opts || opts.cache !== false) doc.dispatchEvent(new win.Event("turbo:before-cache"));
  const snap = doc.body.cloneNode(true);
  /* THE HARNESS'S OWN <script> TAGS ARE NOT PAGE CONTENT. world.js injects the
     content scripts as inline scripts in the body; on the real page they live
     in an isolated world and are never in the DOM, so a snapshot carrying them
     would be carrying something GitHub's page never had. */
  snap.querySelectorAll("script").forEach((s) => s.remove());
  // ...and the page the reader clicked through to: a repo page, not the tab.
  win.history.pushState({}, "", "/octo/elsewhere");
  const away = doc.createElement("body");
  away.innerHTML = '<div class="Layout-sidebar"><h2>About</h2></div>' +
                   '<article class="markdown-body"><p>a readme</p></article>';
  doc.body.replaceWith(away);
  doc.dispatchEvent(new win.Event("turbo:render"));
  doc.dispatchEvent(new win.Event("turbo:load"));
  return snap;
}

/* BACK. The browser has put the URL back before Turbo renders; Turbo then
   caches the page being left (its own before-cache) and restores the
   snapshot. A fresh clone goes in, as Turbo's `PageSnapshot` does, so the
   caller's `snap` stays inspectable. */
function turboBack(win, snap, url) {
  const doc = win.document;
  win.history.pushState({}, "", url || "/octo?tab=repositories");
  doc.dispatchEvent(new win.Event("turbo:before-cache"));
  doc.body.replaceWith(snap.cloneNode(true));
  doc.dispatchEvent(new win.Event("turbo:render"));
  doc.dispatchEvent(new win.Event("turbo:load"));
}

/* IS THIS PAGE ALIVE, OR A PICTURE OF ONE? A restored corpse passes every
   structural check — one host, the right shelves, the right counts — because
   it is a faithful copy of a page that was right. The only question that tells
   them apart is whether pressing things does anything, so this presses one of
   each KIND of thing: the find box (an `input` listener on the host), both
   toolbar buttons (`click`), the `c` key (a capture listener on the DOCUMENT,
   which on a corpse still points at the detached host), a row's grip, and a
   note (a row-level listener that writes to storage). */
async function assertLive(ctx, w, want) {
  const doc = w.win.document;
  const host = doc.getElementById("shelves-host");
  assert(ctx, host, "no host on the page at all");
  if (!host) return;

  type(w.win, want.q);
  let v = readShelves(w.win);
  assert(ctx, v.found === want.hits.length + " of " + want.all,
    "the find box must filter the restored page — found reads " +
    JSON.stringify(v.found) + ", want \"" + want.hits.length + " of " + want.all + "\"");
  assert(ctx, v.visible.slice().sort().join() === want.hits.slice().sort().join(),
    "and hide exactly the rows it does not match, visible: " + v.visible.join());
  type(w.win, "");
  v = readShelves(w.win);
  assert(ctx, v.visible.length === want.all && !doc.querySelector("li.sh-hide"),
    "and clearing it must bring every row back, visible " + v.visible.length +
    " of " + want.all + ", still hidden: " + doc.querySelectorAll("li.sh-hide").length);

  const btn = (label) => [...host.querySelectorAll(".sh-btn")]
    .find((b) => b.textContent === label);
  const shelves = () => [...doc.querySelectorAll("#shelves-host details.sh-shelf")];
  const openOf = () => shelves().filter((d) => d.open).length + " of " + shelves().length;
  const ex = btn("expand all");
  const co = btn("collapse all");
  assert(ctx, ex && co, "the toolbar's expand/collapse buttons are missing");
  if (ex) ex.click();
  if (co) co.click();
  assert(ctx, shelves().length && shelves().every((d) => !d.open),
    "COLLAPSE ALL must close every shelf on the page in front of the reader, open: " +
    openOf());
  if (ex) ex.click();
  assert(ctx, shelves().length && shelves().every((d) => d.open),
    "and EXPAND ALL open them again, open: " + openOf());

  doc.body.dispatchEvent(new w.win.KeyboardEvent("keydown", { key: "c", bubbles: true }));
  assert(ctx, shelves().every((d) => !d.open),
    "`c` must act on THIS host — a keydown listener left on the detached one " +
    "collapses a page nobody can see, open: " + openOf());
  doc.body.dispatchEvent(new w.win.KeyboardEvent("keydown", { key: "e", bubbles: true }));

  /* THE GRIP IS THE SHARPEST CASE. `margin()` skips a row already stamped
     `data-sh-margin`, and the grip is only added where no `.sh-move` is held —
     so a rebuild that trusts a cloned row's stamps keeps the CLONED grip, which
     looks identical and answers nothing. */
  const row = [...doc.querySelectorAll("#shelves-host li[data-sh-name]")]
    .find((li) => ((li.querySelector("h3 a") || {}).textContent || "") === want.note);
  const grip = row && row.querySelector(".sh-grip");
  assert(ctx, grip, "the row " + want.note + " has no grip to press");
  if (grip) {
    grip.click();
    assert(ctx, row.querySelectorAll(".sh-shelflist").length === 1,
      "pressing the grip must open the shelf list, got " +
      row.querySelectorAll(".sh-shelflist").length);
    grip.click();   // and close it again, so the note below is not under a menu
  }

  let opened = true;
  try {
    writeNote(w.win, want.note, "written after back");
  } catch (e) {
    opened = false;
    assert(ctx, false, "a note cannot be written on the restored page: " + e.message);
  }
  if (opened) {
    await settle(200);
    const stored = (w.store.local.notes || {})["octo/" + want.note];
    assert(ctx, stored === "written after back",
      "and the note must reach storage, got: " + JSON.stringify(stored));
    assert(ctx, readShelves(w.win).notes[want.note] === "written after back",
      "and be painted on its row, got: " +
      JSON.stringify(readShelves(w.win).notes[want.note]));
  }
}

/* ONE OF EACH, PER ROW. A rebuild over a stale host starts from rows that
   already carry a margin, a grip and a sibling strip; a pass that decorates
   without looking would hang a second set on every one of them. */
function furniture(win) {
  const rows = [...win.document.querySelectorAll("#shelves-host li[data-sh-name]")];
  const most = (sel) => rows.reduce((m, li) =>
    Math.max(m, li.querySelectorAll(sel).length), 0);
  return {
    rows: rows.length,
    margin: most(".sh-margin"),
    move: most(".sh-move"),
    sibs: most(".sh-sibs"),
    bars: win.document.querySelectorAll(".sh-bar").length,
    finds: win.document.querySelectorAll(".sh-find").length,
    status: win.document.querySelectorAll("#sh-status").length,
  };
}

/* THE FIXTURE ALL FOUR TURBO SCENARIOS SHARE. Chipped, so the page alone is
   the answer and nothing here waits on the ladder; two shelves plus leftovers,
   so collapse and expand have more than one thing to act on; and a word that
   matches two rows of four, so a live filter is distinguishable from a dead
   one by count AND by membership. */
const TURBO_REPOS = [
  { name: "wire-a", chips: ["keep"], description: "the first wire" },
  { name: "wire-b", chips: ["tools"], description: "the second wire" },
  { name: "plain", chips: ["keep"], description: "nothing to see" },
  { name: "loose", chips: [], description: "on no shelf at all" },
];
const TURBO_LIVE = { q: "wire", hits: ["wire-a", "wire-b"], all: 4, note: "plain" };

/* ── A PASS THAT CAN BE CAUGHT HALFWAY ─────────────────────────────────────
   The "mid-pass" scenarios are about what a cold rung-4 pass has PUT DOWN
   before it ends, which world.js cannot show on its own: its fetches all land
   in a few milliseconds and its storage writes are instant, so "after the
   last one" and "as it goes" leave the same store behind.

   PRIVATE AND INVISIBLE TO THE API, so every row climbs to rung 4 — one
   same-origin page read each. Half carry a topic so the shelf is not empty. */
function midPassRepos(n) {
  return Array.from({ length: n }, (_, i) => ({
    name: "m" + String(i).padStart(2, "0"),
    topics: i % 2 ? ["keep"] : [],
    private: true,
  }));
}

/* THREE INSTRUMENTS ON ONE WORLD, fitted before the pass starts (main.js waits
   on storage before it reads anything, so right after build() is early enough).

   THE GATE: repo-page fetches answer normally until `blockAfter` have been
   answered, then return a promise that never settles — a tab that was closed
   or discarded mid-pass, as far as the pass can ever tell. `release` is not
   offered on purpose: a dying tab gets no second chance either.

   THE LEDGER OF WRITES: every chrome.storage.local.set that carries
   `repoFacts`, as the sorted KEYS it held at the moment of the call (the stub
   stores by reference, so reading the store later could see a record that was
   not there yet). `delay(i)` holds the i-th write before it reaches the store
   — out of order if the delays shrink — and `maxInFlight` says whether two
   were ever outstanding at once.

   THE LEDGER OF LISTENERS: adds and removes of the three leaving events, on
   document and window, so "the pass cleaned up after itself" is a count and
   not an inference from silence. */
const LEAVING = ["visibilitychange", "freeze", "pagehide"];
function midPass(w, opts) {
  const o = opts || {};
  const t = { answered: 0, held: 0, writes: [], inFlight: 0, maxInFlight: 0,
              added: 0, removed: 0, live: [] };

  /* THE HAND ON THE GATE (`gate: true`): every fetch waits in `t.queue` until
     `t.release(n)` lets the oldest n through — for the scenarios that have to
     watch the store after EACH read rather than after a dying tab's last one.
     Unreleased fetches simply never settle, which keeps nothing alive. */
  t.queue = [];
  t.release = (n) => {
    let k = 0;
    while (k < (n == null ? 1 : n) && t.queue.length) { t.queue.shift()(); k++; }
    return k;
  };

  const fetchReal = w.win.fetch;
  w.win.fetch = (url) => {
    if (o.gate) {
      return new Promise((res, rej) => t.queue.push(() => {
        t.answered++;
        Promise.resolve(fetchReal(url)).then(res, rej);
      }));
    }
    if (o.blockAfter != null && t.answered >= o.blockAfter) {
      t.held++;
      return new Promise(() => {});
    }
    t.answered++;
    return fetchReal(url);
  };

  const local = w.win.chrome.storage.local;
  const setReal = local.set;
  local.set = (obj, cb) => {
    if (!obj || !("repoFacts" in obj)) return setReal(obj, cb);
    const i = t.writes.length;
    t.writes.push(Object.keys(obj.repoFacts || {}).sort());
    t.inFlight++;
    t.maxInFlight = Math.max(t.maxInFlight, t.inFlight);
    const land = () => setReal(obj, () => { t.inFlight--; if (cb) cb(); });
    const ms = o.delay ? o.delay(i) : 0;
    if (ms) setTimeout(land, ms); else land();
  };

  const watch = (target) => {
    const add = target.addEventListener;
    const rm = target.removeEventListener;
    target.addEventListener = function (type, fn, x) {
      if (LEAVING.includes(type)) { t.added++; t.live.push([target, type, fn]); }
      return add.call(this, type, fn, x);
    };
    target.removeEventListener = function (type, fn, x) {
      if (LEAVING.includes(type)) {
        const k = t.live.findIndex((l) => l[0] === target && l[1] === type && l[2] === fn);
        if (k !== -1) { t.removed++; t.live.splice(k, 1); }
      }
      return rm.call(this, type, fn, x);
    };
  };
  watch(w.win.document);
  watch(w.win);
  return t;
}

/* THE PAGE GOING AWAY. jsdom's visibilityState is a getter on the prototype
   and answers "visible" forever under pretendToBeVisual; an own property on
   the document instance shadows it, which is all topics.js ever reads. */
function leave(w, type, state) {
  const doc = w.win.document;
  if (type === "visibilitychange") {
    Object.defineProperty(doc, "visibilityState", { value: state || "hidden", configurable: true });
    doc.dispatchEvent(new w.win.Event("visibilitychange"));
  } else if (type === "pagehide") {
    w.win.dispatchEvent(new w.win.Event("pagehide"));
  } else {
    doc.dispatchEvent(new w.win.Event(type));
  }
}

const storedFacts = (w) => Object.keys(w.store.local.repoFacts || {});

/* ── TWO TABS, ONE STORE ───────────────────────────────────────────────────
   The "cross-tab" scenarios are about a lost update no single world can show:
   every store is ONE object and chrome.storage has no transactions, so two
   tabs each reading, changing and writing back the whole thing erase each
   other — whichever lands last wins, wholesale. Two worlds built over one
   store (`build({ store })`) read and write the same object and hear each
   other's onChanged, as two github.com tabs do; `clone` makes every get and
   set a copy, because a stub that shares objects by reference lets a tab
   mutate the store through its "copy" and hides exactly the loss under test;
   and `locks` is one `makeLocks()` manager on both, which is what
   `navigator.locks` is between same-origin tabs. Omitted, the pages have no
   Locks API at all and the unlocked half of the fix is what runs. */
const DAY = 86400000;
/* WHAT BOTH TABS READ. A profile pass reads m00..m24 in order at concurrency
   1, so m00/m01 land in its first flush, m10/m11 are the two it has read but
   not yet written when it is paused at twelve, and m20/m21 are still ahead of
   it. Seeded stale (eight days, past a seven-day TTL), so the pass re-reads
   them AND the top-up finds them due. */
const OVERLAP = ["m00", "m01", "m10", "m11", "m20", "m21"];
/* WHAT ONLY THE TOP-UP READS: cached, the reader's own, and not on the
   profile page — so a pass writing its whole copy back can only ever put the
   stale seed over the refresh. */
const ONLY_WARM = ["x1", "x2", "x3"];
const WARM_ON = { cacheDays: 7, warmBatch: 10, prewarm: true };

/* EVERY RECORD A WORLD'S OWN PARSE PRODUCED, by name — the pass's reads in
   one, the top-up's in the other — so "the newer one won" is checked against
   what each tab actually had, not against a timestamp the scenario guessed. */
function recordReads(w) {
  const S = w.win.Shelves;
  const got = {};
  const real = S.factsFrom;
  S.factsFrom = function (doc, name) {
    const f = real.apply(this, arguments);
    if (f && typeof f === "object") got[name] = f;
    return f;
  };
  return got;
}

/* THE PAIR: tab A on the reader's own profile, a cold pass of 25 rung-4 rows
   behind a gate; tab B on one of their repo pages, its top-up's fetches behind
   a gate of its own. Nothing moves until a scenario lets it. */
function crossPair(locked) {
  const now = Date.now();
  const cache = {};
  OVERLAP.concat(ONLY_WARM).forEach((n, i) => {
    cache["octo/" + n] = { at: now - 8 * DAY - i * 60000, topics: [], description: "a stale seed" };
  });
  const locks = locked ? makeLocks() : null;
  const a = build({
    viewer: "octo", owner: "octo", clone: true, locks,
    settings: { groups: ["keep"], concurrency: 1, scrapeMax: 0 },
    apiRepos: [],
    repos: midPassRepos(25),
    cache,
  });
  const b = build({
    store: a.store, clone: true, locks,
    viewer: "octo", owner: "octo", at: "octo/throttle-kit", page: { topics: ["rag"] },
    repos: OVERLAP.concat(ONLY_WARM).map((n) => ({
      name: n, topics: ["warm"], description: "from the top-up",
    })),
  });
  return { a, b, locks, ta: midPass(a, { gate: true }), tb: midPass(b, { gate: true }),
           ra: recordReads(a), rb: recordReads(b) };
}

/* Let the pass read, one page at a time, until it has read `n`. */
async function passReads(p, n) {
  for (let i = 0; i < 4 * n && p.a.counters.scraped.length < n; i++) {
    p.ta.release(1);
    await settle(25);
  }
}

/* Answer the top-up's fetches one at a time until its run settles. */
async function warmThrough(p, run) {
  let over = false;
  const out = run.then((r) => { over = true; return r; });
  for (let i = 0; i < 80 && !over; i++) { p.tb.release(1); await settle(25); }
  return out;
}

/* THE VERDICT BOTH ORDERS SHARE. Every record either tab read must be in the
   store, and where both read one repo the store holds the read with the newer
   `at` — never the older one put back by whoever wrote last. */
function crossVerdict(ctx, p, tag) {
  const fin = p.a.store.local.repoFacts || {};
  const aRead = Object.keys(p.ra).filter((k) => /^octo\/m\d\d$/.test(k));
  const bRead = Object.keys(p.rb).filter((k) => /^octo\/[mx]\d+$/.test(k));
  const lostA = aRead.filter((k) => !fin[k]);
  const lostB = bRead.filter((k) => !fin[k]);
  assert(ctx, aRead.length === 25 && lostA.length === 0,
    tag + ": every record the profile pass read must be stored, read " + aRead.length +
    ", missing " + lostA.length + ": " + lostA.join());
  assert(ctx, lostB.length === 0,
    tag + ": every record the top-up refreshed must be stored, missing " + lostB.length +
    ": " + lostB.join());
  const keys = [...new Set(aRead.concat(bRead))];
  const stale = keys.filter((k) => {
    const want = Math.max((p.ra[k] || {}).at || 0, (p.rb[k] || {}).at || 0);
    return fin[k] && fin[k].at !== want;
  });
  assert(ctx, stale.length === 0,
    tag + ": each repo must hold the NEWEST read of it, older or seed records in " +
    stale.length + ": " + stale.map((k) => k.slice(5) + "@" +
      (fin[k].description === "a stale seed" ? "seed"
        : p.rb[k] && fin[k].at === p.rb[k].at ? "top-up" : "pass")).join(", "));
  const both = OVERLAP.map((n) => "octo/" + n).filter((k) => p.ra[k] && p.rb[k]);
  const byB = both.filter((k) => fin[k] && p.rb[k].at > p.ra[k].at && fin[k].at === p.rb[k].at);
  return { stored: Object.keys(fin).length, both: both.length, byB: byB.length };
}

/* TWO REPO-PAGE TABS over one store — nothing on either page writes on its
   own, so every storage call in the window is the scenario's. */
function twoTabs(locked) {
  const locks = locked ? makeLocks() : null;
  const a = build({ viewer: "octo", owner: "octo", clone: true, locks,
                    at: "octo/one", page: { topics: [] }, repos: [] });
  const b = build({ store: a.store, clone: true, locks,
                    viewer: "octo", owner: "octo", at: "octo/two", page: { topics: [] }, repos: [] });
  return { a, b, locks };
}

/* SLOW STORAGE, AND A WITNESS TO OVERLAP. Every local `set` touching one of
   `keys` lands `ms` later — the value too, not just the callback, which is
   what a slow write is to anyone reading meanwhile. And each tab's
   read-modify-write is watched from its `get` to the landing of its `set`: a
   `get` of a key while ANOTHER tab's window on that key is open is an
   overlap, the shape of every lost update here. Arm it once the pages have
   settled, so their own loading reads are not counted. */
function slowStorage(worlds, keys, ms) {
  const rmw = { armed: false, open: {}, overlaps: {}, gets: 0 };
  worlds.forEach((w, id) => {
    const local = w.win.chrome.storage.local;
    const getReal = local.get;
    const setReal = local.set;
    local.get = (defaults, cb) => {
      if (rmw.armed) {
        Object.keys(defaults || {}).filter((k) => keys.includes(k)).forEach((k) => {
          rmw.gets++;
          const others = Object.keys(rmw.open[k] || {}).filter((o) => Number(o) !== id);
          if (others.length) rmw.overlaps[k] = (rmw.overlaps[k] || 0) + 1;
          (rmw.open[k] = rmw.open[k] || {})[id] = true;
        });
      }
      return getReal(defaults, cb);
    };
    local.set = (obj, cb) => {
      const hit = Object.keys(obj || {}).filter((k) => keys.includes(k));
      if (!hit.length) return setReal(obj, cb);
      setTimeout(() => setReal(obj, () => {
        hit.forEach((k) => { if (rmw.open[k]) delete rmw.open[k][id]; });
        if (cb) cb();
      }), ms);
    };
  });
  return rmw;
}

/* ── A SPENT QUOTA, AS GITHUB ACTUALLY SAYS IT ─────────────────────────────
   403 (or 429) is how GitHub says RATE LIMIT; 401 is how it says bad
   credentials. The difference lives entirely in the headers, so the fixture
   door is an object, not a number. `RESET_AT` is ten minutes out in unix
   SECONDS, as `x-ratelimit-reset` carries it, and `hhmm` is the local clock
   the toolbar must therefore print. */
const RESET_AT = Math.floor(Date.now() / 1000) + 600;
const SPENT = { status: 403, headers: { "x-ratelimit-remaining": "0",
                                        "x-ratelimit-reset": String(RESET_AT) } };
const hhmm = (ms) => {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};
const RATE_REPOS = [
  { name: "secret-ai", topics: ["aiproject"], private: true },
  { name: "random", topics: [], private: true },
];
/* What every rate-limit scenario owes the reader: the page renders, every
   repo is still on it (rung 4 is a different quota), and the warning names
   the limit — never the rejection or the shrug unless the case says so. */
function rateVerdict(ctx, w, want) {
  const v = readShelves(w.win);
  assert(ctx, v, "a rate limit must never cost the render");
  if (!v) return null;
  const warn = v.warn || "";
  assert(ctx, want.re.test(warn), "warn must match " + want.re + ", got " + JSON.stringify(warn));
  (want.not || []).forEach((re) =>
    assert(ctx, !re.test(warn), "warn must NOT match " + re + ", got " + JSON.stringify(warn)));
  const total = v.shelves.reduce((n, s) => n + s.count, 0);
  assert(ctx, total === RATE_REPOS.length, "every repo must still be on the page, got " + total);
  const b = byLabel(v);
  assert(ctx, b.aiproject && b.aiproject.count === 1,
    "repo pages (a different quota) must still shelve the private repo");
  if (want.calls != null) {
    assert(ctx, w.counters.calls.length === want.calls,
      "expected " + want.calls + " api call(s), got " + JSON.stringify(w.counters.calls));
  }
  return v;
}

/* ---------------------------------------------------------------------- */

const SCENARIOS = [
  check("chips already on the page — zero network", async (ctx) => {
    /* EVERY ROW CARRIES CHIPS. That is the only shape in which the page alone
       is the whole answer, and it is the shape this scenario was written for —
       it used to give chips to three rows of four and assert zero network
       anyway, which is the short-circuit ladder-floor exists to remove. The
       fourth row now carries an EMPTY chip list, which is an answer ("this
       repo has no topics") and not a silence. */
    const w = build({
      owner: "octo",
      settings: { groups: ["aiproject", "tooling"] },
      repos: [
        { name: "agent", chips: ["aiproject"] },
        { name: "rag", chips: ["aiproject", "python"] },
        { name: "dotfiles", chips: ["tooling"] },
        { name: "notes", chips: ["misc"] },
      ],
    });
    await settle();
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    const b = byLabel(v);
    assert(ctx, b.aiproject && b.aiproject.count === 2, "aiproject should hold 2");
    assert(ctx, b.tooling && b.tooling.count === 1, "tooling should hold 1");
    assert(ctx, b.Ungrouped && b.Ungrouped.count === 1, "Ungrouped should hold 1");
    assert(ctx, v.shelves[v.shelves.length - 1].label === "Ungrouped", "Ungrouped must be last");
    /* `$` and not a substring: the page answering EVERYONE is the whole claim,
       so a line reading "via page + api (public)" must fail here even though it
       contains "via page". */
    assert(ctx, /· via page$/.test(v.note),
      "the page alone answered, so it must be the only rung named, got: " + v.note);
    assert(ctx, w.counters.api === 0, "a fully-chipped page must cost no API call");
    assert(ctx, w.counters.scraped.length === 0, "a fully-chipped page must cost no scraping");
    ctx.info = v.note;
  }),

  check("ladder-floor — chips are a floor, and the repos they missed still climb",
    async (ctx) => {
    /* THE SHORT CIRCUIT THIS REPLACES. `if (answered() > 0) return` ended the
       ladder for the whole collection the moment ONE row carried chips.
       Measured on a real 77-repo account: 9 rows chipped, 68 left in Ungrouped
       having asked nobody, for zero requests and no warning.

       The fixture is that shape in miniature: one row chipped, three not, and
       an API that cannot see any of them (they are private and apiRepos is
       empty). So the three must reach rung 4 — and the chipped one must NOT,
       because a floor that costs a request is not a floor. */
    const w = build({
      viewer: "octo",
      owner: "octo",
      settings: { groups: ["aiproject", "tooling"] },
      apiRepos: [],
      repos: [
        { name: "agent", chips: ["aiproject"], topics: ["aiproject"], private: true },
        { name: "rag", topics: ["aiproject", "python"], private: true },
        { name: "dotfiles", topics: ["tooling"], private: true },
        { name: "notes", topics: [], private: true },
      ],
    });
    await settle(1400);
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    const b = byLabel(v);

    /* The floor held: agent keeps the shelf its chip named. */
    assert(ctx, b.aiproject && b.aiproject.count === 2,
      "aiproject should hold agent (chips) AND rag (scraped), got: " +
      ((b.aiproject || {}).count));
    assert(ctx, b.tooling && b.tooling.count === 1, "tooling should hold dotfiles");
    assert(ctx, b.Ungrouped && b.Ungrouped.count === 1,
      "only the genuinely untagged repo is left over, got: " + ((b.Ungrouped || {}).count));

    /* THE ASSERTION THAT MATTERS: the chipped repo cost nothing extra, and the
       three the page did not answer for were all read. */
    assert(ctx, w.counters.scraped.length === 3,
      "the 3 repos the page did not answer must climb, scraped: " +
      w.counters.scraped.join());
    assert(ctx, w.counters.scraped.indexOf("octo/agent") === -1,
      "the chipped repo must NOT be re-read — it was already answered for free");

    /* P.IV — two rungs answered, so the line names two. */
    assert(ctx, /page/.test(v.note) && /repo pages/.test(v.note),
      "the source line must name every rung that contributed, got: " + v.note);
    ctx.info = v.note + "  |  scraped " + w.counters.scraped.length + ", agent free";
  }),

  check("ceiling — rung 4 stops, says how many are left, and can be asked for the rest",
    async (ctx) => {
    /* THE HIGHEST-VOLUME PATH HAD NO CAP. There is a backoff for when GitHub
       says stop, and there was nothing at all for "do not start" — so an
       account the API cannot see was one authenticated fetch per repo, however
       many that was, on a page opened to look at a list.

       Twelve repos the API cannot see, a ceiling of five. */
    const w = build({
      viewer: "octo",
      owner: "octo",
      settings: { groups: ["keep"], scrapeMax: 5, concurrency: 3 },
      apiRepos: [],
      repos: Array.from({ length: 12 }, (_, i) => ({
        name: "r" + i, topics: i < 4 ? ["keep"] : [], private: true,
      })),
    });
    await settle(1600);
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;

    assert(ctx, w.counters.scraped.length === 5,
      "the ceiling must hold: 5 expected, read " + w.counters.scraped.length);

    /* THE OTHER HALF. A cap with no way past it is not a choice, it is a
       smaller silence — so the deferred repos are counted on a button. */
    const btns = [...w.win.document.querySelectorAll("#shelves-host .sh-btn")]
      .map((b) => b.textContent);
    assert(ctx, btns.indexOf("read 7 more") !== -1,
      "the toolbar must offer the rest, by count. buttons: " + btns.join(" | "));

    /* NOT A WARNING. Nothing went wrong; a ceiling the reader can lift is an
       offer, and filing it beside "token rejected" would teach them to read a
       deliberate limit as a fault. */
    assert(ctx, !/7/.test(v.warn || ""),
      "a deferred repo is not a fault and must stay out of the warning, got: " + v.warn);

    /* AND CONTINUE MUST BE CHEAP. The button reloads (untestable here), so the
       pass it asks for is driven directly: with the ceiling lifted, exactly the
       seven that were deferred are read — the five already cached are not. */
    const before = w.counters.scraped.length;
    const rows = [...w.win.document.querySelectorAll("#shelves-host details li")];
    const names = rows.map((li) => li.dataset.shName);
    const settings = await w.win.Shelves.load();
    const again = await w.win.Shelves.resolve(rows, names, { ...settings, readAll: true });
    const second = w.counters.scraped.slice(before);
    assert(ctx, second.length === 7,
      "continue must read exactly the deferred 7, read " + second.length);
    assert(ctx, again.deferred === 0, "and nothing is left deferred afterwards");
    assert(ctx, again.topics.filter((t) => t.length).length === 4,
      "with every repo read, all 4 tagged ones are found, got " +
      again.topics.filter((t) => t.length).length);
    ctx.info = "5 of 12 read, 7 offered, 7 read on continue — none re-read";
  }),

  check("mid-pass — records are written while the pass is still running",
    async (ctx) => {
    /* PAY ONCE HELD ONLY FOR A PASS THAT FINISHED. The cache was written once,
       after the last fetch landed — so a cold pass of a hundred that was closed
       or discarded twenty in had read twenty pages and kept none of them, and
       the next visit paid for all twenty again.

       Twenty-five rung-4 rows, three at a time; the twelve-and-first fetch
       never answers. The pass is hung, as a dying tab's is, and what matters
       is what the store already holds. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"], concurrency: 3, scrapeMax: 0 },
      apiRepos: [],
      repos: midPassRepos(25),
    });
    const t = midPass(w, { blockAfter: 12 });
    await settle(900);

    assert(ctx, w.counters.scraped.length === 12 && t.held > 0,
      "the gate must hold the pass after 12 reads, read " +
      w.counters.scraped.length + ", held " + t.held);
    const read = new Set(w.counters.scraped);
    const kept = storedFacts(w);
    assert(ctx, kept.length >= 10,
      "at least 10 of the 12 records read must already be in storage while the " +
      "pass is hung, stored " + kept.length);
    assert(ctx, kept.every((k) => read.has(k)),
      "and only records that were actually read: " +
      kept.filter((k) => !read.has(k)).join());
    /* ONE WRITE, NOT TWELVE. Ten reads earn a write. It may carry more than
       ten — the write is queued behind the chain and snapshots the cache when
       it runs, by which time the reads already in flight have landed — but it
       is one write, and nothing past twelve was ever read to put in it. */
    assert(ctx, t.writes.length === 1 && t.writes[0].length >= 10,
      "exactly one write of at least 10 so far, got " +
      (t.writes.map((k) => k.length).join("+") || "none"));
    ctx.info = "12 read, " + kept.length + " already stored, pass still hung";
  }),

  check("mid-pass — a hidden tab flushes what it has", async (ctx) => {
    /* BELOW THE FLUSH LINE, THE ONLY WRITE IS THE ONE LEAVING EARNS. Four reads
       will never reach ten on a tab that is going away; the last event it
       reliably gets is the cue to put them down. Each of the three exits is
       tried in a world of its own, because one flush would hide the next. */
    const exits = ["visibilitychange", "pagehide", "freeze"];
    const told = [];
    for (const exit of exits) {
      const w = build({
        viewer: "octo", owner: "octo",
        settings: { groups: ["keep"], concurrency: 3, scrapeMax: 0 },
        apiRepos: [],
        repos: midPassRepos(25),
      });
      const t = midPass(w, { blockAfter: 4 });
      await settle(700);
      assert(ctx, w.counters.scraped.length === 4,
        exit + ": the gate must hold the pass after 4 reads, read " +
        w.counters.scraped.length);
      assert(ctx, t.writes.length === 0,
        exit + ": 4 reads are below FLUSH_EVERY and must not write on their own, " +
        "wrote " + t.writes.length);

      leave(w, exit);
      await settle(100);
      const read = w.counters.scraped.slice().sort();
      const kept = storedFacts(w).sort();
      assert(ctx, t.writes.length === 1,
        exit + ": leaving must write once, wrote " + t.writes.length);
      assert(ctx, kept.join() === read.join(),
        exit + ": the store must hold exactly the 4 read, holds [" + kept.join() +
        "] for [" + read.join() + "]");

      /* LEAVING TWICE IS FREE. A tab that goes hidden, comes back and goes
         hidden again with nothing new read has nothing to write. */
      const once = t.writes.length;
      leave(w, exit);
      await settle(100);
      assert(ctx, t.writes.length === once,
        exit + ": a second exit with nothing new must not write, wrote " +
        (t.writes.length - once) + " more");
      told.push(exit + " " + kept.length + "/4");
    }
    ctx.info = "kept on leaving: " + told.join(", ");
  }),

  check("mid-pass — a visible visibilitychange does not write", async (ctx) => {
    /* COMING BACK IS NOT LEAVING. visibilitychange fires both ways; a tab the
       reader just returned to is in no danger, and writing on it would turn
       every tab switch into a storage write. The hidden one afterwards is the
       control: it proves the listener was there to decline. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"], concurrency: 3, scrapeMax: 0 },
      apiRepos: [],
      repos: midPassRepos(25),
    });
    const t = midPass(w, { blockAfter: 4 });
    await settle(700);
    leave(w, "visibilitychange", "visible");
    await settle(100);
    assert(ctx, t.writes.length === 0,
      "a visible visibilitychange must not write, wrote " + t.writes.length);
    leave(w, "visibilitychange", "hidden");
    await settle(100);
    assert(ctx, t.writes.length === 1 && t.writes[0].length === 4,
      "the control: hidden afterwards must write the 4 held, got " +
      (t.writes.map((k) => k.length).join("+") || "no write"));
    ctx.info = "visible: 0 writes; hidden: " + t.writes.length + " write of " +
      ((t.writes[0] || []).length);
  }),

  check("mid-pass — the flushes are never concurrent and the last one wins",
    async (ctx) => {
    /* EACH WRITE IS THE WHOLE OBJECT, so two in flight are a race the older
       snapshot can win. The stub is made to land them backwards: the first
       write takes 300ms, the second 150, the third 20 — if they overlapped,
       the 10-record snapshot would land last and the store would forget 15. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"], concurrency: 3, scrapeMax: 0 },
      apiRepos: [],
      repos: midPassRepos(25),
    });
    const t = midPass(w, { delay: (i) => [300, 150, 20][i] || 20 });
    await settle(1800);
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");

    assert(ctx, w.counters.scraped.length === 25,
      "a cold pass reads all 25, read " + w.counters.scraped.length);
    const kept = storedFacts(w);
    assert(ctx, kept.length === 25,
      "the store must end with all 25 records, holds " + kept.length);
    assert(ctx, t.maxInFlight === 1,
      "no two cache writes may be in flight at once, saw " + t.maxInFlight);
    /* AT MOST ONE WRITE PER TEN READS PLUS THE REMAINDER — ceil(25/10). A write
       snapshots the cache when the chain reaches it, not when it was asked
       for, so a slow first write lets the second carry everything and the
       third can be a rewrite of the same 25; that is the one redundancy
       allowed. Never fewer than two (the pass did write as it went), never
       shrinking (a snapshot older than the one before it is the race), and
       the last one is what the store holds. */
    const sizes = t.writes.map((k) => k.length);
    assert(ctx, sizes.length >= 2 && sizes.length <= Math.ceil(25 / 10),
      "between 2 and 3 writes for 25 reads, got " + (sizes.join() || "none"));
    assert(ctx, sizes.every((n, i) => i === 0 || n >= sizes[i - 1]),
      "no write may carry fewer records than the one before it: " + sizes.join());
    assert(ctx, sizes[sizes.length - 1] === 25,
      "the last write must carry all 25, got " + sizes[sizes.length - 1]);
    ctx.info = "writes " + sizes.join(" → ") + ", max in flight " + t.maxInFlight;
  }),

  check("mid-pass — listeners do not outlive the pass", async (ctx) => {
    /* A LISTENER LEFT BEHIND IS A CLOSURE OVER A FINISHED PASS. It would keep
       the pass's whole cache object alive for the life of the page, and a
       second pass (`read N more`, a Turbo return) would stack another beside
       it. The ledger counts them; the leaving events after the end are the
       behaviour that must follow. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"], concurrency: 3, scrapeMax: 0 },
      apiRepos: [],
      repos: midPassRepos(25),
    });
    const t = midPass(w);
    await settle(900);
    assert(ctx, readShelves(w.win), "never rendered");
    assert(ctx, t.added === 3,
      "a cold pass should listen for the 3 leaving events, added " + t.added);
    assert(ctx, t.live.length === 0,
      "and remove every one when it ends, still live: " +
      t.live.map((l) => l[1]).join());
    const before = t.writes.length;
    leave(w, "visibilitychange", "hidden");
    leave(w, "pagehide");
    leave(w, "freeze");
    await settle(100);
    assert(ctx, t.writes.length === before,
      "leaving after the pass must not write, wrote " + (t.writes.length - before));
    ctx.info = t.added + " added, " + t.removed + " removed, " +
      (t.writes.length - before) + " writes after the end";
  }),

  check("mid-pass — a warm run writes nothing", async (ctx) => {
    /* NOTHING NEW, NOTHING WRITTEN. The flush counts unsaved reads, so a pass
       whose every row was answered by the cache must not rewrite it — the old
       single write at the end already held to that, and the new ones must not
       break it. */
    const now = Date.now();
    const cache = {};
    midPassRepos(25).forEach((r) => {
      cache["octo/" + r.name] = { at: now, topics: r.topics };
    });
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"], concurrency: 3, scrapeMax: 0 },
      apiRepos: [],
      repos: midPassRepos(25),
      cache,
    });
    const t = midPass(w);
    await settle(900);
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    assert(ctx, w.counters.scraped.length === 0,
      "a warm cache must read no pages, read " + w.counters.scraped.length);
    assert(ctx, t.writes.length === 0,
      "and write no cache, wrote " + t.writes.length);
    const shelf = v && byLabel(v)["keep"];
    assert(ctx, shelf && shelf.count === 12,
      "the cache alone shelves the 12 tagged, got " + (shelf ? shelf.count : "no shelf"));
    ctx.info = "0 read, 0 written, " + (shelf ? shelf.count : 0) + " shelved from cache";
  }),

  check("mid-pass — a rescan during the pass is not written back", async (ctx) => {
    /* WRITING AS IT GOES MADE RESCAN UNDOABLE. The pass holds the whole cache
       in memory, so the reader pressing `rescan` mid-pass emptied the store
       and the pass's next flush — or the pagehide of the reload itself — wrote
       every record straight back. The reload found a warm cache and rescan
       had done nothing at all. Two clears, two worlds: this tab's own rescan
       (the epoch), and the options page's Clear in another context (the store
       seen emptied). */
    const told = [];
    for (const how of ["rescan", "options"]) {
      const w = build({
        viewer: "octo", owner: "octo",
        settings: { groups: ["keep"], concurrency: 3, scrapeMax: 0 },
        apiRepos: [],
        repos: midPassRepos(25),
      });
      const t = midPass(w, { blockAfter: 14 });
      await settle(900);
      assert(ctx, t.writes.length >= 1,
        how + ": the pass has flushed once before the clear, wrote " + t.writes.length);
      const before = t.writes.length;

      if (how === "rescan") {
        await w.win.Shelves.cache.clear();
      } else {
        /* ANOTHER CONTEXT. The options page does not share this tab's epoch;
           all the pass can see is the store change arriving. */
        await new Promise((r) => w.win.chrome.storage.local.set(
          { repoFacts: {}, topicCache: {} }, r));
      }
      await settle(50);
      const cleared = t.writes.length;
      leave(w, "pagehide");
      leave(w, "visibilitychange");
      await settle(100);
      assert(ctx, t.writes.length === cleared,
        how + ": nothing may be written after the clear, wrote " +
        (t.writes.length - cleared) + " more");
      assert(ctx, storedFacts(w).length === 0,
        how + ": the store stays empty, holds " + storedFacts(w).join(", "));
      told.push(how + " " + before + "→0");
    }
    ctx.info = "cleared and kept clear: " + told.join(", ");
  }),

  check("mid-pass — a write that fails is tried again", async (ctx) => {
    /* `set` NEVER THROWS, IT ANSWERS false. The count of unsaved reads was
       zeroed before the write ran, so a write that failed — quota, a torn-down
       port — was believed, and with no further reads nothing ever retried it.
       Four reads, the first leave's write refused, the second leave's must
       carry them. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"], concurrency: 3, scrapeMax: 0 },
      apiRepos: [],
      repos: midPassRepos(25),
    });
    const t = midPass(w, { blockAfter: 4 });
    await settle(700);
    const local = w.win.chrome.storage.local;
    const inner = local.set;
    let refuse = 1;
    local.set = (obj, cb) => {
      if (refuse && obj && "repoFacts" in obj) {
        refuse--;
        t.writes.push(["(refused)"]);
        setTimeout(() => {
          w.win.chrome.runtime.lastError = { message: "QUOTA_BYTES quota exceeded" };
          try { if (cb) cb(); } finally { w.win.chrome.runtime.lastError = null; }
        }, 0);
        return;
      }
      return inner(obj, cb);
    };

    leave(w, "visibilitychange");
    await settle(100);
    assert(ctx, storedFacts(w).length === 0 && t.writes.length === 1,
      "the first write was refused, so nothing is stored yet, holds " + storedFacts(w).length);
    leave(w, "visibilitychange");
    await settle(100);
    assert(ctx, t.writes.length === 2,
      "the next leave must try again, wrote " + (t.writes.length - 1) + " more");
    assert(ctx, storedFacts(w).length === 4,
      "and the 4 reads land on the retry, stored " + storedFacts(w).length);
    ctx.info = "refused once, retried on the next leave, 4 stored";
  }),

  check("mid-pass — the last-chance write does not queue behind a slow one", async (ctx) => {
    /* A FROZEN PAGE RUNS NO MORE TASKS. If the leave write is chained behind a
       periodic write whose storage callback has not come back, it waits on a
       callback that will never run, and the records it exists to save die in
       the queue. The first write here never lands; leaving must still issue
       its own, at once, carrying everything read. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"], concurrency: 3, scrapeMax: 0 },
      apiRepos: [],
      repos: midPassRepos(25),
    });
    const t = midPass(w, { blockAfter: 14 });
    /* STUCK, NOT SLOW: the first write's callback never comes — a long timer
       would keep node alive for as long as it was set for. */
    const local = w.win.chrome.storage.local;
    const counted = local.set;
    let first = true;
    local.set = (obj, cb) => {
      if (first && obj && "repoFacts" in obj) {
        first = false;
        return counted(obj, () => {});   // lands, but its callback is lost
      }
      return counted(obj, cb);
    };
    await settle(900);
    assert(ctx, t.writes.length === 1,
      "the periodic write is issued and its callback lost, writes " + t.writes.length);
    leave(w, "freeze");
    assert(ctx, t.writes.length === 2,
      "leaving must issue its write from the handler, not behind the stuck one, " +
      "writes " + t.writes.length);
    assert(ctx, (t.writes[1] || []).length === 14,
      "and it carries all 14 read, carried " + (t.writes[1] || []).length);
    ctx.info = "first write stuck; freeze wrote " + (t.writes[1] || []).length + " at once";
  }),

  check("mid-pass — a hidden tab writes every read as it lands", async (ctx) => {
    /* A DISCARD SENDS NO EVENT. Chrome discards only hidden tabs, and when it
       does the page simply stops — no pagehide, no freeze, no last-chance
       write. So a hidden pass batching ten at a time could lose up to nine
       records it had already paid for. Hidden, the threshold is one: each read
       is put down as it lands. One read at a time through the gate, and the
       store checked after every one. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"], concurrency: 1, scrapeMax: 0 },
      apiRepos: [],
      repos: midPassRepos(25),
    });
    const t = midPass(w, { gate: true });
    await settle(400);
    assert(ctx, t.queue.length === 1,
      "at concurrency 1 exactly one fetch waits at the gate, waiting " + t.queue.length);

    for (let i = 0; i < 3; i++) { t.release(1); await settle(40); }
    assert(ctx, w.counters.scraped.length === 3 && t.writes.length === 0,
      "3 visible reads are below FLUSH_EVERY and must not write, read " +
      w.counters.scraped.length + ", wrote " + t.writes.length);

    leave(w, "visibilitychange");
    await settle(40);
    assert(ctx, t.writes.length === 1 && storedFacts(w).length === 3,
      "going hidden writes the 3 held, writes " + t.writes.length +
      ", stored " + storedFacts(w).length);

    const steps = [];
    for (let k = 1; k <= 5; k++) {
      const before = t.writes.length;
      t.release(1);
      await settle(40);
      const read = w.counters.scraped.slice().sort();
      const kept = storedFacts(w).sort();
      steps.push(kept.length);
      assert(ctx, read.length === 3 + k,
        "hidden read " + k + ": the pass must have read " + (3 + k) + ", read " + read.length);
      assert(ctx, t.writes.length === before + 1,
        "hidden read " + k + ": must write once of its own, wrote " +
        (t.writes.length - before));
      assert(ctx, kept.join() === read.join(),
        "hidden read " + k + ": the store must hold exactly the " + read.length +
        " read, holds " + kept.length);
    }

    /* BACK IN FRONT, BACK TO BATCHING. A watched tab is in no danger of a
       silent discard, and a write per read there is a storage write per page
       for nothing. */
    leave(w, "visibilitychange", "visible");
    await settle(40);
    const visibleFrom = t.writes.length;
    for (let i = 0; i < 2; i++) { t.release(1); await settle(40); }
    assert(ctx, w.counters.scraped.length === 10,
      "2 more visible reads, read " + w.counters.scraped.length);
    assert(ctx, t.writes.length === visibleFrom,
      "visible again, a read must not write on its own, wrote " +
      (t.writes.length - visibleFrom));
    assert(ctx, storedFacts(w).length === 8,
      "the store still holds the 8 put down while hidden, holds " + storedFacts(w).length);
    ctx.info = "visible 3 → 0 writes; hidden → 3; per read " + steps.join(", ") +
      "; visible +2 → 0 writes";
  }),

  check("mid-pass — a hidden tab's per-read writes never overlap", async (ctx) => {
    /* A WRITE PER READ IS MANY WRITES, and each is the whole object — so
       hidden is where the chain earns its keep. Reads are let through three at
       a time while the previous write is still on its way (30ms, then 5ms,
       alternating, so a later write would overtake an earlier one if they ran
       side by side). None may overlap, none may shrink, and the store must end
       with every record read. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"], concurrency: 3, scrapeMax: 0 },
      apiRepos: [],
      repos: midPassRepos(25),
    });
    const t = midPass(w, { gate: true, delay: (i) => (i % 2 ? 5 : 30) });
    leave(w, "visibilitychange");          // hidden before the first read lands
    await settle(400);
    for (let round = 0; round < 12 && w.counters.scraped.length < 25; round++) {
      t.release(t.queue.length);
      await settle(12);
    }
    await settle(400);

    assert(ctx, w.counters.scraped.length === 25,
      "all 25 are read, read " + w.counters.scraped.length);
    assert(ctx, t.maxInFlight === 1,
      "no two cache writes may be in flight at once, saw " + t.maxInFlight);
    const sizes = t.writes.map((k) => k.length);
    /* NOT A COUNT OF WRITES: the chain rightly folds reads that land behind a
       slow write into the next one, so how many there are is the scheduler's
       business. What batching can never do is write before ten reads. */
    assert(ctx, sizes.length >= 2 && sizes[0] < 10,
      "hidden, the first write must not wait for ten reads, got " +
      (sizes.join() || "none"));
    assert(ctx, sizes.every((n, i) => i === 0 || n >= sizes[i - 1]),
      "no write may carry fewer records than the one before it: " + sizes.join());
    assert(ctx, sizes[sizes.length - 1] === 25 && storedFacts(w).length === 25,
      "the last write and the store hold all 25, last " + sizes[sizes.length - 1] +
      ", stored " + storedFacts(w).length);
    ctx.info = "writes " + sizes.join(" → ") + ", max in flight " + t.maxInFlight;
  }),

  check("cross-tab — the top-up cannot erase a live profile run", async (ctx) => {
    /* THE TOP-UP HELD ITS COPY ACROSS THE PASS'S WRITE. warm.js read the whole
       cache, spent ten seconds fetching, and wrote the whole cache back — so
       everything a cold pass on the profile tab had put down in those ten
       seconds was erased by a tab that never knew it existed. If the profile
       tab then dies (closed, discarded), those reads are gone for good.

       Order: the top-up reads the store while it is still all seeds; the pass
       reads twelve and flushes ten; THEN the top-up's fetches are answered and
       it writes. The moment that matters is right after that write. Run with
       no Locks API and with one, because the merge must hold on its own. */
    const told = [];
    for (const locked of [false, true]) {
      const tag = locked ? "locked" : "no Locks API";
      const p = crossPair(locked);
      await settle(400);
      const run = p.b.win.Shelves.warm(WARM_ON, { gap: 0 });
      await settle(60);
      assert(ctx, p.tb.queue.length === 1 && p.a.counters.scraped.length === 0,
        tag + ": fixture — the top-up must be waiting on its first fetch before the pass " +
        "reads anything, waiting " + p.tb.queue.length + ", pass read " +
        p.a.counters.scraped.length);

      await passReads(p, 12);
      const mid = p.a.store.local.repoFacts || {};
      const flushed = Object.keys(p.ra).filter((k) => mid[k] && mid[k].at === p.ra[k].at);
      assert(ctx, flushed.length >= 10,
        tag + ": fixture — the pass must have flushed its first ten, stored " + flushed.length);

      const out = await warmThrough(p, run);
      assert(ctx, out.warmed === OVERLAP.length + ONLY_WARM.length,
        tag + ": the top-up refreshes all " + (OVERLAP.length + ONLY_WARM.length) +
        " it found stale, got " + JSON.stringify(out));
      /* THE BUG, AT THE INSTANT IT HAPPENED. */
      const after = p.a.store.local.repoFacts || {};
      const erased = flushed.filter((k) => !after[k] || after[k].at < p.ra[k].at);
      assert(ctx, erased.length === 0,
        tag + ": the top-up's write must keep every record the pass had stored, erased " +
        erased.length + " of " + flushed.length + ": " + erased.join());

      await passReads(p, 25);
      await settle(300);
      const v = crossVerdict(ctx, p, tag);
      told.push(tag + ": " + flushed.length + " kept through the top-up, " + v.stored +
        " stored, top-up newer on " + v.byB + " of " + v.both + " shared");
    }
    ctx.info = told.join("; ");
  }),

  check("cross-tab — the profile run cannot erase the top-up's refresh", async (ctx) => {
    /* THE OTHER ORDER, AND THE LONGER WINDOW. The pass read its copy when it
       began — minutes ago, on a big account — and every flush wrote that
       copy back whole, so a top-up that ran in another tab meanwhile was
       quietly reverted to the seeds it had just replaced. Sharper still: m10
       and m11 are read by the pass and NOT YET WRITTEN when the top-up
       refreshes them, so the pass's later flush is an OLDER read of the same
       repo arriving second. Newer `at` must win, not later write. */
    const told = [];
    for (const locked of [false, true]) {
      const tag = locked ? "locked" : "no Locks API";
      const p = crossPair(locked);
      await settle(400);
      await passReads(p, 12);
      const mid = p.a.store.local.repoFacts || {};
      const unsaved = ["octo/m10", "octo/m11"].filter((k) => p.ra[k] && mid[k] &&
                                                       mid[k].description === "a stale seed");
      assert(ctx, unsaved.length === 2,
        tag + ": fixture — m10 and m11 must be read by the pass and not yet stored, got " +
        unsaved.join());

      const out = await warmThrough(p, p.b.win.Shelves.warm(WARM_ON, { gap: 0 }));
      /* m00/m01 the pass already stored fresh, so they are not due: 9 - 2. */
      assert(ctx, out.warmed === 7 && p.rb["octo/m10"] && p.rb["octo/x1"],
        tag + ": the top-up refreshes the 7 still stale, m10 among them, got " +
        JSON.stringify(out));
      /* By name: the repo page B stands on is parsed too, and is no refresh. */
      const landed = Object.keys(p.rb).filter((k) => /^octo\/[mx]\d+$/.test(k) &&
        (p.a.store.local.repoFacts[k] || {}).at === p.rb[k].at);

      await passReads(p, 25);
      await settle(300);
      const fin = p.a.store.local.repoFacts || {};
      const reverted = landed.filter((k) => !fin[k] || fin[k].at < p.rb[k].at);
      assert(ctx, reverted.length === 0,
        tag + ": no later flush of the pass may take back a newer refresh, reverted " +
        reverted.length + " of " + landed.length + ": " + reverted.join());
      const v = crossVerdict(ctx, p, tag);
      told.push(tag + ": " + landed.length + " refreshed, " + reverted.length +
        " reverted, top-up newer on " + v.byB + " of " + v.both + " shared");
    }
    ctx.info = told.join("; ");
  }),

  check("cross-tab — a slow older write does not clobber a newer record", async (ctx) => {
    /* LATER IS NOT NEWER. A put carries what its writer READ, and a writer
       that read a page a minute ago can reach the store after one that read it
       a second ago. Per key the newer `at` wins, whichever arrives second.

       Then the same race with the older write genuinely in flight while the
       newer one is issued. Locked, the second waits for the first to land and
       merges onto it. Unlocked it is the narrow window the lock exists to
       close — one storage round-trip — and the scenario says which way it
       went rather than pretending the merge alone covers it. */
    const told = [];
    for (const locked of [false, true]) {
      const tag = locked ? "locked" : "no Locks API";
      const { a, b } = twoTabs(locked);
      await settle(300);
      const SA = a.win.Shelves;
      const SB = b.win.Shelves;
      const T = Date.now();
      const rec = (at, d) => ({ at, topics: [d], description: d });

      const k = "octo/kit";
      await SB.cache.put({ [k]: rec(T, "newer") }, WARM_ON);
      const late = await SA.cache.put({ [k]: rec(T - 60000, "older") }, WARM_ON);
      const got = (a.store.local.repoFacts || {})[k] || {};
      assert(ctx, late !== false && got.at === T && got.description === "newer",
        tag + ": an older read arriving second must not replace the newer one, store holds " +
        JSON.stringify(got.description) + " (put said " + late + ")");

      const k2 = "octo/kit-two";
      slowStorage([a], ["repoFacts"], 150);
      const pa = SA.cache.put({ [k2]: rec(T - 60000, "older") }, WARM_ON);
      await settle(20);
      const pb = SB.cache.put({ [k2]: rec(T, "newer") }, WARM_ON);
      await Promise.all([pa, pb]);
      await settle(50);
      const got2 = (a.store.local.repoFacts || {})[k2] || {};
      if (locked) {
        assert(ctx, got2.description === "newer",
          tag + ": with the lock, a newer put issued while an older one is landing must " +
          "survive it, store holds " + JSON.stringify(got2.description));
      }
      const kept = (a.store.local.repoFacts || {})[k] || {};
      assert(ctx, kept.description === "newer",
        tag + ": and the first key must be untouched by the second race, holds " +
        JSON.stringify(kept.description));
      told.push(tag + ": arrived-second older lost; in flight → " + got2.description);
    }
    ctx.info = told.join("; ");
  }),

  check("cross-tab — two tabs pinning and noting at once keep both", async (ctx) => {
    /* THE SMALL STORES HAD THE SAME SHAPE. pins.toggle, notes.set and
       overrides.set each read the whole map, changed one key and wrote the
       whole map back — so two tabs doing it in the same storage round-trip
       kept one tab's change and silently dropped the other's. Rarer than the
       fact cache, and worse when it happens: a note is the reader's own words
       and nothing re-derives it.

       Writes are slowed (they LAND 60ms late) and all six are fired without
       waiting. With one lock manager on both tabs, each read-modify-write must
       run alone and all six must survive. Without one, nothing closes the
       round-trip — the overlap witness must see the race happen (or this
       fixture proves nothing), and what survives is reported, not asserted. */
    const told = [];
    const KEYS = ["pins", "notes", "overrides"];
    for (const locked of [true, false]) {
      const tag = locked ? "locked" : "no Locks API";
      const { a, b, locks } = twoTabs(locked);
      await settle(300);
      const rmw = slowStorage([a, b], KEYS, 60);
      rmw.armed = true;
      const SA = a.win.Shelves;
      const SB = b.win.Shelves;
      const res = await Promise.all([
        SA.pins.toggle("octo/from-a", 1), SB.pins.toggle("octo/from-b", 2),
        SA.notes.set("octo/from-a", "a's note"), SB.notes.set("octo/from-b", "b's note"),
        SA.overrides.set("octo/from-a", "shelf-a"), SB.overrides.set("octo/from-b", "shelf-b"),
      ]);
      await settle(100);
      const L = a.store.local;
      const have = KEYS.map((k) => ["octo/from-a", "octo/from-b"]
        .filter((r) => L[k] && L[k][r]).length);
      const kept = have.reduce((s, n) => s + n, 0);
      const overlaps = KEYS.reduce((s, k) => s + (rmw.overlaps[k] || 0), 0);
      if (locked) {
        assert(ctx, res.every((r) => r && r.ok),
          tag + ": every write must report ok, got " + res.map((r) => r && r.ok).join());
        assert(ctx, kept === 6,
          tag + ": all six must survive (pins/notes/overrides " + have.join("/") + " of 2/2/2)");
        assert(ctx, overlaps === 0,
          tag + ": no tab may read a store while another's write to it is still landing, " +
          "overlaps " + JSON.stringify(rmw.overlaps));
        const via = KEYS.map((k) => (locks.stats.grants["shelves:" + k] || 0));
        const most = KEYS.map((k) => (locks.stats.maxHeld["shelves:" + k] || 0));
        assert(ctx, via.every((n) => n === 2) && most.every((n) => n === 1),
          tag + ": each store's two writes must each take its lock, one at a time — grants " +
          via.join("/") + ", most held at once " + most.join("/"));
        assert(ctx, L.notes["octo/from-a"] === "a's note" && L.overrides["octo/from-b"] === "shelf-b",
          tag + ": and the values are each tab's own");
      } else {
        assert(ctx, overlaps > 0,
          tag + ": fixture — unlocked, the writes must genuinely overlap or this proves " +
          "nothing, overlaps " + JSON.stringify(rmw.overlaps));
      }
      told.push(tag + ": kept " + kept + "/6 (" + have.join("/") + "), overlaps " + overlaps);
    }
    ctx.info = told.join("; ");
  }),

  check("cross-tab — a held lock never blocks a write", async (ctx) => {
    /* THE LOCK IS AN AID, NEVER A GATE. A page script shares the github.com
       origin and can take the very name store.js uses; a frozen tab can sit on
       it. Here something holds "shelves:notes" and never lets go. The note
       must still land — after the bounded wait, about two seconds — and a
       store with a different lock must not wait at all. */
    const locks = makeLocks();
    const w = build({ viewer: "octo", owner: "octo", clone: true, locks,
                      at: "octo/one", page: { topics: [] }, repos: [] });
    await settle(300);
    const S = w.win.Shelves;
    locks.request("shelves:notes", () => new Promise(() => {}));   // never released

    const p0 = Date.now();
    const pin = await S.pins.toggle("octo/elsewhere", 1);
    const pinMs = Date.now() - p0;
    assert(ctx, pin.ok && pinMs < 500,
      "a different store's lock is free, so a pin must not wait, took " + pinMs + "ms");

    const t0 = Date.now();
    const r = await S.notes.set("octo/held", "written anyway");
    const ms = Date.now() - t0;
    assert(ctx, r && r.ok && (w.store.local.notes || {})["octo/held"] === "written anyway",
      "the note must land even with its lock held forever, got " + JSON.stringify(r && r.ok) +
      " / " + JSON.stringify((w.store.local.notes || {})["octo/held"]));
    assert(ctx, ms >= 1500 && ms < 4000,
      "after the bounded wait — it must try the lock (~2s), and never wait unbounded, took " +
      ms + "ms");
    assert(ctx, (locks.stats.aborted["shelves:notes"] || 0) === 1 &&
                (locks.stats.waiting["shelves:notes"] || 0) === 0,
      "and the abandoned request must be withdrawn, not left queued behind the holder, " +
      "aborted " + locks.stats.aborted["shelves:notes"] + ", waiting " +
      locks.stats.waiting["shelves:notes"]);
    ctx.info = "pin " + pinMs + "ms; held note landed after " + ms + "ms";
  }),

  check("cross-tab — the leaving write keeps an in-flight put's records", async (ctx) => {
    /* TWO WRITES FROM ONE TAB, EITHER ORDER. The pass's batch `put` waits on a
       read (and a lock); the leaving handler cannot wait for anything, so its
       `putNow` goes straight out on the mirror. Each carries only part of what
       the tab has read — and whichever lands second would otherwise erase the
       other's part.

       STILL READING: the put's read is slow, so `putNow` lands FIRST and the
       put, landing last, must carry the leaving records it was handed.
       WRITTEN, UNACKNOWLEDGED: the put's write is in storage but its callback
       has not come back, so it is still pending when `putNow` goes — which
       lands last and must carry the put's batch. */
    const told = [];
    for (const how of ["still reading", "written, unacknowledged"]) {
      const w = build({
        viewer: "octo", owner: "octo", clone: true,
        settings: { groups: ["keep"], concurrency: 1, scrapeMax: 0 },
        apiRepos: [],
        repos: midPassRepos(25),
      });
      const t = midPass(w, { gate: true });
      await settle(400);
      const local = w.win.chrome.storage.local;
      let armed = true;
      if (how === "still reading") {
        const getReal = local.get;
        local.get = (d, cb) => {
          if (!armed || !d || !("repoFacts" in d)) return getReal(d, cb);
          armed = false;
          return getReal(d, (out) => setTimeout(() => cb(out), 250));
        };
      } else {
        const setNext = local.set;   // midPass's ledger, which lands it at once
        local.set = (obj, cb) => {
          if (!armed || !obj || !("repoFacts" in obj)) return setNext(obj, cb);
          armed = false;
          return setNext(obj, () => setTimeout(() => cb && cb(), 250));
        };
      }
      for (let i = 0; i < 10; i++) { t.release(1); await settle(25); }
      assert(ctx, !armed,
        how + ": fixture — the tenth read must have started the batch put");
      for (let i = 0; i < 3; i++) { t.release(1); await settle(25); }
      const before = t.writes.length;
      leave(w, "visibilitychange");
      await settle(500);
      const read = w.counters.scraped.slice().sort();
      const kept = storedFacts(w).sort();
      const lost = read.filter((k) => !kept.includes(k));
      assert(ctx, read.length === 13,
        how + ": fixture — 13 read before leaving, read " + read.length);
      assert(ctx, t.writes.length - before >= 1 && t.writes.length >= 2,
        how + ": both writes must have gone out, " + t.writes.length + " in all");
      assert(ctx, lost.length === 0,
        how + ": the store must hold every record read, whichever write landed last — " +
        "lost " + lost.length + ": " + lost.join() + " (writes " +
        t.writes.map((k) => k.length).join(" → ") + ")");
      told.push(how + ": writes " + t.writes.map((k) => k.length).join(" → ") +
        ", stored " + kept.length + "/13");
    }
    ctx.info = told.join("; ");
  }),

  check("cross-tab — a sent write that lands after the leaving one puts it back", async (ctx) => {
    /* THE ONE ORDER THE HAND-OFF CANNOT COVER. Once a `put` has computed its
       merge and sent its write, a `putNow` can no longer ride inside it — and
       if that sent write lands SECOND it erases the leaving records. Real
       chrome delivers one tab's writes in order, so this is the paranoid
       case; it is still a case, and a page alive to see the late write land
       is alive to write once more. */
    const w = build({ viewer: "octo", owner: "octo", clone: true, at: "octo/one",
                      page: { topics: [] }, repos: [] });
    await settle(300);
    const S = w.win.Shelves;
    const local = w.win.chrome.storage.local;
    const real = local.set;
    let first = true;
    local.set = (o, cb) => {
      if (first && o && o.repoFacts) {
        first = false;
        setTimeout(() => real(o, cb), 200);       // sent now, lands last
      } else real(o, cb);
    };
    const now = Date.now();
    const p = S.cache.put({ "octo/a": { at: now, topics: [] } }, { cacheDays: 7 });
    await settle(30);
    await S.cache.putNow({ "octo/b": { at: now, topics: [] } }, { cacheDays: 7 });
    await p;
    await settle(80);
    const kept = Object.keys(w.store.local.repoFacts || {}).sort();
    assert(ctx, kept.join() === "octo/a,octo/b",
      "both the batch and the leaving record must survive the reorder, stored: " + kept.join());
    ctx.info = "late write landed second; stored " + kept.join();
  }),

  check("token-fallback — a dead token falls back to the public API, not to 76 page reads",
    async (ctx) => {
    /* THIS BRANCH USED TO SET THE LABEL AND SKIP THE REQUEST. On a 401 it
       wrote `source = "api (public)"` and stopped: the public endpoint was
       never asked, so the sentence the whole product stakes its trust on named
       a rung that had not run, and every repo fell through as missing — one
       expired token turning a one-request page into a page that reads every
       repository you own, one at a time.

       `apiPublic` is what lets the fixture say it: the token door answers 401,
       the public door answers normally. */
    const w = build({
      viewer: "octo",
      owner: "octo",
      token: "github_pat_EXPIRED",
      settings: { groups: ["aiproject"] },
      apiRepos: 401,
      apiPublic: [
        { name: "pubtool", topics: ["aiproject"] },
        { name: "pubdocs", topics: [] },
      ],
      repos: [
        { name: "pubtool", topics: ["aiproject"] },
        { name: "pubdocs", topics: [] },
        { name: "secret", topics: ["aiproject"], private: true },
      ],
    });
    await settle(1400);
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;

    assert(ctx, /rejected \(401\)/.test(v.warn || ""),
      "the dead token is still said out loud, got: " + v.warn);
    assert(ctx, /api \(public\)/.test(v.note),
      "the source line names the rung that actually answered, got: " + v.note);

    /* TWO CALLS, NOT ONE: the rejected one and the retry. A single call would
       mean the label was written without the request behind it. */
    assert(ctx, w.counters.api === 2,
      "the public endpoint must actually be asked, api calls: " + w.counters.api);
    assert(ctx, w.counters.lastAuth === false,
      "and the retry must carry no credential");

    /* THE POINT OF ALL OF IT: only what the public API genuinely cannot see
       reaches rung 4. Before this, all three were scraped. */
    assert(ctx, w.counters.scraped.length === 1 &&
                w.counters.scraped[0] === "octo/secret",
      "only the private repo should be read one page at a time, scraped: " +
      w.counters.scraped.join());

    const b = byLabel(v);
    assert(ctx, b.aiproject && b.aiproject.count === 2,
      "and the shelving is still right, got: " + ((b.aiproject || {}).count));
    ctx.info = v.note + "  |  2 api calls, 1 scrape instead of 3";
  }),

  check("no chips, no token — public API + repo-page scraping", async (ctx) => {
    const w = build({
      owner: "octo",
      settings: { groups: ["aiproject"] },
      repos: [
        { name: "pubtool", topics: ["config"] },
        { name: "secret-ai", topics: ["aiproject"], private: true },
        { name: "secret-ai-2", topics: ["aiproject", "python"], private: true },
        { name: "random", topics: [], private: true },
      ],
      apiRepos: [
        { name: "pubtool", topics: ["config"] },
        { name: "secret-ai", topics: ["aiproject"], private: true },
        { name: "secret-ai-2", topics: ["aiproject", "python"], private: true },
        { name: "random", topics: [], private: true },
      ],
    });
    await settle(1200);
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    const b = byLabel(v);
    assert(ctx, b.aiproject, "no aiproject shelf — private topics never resolved");
    assert(ctx, b.aiproject && b.aiproject.count === 2, "aiproject should hold both private repos");
    assert(ctx, w.counters.lastAuth === false, "must not send an Authorization header");
    assert(ctx, w.counters.scraped.length === 3, "should scrape the 3 repos the public API cannot see");
    assert(ctx, /repo pages/.test(v.note), "source should name repo pages, got: " + v.note);
    ctx.info = v.note + "  |  scraped " + w.counters.scraped.length;
  }),

  check("no chips, with token — one API call, no scraping", async (ctx) => {
    const w = build({
      owner: "octo",
      token: "github_pat_FAKE",
      settings: { groups: ["aiproject"] },
      repos: [
        { name: "pubtool", topics: ["config"] },
        { name: "secret-ai", topics: ["aiproject"], private: true },
        { name: "secret-ai-2", topics: ["aiproject"], private: true },
        { name: "random", topics: [], private: true },
      ],
      apiRepos: [
        { name: "pubtool", topics: ["config"] },
        { name: "secret-ai", topics: ["aiproject"], private: true },
        { name: "secret-ai-2", topics: ["aiproject"], private: true },
        { name: "random", topics: [], private: true },
      ],
    });
    await settle();
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    const b = byLabel(v);
    assert(ctx, b.aiproject && b.aiproject.count === 2, "aiproject should hold 2");
    assert(ctx, w.counters.lastAuth === true, "token must be sent as a Bearer header");
    assert(ctx, w.counters.scraped.length === 0, "a token must make repo-page scraping unnecessary");
    assert(ctx, /token/.test(v.note), "source should name the token, got: " + v.note);
    ctx.info = v.note + "  |  api calls " + w.counters.api;
  }),

  check("pagination — page 2 repos are shelved, pager hidden", async (ctx) => {
    const w = build({
      owner: "octo",
      settings: { groups: ["aiproject"] },
      repos: [{ name: "one", chips: ["aiproject"] }],
      page2: [
        { name: "two", chips: ["aiproject"] },
        { name: "three", chips: [] },
      ],
    });
    await settle();
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    const b = byLabel(v);
    assert(ctx, b.aiproject && b.aiproject.count === 2, "page-2 repo missing from its shelf");
    assert(ctx, b.aiproject && b.aiproject.repos.includes("two"), "'two' should be shelved");
    assert(ctx, w.counters.pages.length === 1, "page 2 was never fetched");
    const pager = w.win.document.querySelector(".paginate-container");
    assert(ctx, pager && pager.style.display === "none", "pager must be hidden after merging");
    const total = v.shelves.reduce((n, s) => n + s.count, 0);
    assert(ctx, total === 3, "counts must sum to 3, got " + total);
    ctx.info = v.note;
  }),

  check("idempotence — a second pass must not nest", async (ctx) => {
    const w = build({
      owner: "octo",
      settings: { groups: ["aiproject"] },
      repos: [
        { name: "a", chips: ["aiproject"] },
        { name: "b", chips: [] },
      ],
    });
    await settle();
    // Everything that can trigger a second pass, at once.
    w.win.document.dispatchEvent(new w.win.Event("turbo:render"));
    w.win.document.dispatchEvent(new w.win.Event("pjax:end"));
    w.win.document.body.appendChild(w.win.document.createElement("div")); // wake the observer
    await settle();

    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    assert(ctx, v.hostCount === 1, "expected exactly one host, got " + v.hostCount);
    assert(ctx, !v.nested, "shelves nested inside shelves");
    const total = v.shelves.reduce((n, s) => n + s.count, 0);
    assert(ctx, total === 2, "repos duplicated across passes: " + total);
    ctx.info = v.hostCount + " host, " + total + " repos, no nesting";
  }),

  check("turbo back — snapshot restore is rebuilt live", async (ctx) => {
    /* SHELVE, CLICK A REPO, PRESS BACK. Turbo restores the body it cloned on
       the way out, and a clone has every element and not one listener. The
       page looked exactly right and nothing on it answered: the find box, the
       buttons, the keys, the grips and the notes were all a picture of the
       page the reader left. `run()` saw `#shelves-host` and went home, and so
       did the observer, because "a host is on the page" was the whole of the
       idempotence check and a corpse IS a host on the page.

       Two halves, asserted separately. The SNAPSHOT should be GitHub's own
       list — what Turbo caches is a page we must later be able to shelve from
       scratch, so it must not contain a host at all. And the RESTORED page
       must be live, which only pressing things can show. */
    const w = build({
      owner: "octo",
      settings: { groups: ["keep", "tools"] },
      repos: TURBO_REPOS,
    });
    await settle();
    const before = readShelves(w.win);
    assert(ctx, before, "never rendered");
    if (!before) return;
    const fBefore = furniture(w.win);
    const shelvedBefore = before.shelves.reduce((n, s) => n + s.count, 0);
    assert(ctx, shelvedBefore === 4, "four repos shelved to begin with, got " + shelvedBefore);

    const snap = turboLeave(w.win);
    await settle(300);

    /* WHAT WAS CACHED. GitHub's <ul>, every row in it, nothing of ours. */
    assert(ctx, !snap.querySelector("#shelves-host"),
      "the cached snapshot must not contain #shelves-host — a cloned host is a " +
      "corpse waiting to be restored");
    const list = snap.querySelector("#user-repositories-list ul");
    const cachedRows = list
      ? [...list.children].filter((n) => n.tagName === "LI")
          .map((li) => (li.querySelector("h3 a") || {}).textContent)
      : [];
    assert(ctx, cachedRows.join() === TURBO_REPOS.map((r) => r.name).join(),
      "the snapshot holds GitHub's list with every row in its original order, got: " +
      JSON.stringify(cachedRows));
    assert(ctx, list && list.dataset.shelvesDone === undefined,
      "and the list is not flagged consumed, or the finder will refuse it on restore");
    assert(ctx, !snap.querySelector(".sh-hide, .sh-margin, .sh-bar, #sh-status"),
      "and carries none of our furniture: " +
      [...snap.querySelectorAll(".sh-hide, .sh-margin, .sh-bar, #sh-status")]
        .map((e) => e.className || e.id).slice(0, 5).join(", "));

    turboBack(w.win, snap);
    await settle();

    const v = readShelves(w.win);
    assert(ctx, v, "nothing shelved after Back");
    if (!v) return;
    assert(ctx, v.hostCount === 1, "exactly one host after Back, got " + v.hostCount);
    const shelvedAfter = v.shelves.reduce((n, s) => n + s.count, 0);
    assert(ctx, shelvedAfter === shelvedBefore,
      "the same " + shelvedBefore + " repos shelved after Back, got " + shelvedAfter);
    assert(ctx, v.names.slice().sort().join() === before.names.slice().sort().join(),
      "and the same repos, got: " + v.names.join());
    const f = furniture(w.win);
    assert(ctx, f.bars === 1 && f.finds === 1,
      "one toolbar and one find box, got " + f.bars + " bars, " + f.finds + " boxes");
    assert(ctx, f.margin === fBefore.margin && f.move === fBefore.move && f.sibs <= 1,
      "no row carries its furniture twice: margins " + f.margin + " (was " +
      fBefore.margin + "), grips " + f.move + " (was " + fBefore.move + "), sibling strips " + f.sibs);

    await assertLive(ctx, w, TURBO_LIVE);
    ctx.info = "snapshot: GitHub's " + cachedRows.length + " rows, no host · after Back: " +
      v.hostCount + " live host, " + shelvedAfter + " repos";
  }),

  check("turbo back — a filter active at cache time does not hide rows",
    async (ctx) => {
    /* THE CLASS RIDES THE ROW. `sh-hide` is on each <li>, and a clone copies
       it faithfully — so a page cached mid-search came back with rows missing
       and nothing on screen explaining why, or with a find box that said one
       thing while the rows obeyed another. Whatever the page shows after Back,
       the box and the rows must AGREE, and clearing the box must give every
       row back. */
    const w = build({
      owner: "octo",
      settings: { groups: ["keep", "tools"] },
      repos: TURBO_REPOS,
    });
    await settle();
    type(w.win, "wire");
    let v = readShelves(w.win);
    assert(ctx, v && /2 of 4/.test(v.found), "the filter applies before Back, got: " +
      (v && v.found));
    assert(ctx, w.win.document.querySelectorAll("li.sh-hide").length === 2,
      "two rows hidden before Back");

    const snap = turboLeave(w.win);
    assert(ctx, !snap.querySelector(".sh-hide"),
      "a row hidden by our filter must not be cached hidden, " +
      snap.querySelectorAll(".sh-hide").length + " are");
    await settle(300);
    turboBack(w.win, snap);
    await settle();

    v = readShelves(w.win);
    assert(ctx, v, "nothing shelved after Back");
    if (!v) return;
    assert(ctx, v.hostCount === 1, "exactly one host, got " + v.hostCount);
    const hidden = w.win.document.querySelectorAll("li.sh-hide").length;
    /* TWO HONEST ANSWERS AND ONE DISHONEST ONE. The reader's query may come
       back with the page — the JS context kept `S.lastFilter`, exactly as a
       GitHub dropdown does — or the page may come back unfiltered. Either is a
       page that says what it is doing. Hidden rows beside an empty box is not. */
    if (!v.find.value) {
      assert(ctx, hidden === 0,
        "the find box is empty, so no row may be hidden — " + hidden + " are");
      assert(ctx, v.found === "", "and the found line is blank, got: " + v.found);
    } else {
      assert(ctx, v.find.value === "wire",
        "a restored query is the one the reader typed, got: " + v.find.value);
      assert(ctx, /2 of 4/.test(v.found) &&
        v.visible.slice().sort().join() === "wire-a,wire-b",
        "and it is applied to these rows, found " + v.found + ", visible " +
        v.visible.join());
    }

    /* AND THE BOX MUST WORK. On a corpse, emptying it leaves the rows exactly
       as hidden as the clone left them — which IS the reported bug. */
    type(w.win, "");
    v = readShelves(w.win);
    const still = w.win.document.querySelectorAll("li.sh-hide").length;
    assert(ctx, still === 0,
      "an empty find box hides nothing — " + still + " rows still carry sh-hide");
    const total = v.shelves.reduce((n, s) => n + s.count, 0);
    assert(ctx, total === 4 && v.visible.length === 4,
      "the counts are the full count again, shelved " + total + ", visible " +
      v.visible.length);
    ctx.info = "after Back: box " + JSON.stringify(readShelves(w.win).find.value) +
      ", " + still + " hidden, " + total + " shelved";
  }),

  check("turbo back — a stale clone with no before-cache is still rebuilt",
    async (ctx) => {
    /* THE BELT AND THE BRACES. A snapshot can be taken without our
       before-cache listener having had its say — a different Turbo, a
       listener that threw, a page cached by something that is not Turbo at
       all — and then a cloned host comes back. "A host is on the page" cannot
       be the whole test: a host this script did not build in this context is
       stale, and stale is rebuilt over, not trusted. The clone's rows already
       wear our stamps and our margins, which is the trap: a rebuild that
       believes `data-sh-margin` keeps a dead margin and a dead grip. */
    const w = build({
      owner: "octo",
      settings: { groups: ["keep", "tools"] },
      repos: TURBO_REPOS,
    });
    await settle();
    const before = readShelves(w.win);
    assert(ctx, before, "never rendered");
    if (!before) return;
    const fBefore = furniture(w.win);

    const snap = turboLeave(w.win, { cache: false });
    assert(ctx, snap.querySelector("#shelves-host"),
      "the fixture must cache a host for this scenario to mean anything");
    await settle(300);
    /* No before-cache on the way back either: the whole round trip happens
       without our listener. */
    w.win.history.pushState({}, "", "/octo?tab=repositories");
    w.win.document.body.replaceWith(snap.cloneNode(true));
    w.win.document.dispatchEvent(new w.win.Event("turbo:render"));
    await settle();

    const v = readShelves(w.win);
    assert(ctx, v, "nothing shelved after Back");
    if (!v) return;
    assert(ctx, v.hostCount === 1, "exactly one host, got " + v.hostCount);
    assert(ctx, !v.nested, "the rebuild must not nest a host inside the stale one");
    const total = v.shelves.reduce((n, s) => n + s.count, 0);
    assert(ctx, total === 4, "every repo still shelved, got " + total);
    assert(ctx, v.names.slice().sort().join() === before.names.slice().sort().join(),
      "and no row lost or duplicated, got: " + v.names.join());
    const f = furniture(w.win);
    assert(ctx, f.rows === 4, "four rows in the host, got " + f.rows);
    assert(ctx, f.bars === 1 && f.finds === 1 && f.status === 0,
      "one toolbar, one find box, no leftover status line, got " + f.bars +
      " bars, " + f.finds + " boxes, " + f.status + " status");
    assert(ctx, f.margin === fBefore.margin && f.move === fBefore.move && f.sibs <= 1,
      "no row carries its furniture twice: margins " + f.margin + ", grips " +
      f.move + ", sibling strips " + f.sibs);

    await assertLive(ctx, w, TURBO_LIVE);
    ctx.info = "after a Back with no before-cache: " + v.hostCount + " host, " + total +
      " repos, " + f.margin + " margin per row";
  }),

  check("turbo back — merged pages are not shelved twice", async (ctx) => {
    /* PAGE TWO IS FETCHED, NOT RENDERED. Its rows were merged into the host
       and GitHub's pager hidden; a snapshot that put them back into page one's
       <ul> and un-hid the pager would hand the rebuild page two TWICE — once
       as rows on the list, once again from `fetchRestOfPages`. A repository
       on two shelves, or one shelf counting it twice, is the failure. */
    const w = build({
      owner: "octo",
      settings: { groups: ["keep"], fetchAllPages: true },
      repos: [{ name: "one", chips: ["keep"] }, { name: "two", chips: [] }],
      page2: [{ name: "three", chips: ["keep"] }],
    });
    await settle();
    const before = readShelves(w.win);
    assert(ctx, before, "never rendered");
    if (!before) return;
    assert(ctx, before.names.length === 3, "three rows across two pages, got " +
      before.names.join());

    const snap = turboLeave(w.win);
    assert(ctx, !snap.querySelector("#shelves-host"), "the snapshot holds no host");
    await settle(300);
    turboBack(w.win, snap);
    await settle();

    const v = readShelves(w.win);
    assert(ctx, v, "nothing shelved after Back");
    if (!v) return;
    assert(ctx, v.hostCount === 1, "exactly one host, got " + v.hostCount);
    const names = v.names.slice().sort();
    assert(ctx, names.join() === "octo/one,octo/three,octo/two",
      "each repo exactly once after Back, got: " + names.join());
    const total = v.shelves.reduce((n, s) => n + s.count, 0);
    assert(ctx, total === 3, "counts sum to 3, got " + total);
    const pager = w.win.document.querySelector(".paginate-container");
    assert(ctx, pager && pager.style.display === "none",
      "and the pager is hidden again, since page two is merged again");
    ctx.info = "after Back: " + names.length + " rows, " + total + " shelved, " +
      w.counters.pages.length + " page-2 fetches";
  }),

  check("cache — a warm cache costs zero repo-page fetches", async (ctx) => {
    const warm = {};
    const now = Date.now();
    ["octo/secret-ai", "octo/secret-ai-2", "octo/random"].forEach((n, i) => {
      warm[n] = { at: now, topics: i < 2 ? ["aiproject"] : [] };
    });
    const w = build({
      owner: "octo",
      settings: { groups: ["aiproject"] },
      cache: warm,
      repos: [
        { name: "pubtool", topics: ["config"] },
        { name: "secret-ai", topics: ["aiproject"], private: true },
        { name: "secret-ai-2", topics: ["aiproject"], private: true },
        { name: "random", topics: [], private: true },
      ],
      apiRepos: [{ name: "pubtool", topics: ["config"] }],
    });
    await settle();
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    const b = byLabel(v);
    assert(ctx, b.aiproject && b.aiproject.count === 2, "cached topics should still shelve 2");
    assert(ctx, w.counters.scraped.length === 0,
      "a warm cache must fetch no repo pages, fetched " + w.counters.scraped.length);
    assert(ctx, /cached/.test(v.note), "a warm run must say so, got: " + v.note);

    /* A CACHE WRITTEN BY THE OLD VERSION IS STILL A WARM CACHE. `{at, topics}`
       is a fact record with nine absent fields, so it is adopted rather than
       discarded — the alternative is that upgrading the extension silently
       costs everybody seventy-six requests for facts it already had. */
    const w2 = build({
      owner: "octo",
      settings: { groups: ["aiproject"] },
      legacyCache: warm,            // seeded under the OLD key, topicCache
      repos: [
        { name: "secret-ai", topics: ["aiproject"], private: true },
        { name: "random", topics: [], private: true },
      ],
      apiRepos: [],
    });
    await settle();
    const v2 = readShelves(w2.win);
    assert(ctx, v2 && byLabel(v2).aiproject && byLabel(v2).aiproject.count === 1,
      "an old topicCache must still shelve");
    assert(ctx, w2.counters.scraped.length === 0,
      "and must cost no re-fetch, fetched " + w2.counters.scraped.length);
    ctx.info = v.note + "  |  scraped " + w.counters.scraped.length +
      "  |  legacy cache adopted, " + w2.counters.scraped.length + " re-fetched";
  }),

  check("token rejected (401) — says so, still renders", async (ctx) => {
    const w = build({
      owner: "octo",
      token: "github_pat_EXPIRED",
      settings: { groups: ["aiproject"] },
      apiRepos: 401,
      repos: [
        { name: "secret-ai", topics: ["aiproject"], private: true },
        { name: "random", topics: [], private: true },
      ],
    });
    await settle(1200);
    const v = readShelves(w.win);
    assert(ctx, v, "a rejected token must never cost the render");
    if (!v) return;
    assert(ctx, /rejected/.test(v.warn), "the rejection must be visible, warn=" + JSON.stringify(v.warn));
    const b = byLabel(v);
    assert(ctx, b.aiproject && b.aiproject.count === 1,
      "must fall through to repo pages and still shelve");
    const total = v.shelves.reduce((n, s) => n + s.count, 0);
    assert(ctx, total === 2, "every repo must still be on the page, got " + total);
    /* `.sh-note` already CONTAINS the warning — view.js appends it there — so
       adding v.warn printed the rejection twice. Harmless until the fallback
       made the sentence two clauses long and the line read as four. */
    ctx.info = v.note;
  }),

  /* ── A RATE LIMIT IS NOT A REJECTION ─────────────────────────────────────
     Every 401 AND 403 used to read "token rejected", and then re-asked the
     public door on the same spent quota — the toolbar said "token rejected
     (403) · api unavailable" about a token with nothing wrong with it, for a
     second request that could not succeed. These pin the distinction from
     both sides: a limit names its reset and asks once; a 403 with no limit
     headers is still a refusal and still gets its public retry. */
  check("rate limit on the token door — says when, asks once", async (ctx) => {
    const w = build({ owner: "octo", token: "github_pat_FINE",
                      settings: { groups: ["aiproject"] },
                      apiRepos: SPENT, repos: RATE_REPOS });
    await settle(1200);
    const want = new RegExp("rate limit — retry after " + hhmm(RESET_AT * 1000));
    const v = rateVerdict(ctx, w, { re: /rate limit — retry after \d\d:\d\d/,
                                    not: [/rejected/, /api unavailable/], calls: 1 });
    if (!v) return;
    assert(ctx, want.test(v.warn || ""), "the reset must be the local clock, got " + v.warn);
    assert(ctx, !w.counters.calls.some((c) => c.auth === false),
      "a rate limit must not re-ask the public door, calls " + JSON.stringify(w.counters.calls));
    ctx.info = v.note;
  }),
  check("rate limit 429 with retry-after — same sentence, one request", async (ctx) => {
    const w = build({ owner: "octo", token: "github_pat_FINE",
                      settings: { groups: ["aiproject"] },
                      apiRepos: { status: 429, headers: { "retry-after": "60" } },
                      repos: RATE_REPOS });
    await settle(1200);
    const v = rateVerdict(ctx, w, { re: /rate limit — retry after \d\d:\d\d/,
                                    not: [/rejected/, /api unavailable/], calls: 1 });
    if (!v) return;
    assert(ctx, !w.counters.calls.some((c) => c.auth === false),
      "a 429 must not re-ask the public door, calls " + JSON.stringify(w.counters.calls));
    ctx.info = v.note;
  }),
  check("rejected (401) token, rate-limited public door — says both", async (ctx) => {
    const w = build({ owner: "octo", token: "github_pat_EXPIRED",
                      settings: { groups: ["aiproject"] },
                      apiRepos: 401, apiPublic: SPENT, repos: RATE_REPOS });
    await settle(1200);
    const v = rateVerdict(ctx, w, { re: /token rejected \(401\)/,
                                    not: [/api unavailable/], calls: 2 });
    if (!v) return;
    assert(ctx, /rate limit/.test(v.warn || ""),
      "the spent public door must be named as a limit, got " + v.warn);
    ctx.info = v.note;
  }),
  check("rejected (403) with no rate headers — still a rejection, still retried", async (ctx) => {
    const w = build({ owner: "octo", token: "github_pat_NOACCESS",
                      settings: { groups: ["aiproject"] },
                      apiRepos: 403, apiPublic: [], repos: RATE_REPOS });
    await settle(1200);
    const v = rateVerdict(ctx, w, { re: /token rejected \(403\)/,
                                    not: [/rate limit/], calls: 2 });
    if (!v) return;
    assert(ctx, w.counters.calls.some((c) => c.auth === false),
      "a refused token must still re-ask the public door, calls " + JSON.stringify(w.counters.calls));
    ctx.info = v.note;
  }),
  check("rate limit with no token — the public door names its reset", async (ctx) => {
    const w = build({ owner: "octo", settings: { groups: ["aiproject"] },
                      apiRepos: SPENT, repos: RATE_REPOS });
    await settle(1200);
    const v = rateVerdict(ctx, w, { re: /rate limit — retry after \d\d:\d\d/,
                                    not: [/api unavailable/, /rejected/], calls: 1 });
    if (v) ctx.info = v.note;
  }),
  check("rate limit with no headers on the public door — retry later", async (ctx) => {
    const w = build({ owner: "octo", settings: { groups: ["aiproject"] },
                      apiRepos: 403, apiPublic: 403, repos: RATE_REPOS });
    await settle(1200);
    const v = rateVerdict(ctx, w, { re: /rate limit — retry later/,
                                    not: [/api unavailable/, /rejected/], calls: 1 });
    if (v) ctx.info = v.note;
  }),
  check("facts — one parse keeps everything the repo page said", async (ctx) => {
    const w = build({
      owner: "octo",
      settings: { groups: ["aiproject"] },
      apiRepos: [],                       // nothing public: everything scrapes
      repos: [
        {
          name: "throttle-kit",
          topics: ["aiproject"],
          description: "Token bucket rate limiting for flaky upstreams",
          language: "Python",
          license: "MIT",
          stars: 42,
          forks: 7,
          homepage: "https://example.com/throttle",
          updated: "2026-08-01T10:00:00Z",
          readme: "A tiny library for backing off politely when a server says no.",
        },
        { name: "notes", topics: [] },
      ],
    });
    await settle();
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;

    const cached = w.store.local.repoFacts || {};
    const f = cached["octo/throttle-kit"];
    assert(ctx, f, "the fact cache must hold the repo it just read");
    if (!f) return;
    assert(ctx, f.description === "Token bucket rate limiting for flaky upstreams",
      "description, with GitHub's boilerplate stripped, got: " + f.description);
    assert(ctx, f.language === "Python", "language off the ?l= link, got: " + f.language);
    assert(ctx, f.stars === 42, "stars off the counter's title, got: " + f.stars);
    assert(ctx, f.forks === 7, "forks, got: " + f.forks);
    assert(ctx, f.license === "MIT", "licence, got: " + f.license);
    assert(ctx, /backing off politely/.test(f.readme || ""), "the README's opening line");
    assert(ctx, f.homepage === "https://example.com/throttle", "homepage, got: " + f.homepage);
    assert(ctx, typeof f.updated === "number" && f.updated > 0, "a parsed timestamp");
    assert(ctx, f.topics.join() === "aiproject",
      "and topics are STILL scoped to the sidebar — the decoy must not land");
    // The whole point: one request, not two.
    assert(ctx, w.counters.scraped.length === 2,
      "one fetch per repo and no more, got " + w.counters.scraped.length);
    ctx.info = "10 fields off " + w.counters.scraped.length + " page reads";
  }),

  check("find — searches what GitHub's name-only box cannot", async (ctx) => {
    const w = build({
      owner: "octo",
      settings: { groups: ["aiproject", "tooling"] },
      apiRepos: [],
      repos: [
        {
          name: "throttle-kit", topics: ["aiproject"],
          description: "Token bucket rate limiting for flaky upstreams",
          language: "Python",
        },
        {
          name: "wisp", topics: ["tooling"],
          description: "Dotfiles, but opinionated",
          readme: "Everything here is about rate limiting nothing at all.",
        },
        { name: "notes", topics: [] },
      ],
    });
    await settle();
    let v = readShelves(w.win);
    assert(ctx, v && v.find, "the toolbar must carry a filter box");
    if (!v || !v.find) return;

    // "rate limiting" appears in one description and one README — in NO name.
    type(w.win, "rate limiting");
    v = readShelves(w.win);
    assert(ctx, v.visible.sort().join() === "throttle-kit,wisp",
      "description and README are searchable, got: " + v.visible.join());
    assert(ctx, /2 of 3/.test(v.found), "the bar counts the matches, got: " + v.found);

    // a topic nobody typed into the row
    type(w.win, "aiproject");
    v = readShelves(w.win);
    assert(ctx, v.visible.join() === "throttle-kit", "topics are searchable, got: " + v.visible.join());
    const empty = [...w.win.document.querySelectorAll(".sh-shelf.sh-nomatch")];
    assert(ctx, empty.length >= 1, "a shelf with no hits is dimmed, not deleted");

    /* AND IT MUST NOT SEARCH WHAT THE READER CANNOT SEE. GitHub's star
       control ships its confirmation copy and its "add to a list" menu as
       hidden DOM inside every row; reading the whole <li> put 322 characters
       in each row's index against 53 on screen, and answered "77 of 77" to
       `star`, `starred` and `list` on a real profile. The row's text is the
       TEXT COLUMN's — see S.rowText. */
    for (const ghost of ["starred", "lists", "sorry", "unstar"]) {
      type(w.win, ghost);
      v = readShelves(w.win);
      assert(ctx, v.visible.length === 0,
        "\"" + ghost + "\" is GitHub's hidden chrome and must match no row, got: " +
        v.visible.join());
    }

    // a language, which GitHub's box also cannot match
    type(w.win, "python");
    v = readShelves(w.win);
    assert(ctx, v.visible.join() === "throttle-kit", "language is searchable, got: " + v.visible.join());

    type(w.win, "");
    v = readShelves(w.win);
    assert(ctx, v.visible.length === 3, "clearing restores every row, got " + v.visible.length);
    assert(ctx, v.found === "", "and the counter goes quiet");
    assert(ctx, w.win.document.querySelectorAll(".sh-shelf.sh-nomatch").length === 0,
      "and no shelf is left dimmed");

    /* FLAT MODE HAS NO SHELVES, and the filter must still work in it. Reaching
       rows THROUGH the shelves left the box inert there while it cheerfully
       reported "0 of 0" — worse than doing nothing, because it looked like an
       answer. */
    [...w.win.document.querySelectorAll("#shelves-host .sh-btn")]
      .find((b) => b.textContent === "flat list")
      .click();
    type(w.win, "rate limiting");
    const flatRows = [...w.win.document.querySelectorAll("#shelves-host li")];
    const flatShown = flatRows.filter((li) => !li.classList.contains("sh-hide"));
    assert(ctx, flatRows.length === 3 && flatShown.length === 2,
      "the flat list filters too, showed " + flatShown.length + " of " + flatRows.length);
    assert(ctx, /2 of 3/.test(readShelves(w.win).found),
      "and counts what it is actually filtering");
    ctx.info = "by description, README, topic, language — shelved and flat";
  }),

  check("note — private, searchable, and never cleared by a rescan", async (ctx) => {
    const w = build({
      owner: "octo",
      settings: { groups: ["aiproject"] },
      apiRepos: [],
      repos: [
        { name: "throttle-kit", topics: ["aiproject"] },
        { name: "notes", topics: [] },
      ],
    });
    await settle();

    writeNote(w.win, "throttle-kit", "the one with the broken deploy");
    await settle();

    let v = readShelves(w.win);
    assert(ctx, v.notes["throttle-kit"] === "the one with the broken deploy",
      "the note is painted on its row, got: " + v.notes["throttle-kit"]);
    assert(ctx, (w.store.local.notes || {})["octo/throttle-kit"] ===
      "the one with the broken deploy", "and written to local storage");
    assert(ctx, v.notes["notes"] === "", "and nowhere else");

    // the row's own text must not carry our affordance into the haystack
    assert(ctx, !/✎/.test(v.hay["notes"]), "the ✎ button must not be searchable");

    // a note is the only text on this page that is the user's own
    type(w.win, "broken deploy");
    v = readShelves(w.win);
    assert(ctx, v.visible.join() === "throttle-kit",
      "a note is searchable, got: " + v.visible.join());
    type(w.win, "");

    // exactly one editor, however many passes re-parent the same <li>
    const margins = w.win.document.querySelectorAll("#shelves-host li .sh-margin");
    assert(ctx, margins.length === 2, "one margin per row, got " + margins.length);

    /* STRUCTURAL GUARD FOR A LAYOUT BUG THIS HARNESS CANNOT SEE. jsdom computes
       no layout, so it could not notice that a margin appended to the <li>
       itself became a third flex child of a non-wrapping row and crushed the
       description to 94px. Where the row has a content column, the margin must
       be in it — that much is structure, and structure is checkable here.
       tests/row-layout.html is where the pixels get checked. */
    /* AND THE FALLBACK'S CSS MUST NOT REACH ROWS THAT DID NOT USE IT. The flag
       is what scopes `flex-wrap: wrap` to the unrecognised-markup case; without
       it every row on the page had GitHub's own flex layout rewritten for the
       benefit of the few that needed it. */
    const loose = w.win.document.querySelectorAll("#shelves-host li[data-sh-loose]");
    assert(ctx, loose.length === 0,
      "a row with a proper text column must not be flagged loose, got " + loose.length);

    const stray = w.win.document.querySelectorAll("#shelves-host li > .sh-margin");
    assert(ctx, stray.length === 0,
      "the margin must live in the row's text column, not beside it — " +
      stray.length + " sat directly on an <li>");

    // RESCAN FORGETS FACTS AND NOT WORDS
    await w.win.Shelves.cache.clear();
    await settle(50);
    assert(ctx, Object.keys(w.store.local.repoFacts || {}).length === 0,
      "rescan clears the fact cache");
    assert(ctx, (w.store.local.notes || {})["octo/throttle-kit"] ===
      "the one with the broken deploy",
      "...and must NEVER take the notes with it");

    // an emptied note is removed, not stored blank
    writeNote(w.win, "throttle-kit", "   ");
    await settle();
    assert(ctx, !("octo/throttle-kit" in (w.store.local.notes || {})),
      "an emptied note is deleted, not kept as an empty string");
    ctx.info = "written, painted, searchable, survives rescan";
  }),

  check("override - the reader's own answer outranks every topic, and never leaves the browser",
    async (ctx) => {
    /* THE ONLY SHELF THIS EXTENSION CAN BUILD WITHOUT GITHUB'S HELP. Every
       other path derives a shelf from a topic, an API field or a repo page -
       correct, and useless on an account that has never tagged anything.
       Measured on a real profile: 68 of 77 repos carry no topics. */
    const w = build({
      viewer: "octo",
      owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [],
      overrides: { "octo/nameless": "keep", "octo/tagged": "keep" },
      repos: [
        { name: "nameless", topics: [], private: true },           // no topics at all
        { name: "tagged", topics: ["elsewhere"], private: true },  // topics say otherwise
        { name: "plain", topics: ["keep"], private: true },
        { name: "spare", topics: [], private: true },
      ],
    });
    await settle(1400);
    let v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    let b = byLabel(v);

    assert(ctx, b.keep && b.keep.count === 3,
      "an untagged repo AND one whose topics disagree are both held by the " +
      "override, keep holds: " + ((b.keep || {}).count));
    assert(ctx, b.Ungrouped && b.Ungrouped.count === 1,
      "only the repo nobody has an opinion about is left over, got: " +
      ((b.Ungrouped || {}).count));

    /* AN OVERRIDE IS THE READER'S, SO IT MUST OUTLIVE A RESCAN - the same rule
       as a note, and for the same reason: no request re-derives it. */
    await w.win.Shelves.cache.clear();
    assert(ctx, Object.keys(await w.win.Shelves.overrides.read()).length === 2,
      "a rescan must not take the reader's own shelving with it");

    /* THE UNIT IS ONE WRITE. Moving a repo writes one key and repaints one
       row - it must not reload, because that costs the reader their scroll,
       their open shelves and the search they were typing. */
    const li = [...w.win.document.querySelectorAll("#shelves-host li")]
      .find((x) => x.dataset.shName === "octo/spare");
    assert(ctx, li && li.querySelector(".sh-grip"), "every row carries a grip");
    if (!li) return;
    li.querySelector(".sh-grip").click();

    /* THE SHELF CLIPS ITS OWN CHILDREN. `.sh-shelf` carries `overflow: hidden`
       for its rounded corners, which makes it a clip container — so a menu
       opened on a row near the bottom of a shelf is cut off and its last
       entries cannot be clicked. Measured in a real browser: a 26px overhang,
       and `elementFromPoint` on the last entry returned the NEXT shelf's
       summary. jsdom computes no layout and cannot see the clipping, so what
       is asserted here is the mechanism that lifts it — and that it is lifted
       on exactly one shelf and put back afterwards. */
    const holder = li.closest("details.sh-shelf");
    assert(ctx, holder && holder.dataset.menu === "1",
      "the shelf holding an open menu must stop clipping it");
    assert(ctx, w.win.document.querySelectorAll("[data-menu]").length === 1,
      "and only that one, got " + w.win.document.querySelectorAll("[data-menu]").length);

    const pick = [...li.querySelectorAll(".sh-shelfpick")]
      .find((x) => x.textContent === "keep");
    assert(ctx, pick, "the menu offers the shelves that exist, and only those");
    if (!pick) return;
    pick.click();
    await settle(400);

    assert(ctx, w.win.document.querySelectorAll("[data-menu]").length === 0,
      "and the clip goes straight back the moment the menu closes");

    v = readShelves(w.win);
    b = byLabel(v);
    assert(ctx, b.keep && b.keep.count === 4,
      "the row moves at once, without a reload, keep holds: " + ((b.keep || {}).count));
    const saved = await w.win.Shelves.overrides.read();
    assert(ctx, saved["octo/spare"] === "keep",
      "and the move is written down, got: " + JSON.stringify(saved["octo/spare"]));

    /* PUTTING IT BACK REMOVES THE KEY. An override the reader has withdrawn
       must not linger claiming an opinion they no longer hold. */
    li.querySelector(".sh-grip").click();
    const back = [...li.querySelectorAll(".sh-shelfpick")]
      .find((x) => x.textContent === "Ungrouped");
    assert(ctx, back, "and the way back is offered too");
    if (back) back.click();
    await settle(400);
    assert(ctx, (await w.win.Shelves.overrides.read())["octo/spare"] === undefined,
      "moving a repo back to the leftovers shelf clears the override");
    /* A CONFIGURED SHELF OWNS THE SPELLING OF ITS NAME. An override is stored
       with whatever label was drawn when it was made; re-casing the group in
       the options page afterwards would otherwise leave the pinned repos in a
       second shelf beside the one they were put on. Two shelves for one name
       is the failure — nothing vanishes, it just quietly doubles. */
    const cased = w.win.Shelves.bucketFor(["nothing"], { groups: ["Keep"], otherLabel: "Ungrouped" }, "keep");
    assert(ctx, cased === "Keep",
      "an override must resolve onto the configured spelling, got: " + cased);
    /* "PUT THIS ON THE LEFTOVERS SHELF" IS NOT "FORGET MY OPINION". They only
       agree for a repo with no topics. `octo/plain` carries the topic `keep`,
       so moving it to Ungrouped has to be STORED - deleting the key was a
       silent no-op: the row slid over, the counts changed, storage kept
       nothing, and the next load put it straight back on `keep`. */
    const tagged = [...w.win.document.querySelectorAll("#shelves-host li")]
      .find((x) => x.dataset.shName === "octo/plain");
    if (tagged) {
      tagged.querySelector(".sh-grip").click();
      const toLeft = [...tagged.querySelectorAll(".sh-shelfpick")]
        .find((x) => x.textContent === "Ungrouped");
      if (toLeft) toLeft.click();
      await settle(400);
      assert(ctx, (await w.win.Shelves.overrides.read())["octo/plain"] === "Ungrouped",
        "moving a TAGGED repo to the leftovers shelf must be stored, or the " +
        "page and the store disagree until the next load");
    }

    /* THE DRAG IS THE HEADLINE GESTURE AND IT HAD NO TEST. The drop listener
       reached for `CSS.escape`, which jsdom does not define - so it threw
       before doing anything, and a lost drop looks exactly like a drop that
       missed. It now finds the row by walking, which is testable anywhere. */
    const dragged = [...w.win.document.querySelectorAll("#shelves-host li")]
      .find((x) => x.dataset.shName === "octo/nameless");
    const target = [...w.win.document.querySelectorAll("#shelves-host details.sh-shelf")]
      .find((d) => d.querySelector(".sh-name").textContent === "Ungrouped");
    if (dragged && target) {
      const ev = new w.win.Event("drop", { bubbles: true, cancelable: true });
      ev.dataTransfer = { getData: () => "octo/nameless", dropEffect: "" };
      target.dispatchEvent(ev);
      await settle(400);
      assert(ctx, dragged.closest("details").querySelector(".sh-name").textContent === "Ungrouped",
        "a dropped row lands on the shelf it was dropped on");
      assert(ctx, (await w.win.Shelves.overrides.read())["octo/nameless"] === undefined,
        "and an untagged repo dropped on the leftovers shelf needs no override");
    }

    ctx.info = "3 held by hand, 1 left over; survives a rescan; one write per move";
  }),

  check("override released - re-tag a held repo and there has to be a way out",
    async (ctx) => {
    /* THE TRAP THAT TWO CORRECT RULES MADE BETWEEN THEM. An override outranks
       every topic (view.js) and a rescan must never take one (store.js) —
       both right on their own. Together, re-tagging a held repo on GitHub and
       pressing `rescan` moves nothing, and NOTHING ON THE PAGE SAYS WHY: the
       scan is working perfectly and its answer is being outranked.

       The way out was supposed to be "put it back where its topics say", and
       the move menu offers only shelves that are DRAWN — so when the held repo
       is the only one carrying its new topic, that shelf does not exist
       BECAUSE the repo is being held off it. Circular, and the reader has no
       gesture at all. Reproduced from a real profile: `walky` re-tagged from
       `extensions` to `cool`, moved to Ungrouped by hand in the hope that it
       would clear the opinion (it stores one — see the scenario above), and
       stuck there through every rescan. */
    const w = build({
      viewer: "octo",
      owner: "octo",
      settings: {},                                   // auto-group: one shelf per topic
      apiRepos: [],
      overrides: { "octo/walky": "extensions" },
      repos: [
        { name: "walky", topics: ["cool"], private: true },        // re-tagged on GitHub
        { name: "shelves", topics: ["extensions"], private: true },
        { name: "spare", topics: [], private: true },
      ],
    });
    await settle(1400);
    let b = byLabel(readShelves(w.win));
    assert(ctx, b.extensions && b.extensions.count === 2,
      "the symptom: the held repo does not move, got " + ((b.extensions || {}).count));
    assert(ctx, !b.cool,
      "and the shelf its topics name is not drawn — nothing else carries `cool`");

    /* A RESCAN IS STILL FORBIDDEN TO TAKE IT. The fix is a gesture, not a
       weakening of the rule that made the trap. */
    await w.win.Shelves.cache.clear();
    assert(ctx, (await w.win.Shelves.overrides.read())["octo/walky"] === "extensions",
      "a rescan must still leave the reader's own shelving alone");

    const li = [...w.win.document.querySelectorAll("#shelves-host li")]
      .find((x) => x.dataset.shName === "octo/walky");
    assert(ctx, li, "the held row is on the page");
    if (!li) return;

    /* IT IS DRAWN AS HELD. A row on a shelf its topics do not name looked
       exactly like one the tags put there, which is most of why the symptom
       reads as a broken scan rather than as an opinion being honoured. */
    assert(ctx, li.dataset.shOwn === "1",
      "a row held by hand says so, got " + JSON.stringify(li.dataset.shOwn));
    assert(ctx, li.dataset.shNatural === "cool",
      "and carries where it would go with no opinion, got " +
      JSON.stringify(li.dataset.shNatural));
    const other = [...w.win.document.querySelectorAll("#shelves-host li")]
      .find((x) => x.dataset.shName === "octo/shelves");
    assert(ctx, other && other.dataset.shOwn === "",
      "a row the TOPICS put there is not marked — the mark has to mean something");

    li.querySelector(".sh-grip").click();
    const picks = [...li.querySelectorAll(".sh-shelfpick")].map((x) => x.textContent);
    const free = [...li.querySelectorAll(".sh-freepick")][0];
    assert(ctx, free && free.textContent === "↺ cool",
      "the menu offers the shelf its topics name, drawn or not; got " +
      JSON.stringify(picks));
    if (!free) return;

    const was = w.reloads.n;
    free.click();
    await settle(400);
    assert(ctx, (await w.win.Shelves.overrides.read())["octo/walky"] === undefined,
      "releasing it deletes the key rather than storing a second opinion");
    /* AND THE PAGE IS RE-RUN, because `moveRow` needs a drawn shelf and there
       is none — leaving it would put the row and the store in disagreement
       for the rest of the session, which is the exact scar the leftovers-shelf
       no-op left. The cache makes the second pass free. */
    assert(ctx, w.reloads.n === was + 1,
      "a release onto a shelf nothing draws re-runs the pass, got " +
      (w.reloads.n - was) + " reload(s)");

    /* AND AN ORDINARY MOVE IS STILL ONE WRITE AND NO RELOAD. The reload above
       is bought by the shelf being absent, and must not leak into the move
       that was always quiet. */
    const quiet = build({
      viewer: "octo",
      owner: "octo",
      settings: { groups: ["keep", "other"] },
      apiRepos: [],
      repos: [
        { name: "one", topics: ["keep"], private: true },
        { name: "two", topics: ["other"], private: true },
      ],
    });
    await settle(1400);
    const row = [...quiet.win.document.querySelectorAll("#shelves-host li")]
      .find((x) => x.dataset.shName === "octo/one");
    if (row) {
      const n = quiet.reloads.n;
      row.querySelector(".sh-grip").click();
      const to = [...row.querySelectorAll(".sh-shelfpick")]
        .find((x) => x.textContent === "other");
      if (to) to.click();
      await settle(400);
      assert(ctx, quiet.reloads.n === n,
        "moving onto a shelf that IS drawn must stay quiet, got " +
        (quiet.reloads.n - n) + " reload(s)");
      assert(ctx, (await quiet.win.Shelves.overrides.read())["octo/one"] === "other",
        "and it is still written down");
    }

    ctx.info = "held row marked; ↺ cool offered though undrawn; key deleted, " +
               "one reload; an ordinary move stays quiet";
  }),

  check("suggest - a cold start offers shelves instead of one dump",
    async (ctx) => {
    /* THE FIRST RUN FOR SOMEONE WHO HAS NEVER TAGGED A REPO produces the page
       they already had. Everything needed to fix that was already computed -
       vocabulary() has every topic with its count, facts has a language, the
       names are on the rows. What was missing was the write. */
    const w = build({
      viewer: "octo",
      owner: "octo",
      settings: { groups: [] },              // a cold start: nothing configured
      apiRepos: [],
      repos: [
        { name: "wiremock-api", topics: [], private: true, language: "Java" },
        { name: "wiremock-data", topics: [], private: true, language: "Java" },
        { name: "wiremock-demo", topics: [], private: true, language: "Java" },
        { name: "rag-store", topics: ["rag"], private: true, language: "Python" },
        { name: "rag-eval", topics: ["rag"], private: true, language: "Python" },
        { name: "odd-one", topics: [], private: true, language: "Go" },
      ],
    });
    await settle(1600);
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;

    const sugs = [...w.win.document.querySelectorAll("#shelves-host .sh-sug")];
    const labels = sugs.map((x) => x.textContent);
    assert(ctx, sugs.length >= 1,
      "a cold start must offer something, got: " + labels.join(" | "));

    /* IT ONLY OFFERS SHELVES THE READER CANNOT ALREADY SEE. With no groups
       configured every topic is ALREADY an auto-derived shelf, so `rag` is on
       the page — offering to add it describes something they are looking at.
       And the repos it holds are answered, so they are not evidence for a
       Python shelf either. Both fall out of one rule: a repo already on a real
       shelf is not counted towards a new one. */
    assert(ctx, !labels.some((t) => /rag/.test(t)),
      "a topic that is already a shelf on this page must not be offered: " +
      labels.join(" | "));
    assert(ctx, !labels.some((t) => /Python/.test(t)),
      "nor a language made entirely of repos that shelf already holds: " +
      labels.join(" | "));

    /* THE PREFIX ONE IS THE POINT. A topic suggestion works on an account that
       already has topics; this whole section exists for the one that does not,
       and a shared leading word is the only signal such an account gives. It
       must be named for what the repos SHARE - `wiremock`, never `wire`. */
    const pre = sugs.find((x) => x.dataset.kind === "prefix");
    assert(ctx, pre && /wiremock/.test(pre.textContent),
      "the shared name is offered, named for what is shared, got: " + labels.join(" | "));
    if (!pre) return;
    assert(ctx, /\(3\)/.test(pre.textContent),
      "with its reach stated, got: " + pre.textContent);

    /* AND IT MUST NOT OFFER UNGROUPED WEARING A HAT. Java is 3 of 6 here;
       vocabulary() already calls that shape a blanket label, and offering to
       build one would be the panel recommending what it complains about. */
    assert(ctx, !labels.some((t) => /Java/.test(t)),
      "a language covering half the collection is a blanket, not a shelf: " +
      labels.join(" | "));

    /* ACCEPTED IN ONE CLICK INTO AN ORDINARY SHELF. A prefix matches no topic,
       so the same press must pin its repos - otherwise it builds an empty
       shelf and reads as broken. */
    pre.click();
    await settle(900);
    const groups = (await w.win.Shelves.load()).groups;
    assert(ctx, groups.indexOf("wiremock") !== -1,
      "it becomes a normal, editable shelf in settings.groups, got: " +
      JSON.stringify(groups));

    /* AND IT MUST NOT DELETE THE SHELVES ALREADY ON SCREEN. With no groups
       configured the shelves are auto-derived from topics; the first group
       written turns that off and anything matching no group falls to
       leftovers. Caught on the live page: accepting a suggestion took the
       `config` shelf with it. `rag` is here to be the shelf that must
       survive. */
    assert(ctx, groups.indexOf("rag") !== -1,
      "the auto-derived shelves are carried into the configuration, got: " +
      JSON.stringify(groups));
    const after = readShelves(w.win);
    const b2 = byLabel(after);
    assert(ctx, b2.rag && b2.rag.count === 2,
      "and rag still holds its two repos, got: " + ((b2.rag || {}).count));
    const ov = await w.win.Shelves.overrides.read();
    const pinned = Object.keys(ov).filter((k) => ov[k] === "wiremock");
    assert(ctx, pinned.length === 3,
      "and its repos are pinned, because a name is not a topic GitHub can " +
      "match - pinned: " + pinned.length);
    /* A SHELF HOLDING THE WHOLE COLLECTION IS A BLANKET AT ANY SIZE. The
       "more than half" rule had a floor of six repos, which switched it off
       exactly where the collection is smallest: five repos all in Go offered
       `add Go (5)` - the flat list with a name on it. */
    const tiny = build({
      viewer: "octo", owner: "octo",
      settings: { groups: [] }, apiRepos: [],
      repos: "abcde".split("").map((n) => ({
        name: n, topics: [], private: true, language: "Go",
      })),
    });
    await settle(1400);
    const offers = [...tiny.win.document.querySelectorAll("#shelves-host .sh-sug")]
      .map((x) => x.textContent);
    assert(ctx, !offers.some((t) => /Go/.test(t)),
      "a language every repo shares is the collection, not a shelf: " +
      offers.join(" | "));
    ctx.info = pinned.length + " repos pinned to a shelf named from what they share";
  }),

  check("workbench - Ungrouped offers the walk instead of being a dump",
    async (ctx) => {
    /* The one thing that fixes an untagged account for good is topics on
       GitHub, which P.I forbids us to write and which takes two clicks IF the
       reader is standing on the repo. So the funnel is the walk. */
    const w = build({
      viewer: "octo",
      owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [],
      repos: [
        { name: "one", topics: [], private: true },
        { name: "two", topics: [], private: true },
        { name: "three", topics: ["keep"], private: true },
      ],
    });
    await settle(1400);
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;

    const bench = w.win.document.querySelector("#shelves-host .sh-bench");
    assert(ctx, bench, "the leftovers shelf must carry the walk");
    if (!bench) return;
    assert(ctx, /2 untagged/.test(bench.textContent),
      "counted from the TOPICS, not from the shelf, got: " + bench.textContent);

    /* ONE TAB PER PRESS. A fan of thirty tabs is not a funnel, it is an
       ambush - and the count is where the reader left off. */
    const opened = [];
    w.win.open = (url) => { opened.push(url); return null; };
    bench.click();
    assert(ctx, opened.length === 1 && /octo\/one$/.test(opened[0]),
      "the first press opens the first untagged repo, got: " + opened.join());
    /* AND ONLY EVER ON GITHUB. The name in that URL came off an href the page
       supplied — the same untrusted string the fetch path was scarred for. */
    assert(ctx, opened.every((u) => {
      try { return new w.win.URL(u).host === "github.com"; } catch (e) { return false; }
    }), "every tab the walk opens is on github.com, got: " + opened.join());
    assert(ctx, /2 of 2/.test(bench.textContent),
      "and the button says what is NEXT, got: " + bench.textContent);
    bench.click();
    assert(ctx, opened.length === 2 && /octo\/two$/.test(opened[1]),
      "the second press opens the next one, got: " + opened.join());

    /* IT WRAPS RATHER THAN DEAD-ENDING, and the label says so by going back to
       the beginning: a chore you have walked to the end of is a chore you can
       start again, not a button that does nothing. */
    assert(ctx, /2 untagged/.test(bench.textContent),
      "past the last one it reads as the start again, got: " + bench.textContent);
    bench.click();
    assert(ctx, opened.length === 3 && /octo\/one$/.test(opened[2]),
      "past the end it starts over, got: " + opened.join());

    const shelf = [...w.win.document.querySelectorAll("#shelves-host details.sh-shelf")]
      .find((d) => d.querySelector(".sh-name").textContent === "Ungrouped");
    assert(ctx, shelf && shelf.open === true,
      "and pressing it must never toggle the shelf out from under the reader");

    /* THE LIST SHRINKS AS THE READER WORKS, AND THAT IS THE FEATURE. A
       bookmark taken against five repos is routinely read against two, and
       `Math.min` turned that into the one index past the end: the button
       opened nothing, read "3 of 2", and stayed dead for good because nothing
       ever moved the bookmark back. Wrapped, a stale bookmark is simply a
       place in a shorter queue. */
    /* A BOOKMARK PAST THE END IS THE NORMAL CASE, not an edge one: the list
       shrinks every time the reader tags something, so a place taken against
       five repos is routinely read against two. `Math.min` turned that into
       the one index past the end — the button opened nothing, read "3 of 2",
       and stayed dead for good, because nothing ever moved the bookmark back.
       Wrapped, a stale bookmark is just a place in a shorter queue. */
    w.win.Shelves.bench.set("octo", 7);        // as if five had been tagged
    const before = opened.length;
    bench.click();
    assert(ctx, opened.length === before + 1,
      "a bookmark past the end must still open something, opened " +
      (opened.length - before));
    assert(ctx, !/NaN|of 0/.test(bench.textContent),
      "and the label must not print nonsense, got: " + bench.textContent);
    ctx.info = "2 untagged walked one tab at a time; wraps; survives a stale bookmark";
  }),

  check("not yours - the first-day verbs write the reader's own setup, so they stand down",
    async (ctx) => {
    /* P.XIV narrowed the expensive RUNGS to the reader's own repositories.
       These three narrow the WRITES, which is the same argument one step on.
       Accepting a suggestion on a stranger's page writes `settings.groups` -
       the reader's own configuration, over SYNC, on every machine - naming
       somebody else's topics; and because the first such write flips the page
       out of auto-group mode, the reader's OWN profile then drew one shelf
       with everything in it. Measured on a real stranger's page. */
    const w = build({
      viewer: "me",
      owner: "some-stranger",
      settings: { groups: [] },
      apiRepos: [
        { name: "wiremock-api", topics: [] },
        { name: "wiremock-data", topics: [] },
        { name: "wiremock-demo", topics: [] },
        { name: "loose", topics: [] },
      ],
      repos: [
        { name: "wiremock-api", topics: [] },
        { name: "wiremock-data", topics: [] },
        { name: "wiremock-demo", topics: [] },
        { name: "loose", topics: [] },
      ],
    });
    await settle(1400);
    const v = readShelves(w.win);
    assert(ctx, v, "a stranger's profile must still be SHELVED - this is a " +
      "narrowing of the writes, not a refusal of the page");
    if (!v) return;

    const doc = w.win.document;
    assert(ctx, doc.querySelectorAll("#shelves-host .sh-sug").length === 0,
      "no suggestion may be offered for somebody else's collection");
    assert(ctx, doc.querySelectorAll("#shelves-host .sh-bench").length === 0,
      "nor a walk through somebody else's untagged repos");
    assert(ctx, doc.querySelectorAll("#shelves-host .sh-grip").length === 0,
      "nor a grip that would pin somebody else's repo in the reader's store");

    /* And the read-only half is untouched. */
    assert(ctx, v.find, "the filter is still there");
    assert(ctx, doc.querySelector("#shelves-host .sh-bar"), "and the toolbar");
    assert(ctx, Object.keys(await w.win.Shelves.overrides.read()).length === 0,
      "and nothing was written");
    ctx.info = "shelved and searchable; 0 suggestions, 0 walks, 0 grips, 0 writes";
  }),

  check("progressive - the page arrives from the cache, then corrects itself",
    async (ctx) => {
    /* A COLD RUN IS ONE AUTHENTICATED FETCH PER REPO, and until it finishes
       the reader is looking at the flat list they came to get away from. Two
       sources cost nothing and are already here: the chips GitHub renders on
       the rows, and every record rung 4 has paid for on a previous visit.

       Rung 4 is made slow on purpose below — in jsdom both passes would
       otherwise land inside one `settle()` and the window this feature exists
       for would be untestable. */
    const at = Date.now();
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep", "later"] },
      apiRepos: [],
      cache: {
        "octo/known-a": { at, topics: ["keep"], name: "octo/known-a", via: "page" },
        "octo/known-b": { at, topics: ["keep"], name: "octo/known-b", via: "page" },
      },
      repos: [
        { name: "known-a", topics: ["keep"], private: true },
        { name: "known-b", topics: ["keep"], private: true },
        { name: "slow-c", topics: ["later"], private: true },
        { name: "slow-d", topics: [], private: true },
      ],
    });
    const real = w.win.fetch;
    w.win.fetch = (u) => new Promise((r) => setTimeout(() => r(real(u)), 700));

    /* ---- the first frame -------------------------------------------------- */
    await settle(450);
    const host1 = w.win.document.getElementById("shelves-host");
    assert(ctx, host1, "the page must be shelved before the ladder answers");
    if (!host1) return;
    assert(ctx, host1.dataset.provisional === "1",
      "and it must know it is a guess");

    let v = readShelves(w.win);
    let b = byLabel(v);
    assert(ctx, b.keep && b.keep.count === 2,
      "the two cached repos are shelved from the cache, got: " +
      ((b.keep || {}).count));
    /* P.IV — the line must never name a rung that has not run. */
    assert(ctx, /via page \+ cache/.test(v.note),
      "and it says what answered, got: " + v.note);
    assert(ctx, !/repo pages/.test(v.note),
      "and does NOT name the rung still running, got: " + v.note);

    /* A PROVISIONAL SHELF MUST LEAVE NOTHING BEHIND. `shelves:open:<owner>`
       has no eviction path, and a `toggle` fires as a queued task, so shelves
       opened by a guess would otherwise persist open-state for names the
       finished page may never draw again. */
    assert(ctx, !w.win.localStorage.getItem("shelves:open:octo"),
      "the first frame must not write the collapse store, got: " +
      w.win.localStorage.getItem("shelves:open:octo"));
    assert(ctx, !Object.keys(w.store.local.shelfMap || {}).length,
      "nor publish a shelf map another page would colour a chip from");
    /* THE COMPLEMENT MATTERS MORE THAN THE GUARD. `publishMap()` reads
       `ctx.provisional`, and `ctx` is still phase one's object — so clearing
       the attribute alone left the guard armed for ever and the map was never
       written at all. Measured on the real page: zero owners after a full
       settled run, and a repo-page chip with nothing to read. */

    /* THE READER CAN USE IT, and what they do must survive the correction. */
    type(w.win, "known");
    assert(ctx, /2 of 4/.test(readShelves(w.win).found),
      "the filter works on the first frame, got: " + readShelves(w.win).found);

    /* ---- the correction --------------------------------------------------- */
    await settle(2600);
    const host2 = w.win.document.getElementById("shelves-host");
    assert(ctx, host2 === host1,
      "THE HOST IS NOT REPLACED — swapping it would take the find box's text, " +
      "the open audit panel, keyboard focus and an open menu with it, while " +
      "the rows kept their sh-hide classes with nothing on screen saying why");
    assert(ctx, host2.dataset.provisional === undefined,
      "and it stops calling itself a guess");

    v = readShelves(w.win);
    assert(ctx, /repo pages/.test(v.note),
      "the line now names the rung that answered, got: " + v.note);

    /* THE FILTER SURVIVED — asserted BEFORE the counts, because a live filter
       is exactly why the counts read "1 / 1" rather than "1". The `sh-hide`
       classes ride on the rows, so a pass that forgot to re-apply the filter
       would leave a full set of counts, an empty search box, and two
       repositories simply missing with nothing on screen saying why. */
    assert(ctx, v.find.value === "known", "what the reader typed is still there");
    assert(ctx, /2 of 4/.test(v.found),
      "and it still means what it said, got: " + v.found);
    assert(ctx, v.visible.sort().join() === "known-a,known-b",
      "and it is still hiding the right rows, got: " + v.visible.join());

    type(w.win, "");
    v = readShelves(w.win);
    b = byLabel(v);
    assert(ctx, v.visible.length === 4, "clearing it restores every row");
    assert(ctx, b.later && b.later.count === 1,
      "a shelf the cache never knew about is created, got: " +
      ((b.later || {}).count));
    assert(ctx, b.keep && b.keep.count === 2, "and the cached ones are still right");
    assert(ctx, b.Ungrouped && b.Ungrouped.count === 1,
      "and the genuinely untagged one is left over");

    assert(ctx, w.win.document.querySelectorAll("#shelves-host").length === 1,
      "one host, always");
    assert(ctx, w.win.document.querySelectorAll("#shelves-host li .sh-margin").length === 4,
      "and one margin per row - a second pass must not double the furniture");

    const map = (w.store.local.shelfMap || {})["octo"];
    assert(ctx, map && Array.isArray(map.order) && map.order.length,
      "and the FINISHED page publishes its map, which the guard above must " +
      "not outlive: " + JSON.stringify(w.store.local.shelfMap));
    assert(ctx, map && map.on && map.on["octo/slow-c"] === "later",
      "carrying which shelf each repo landed on, got: " +
      JSON.stringify((map || {}).on));
    ctx.info = "shelved from cache at first frame, re-bucketed in place, filter kept";
  }),

  check("compose - GitHub's own filters cost nothing and keep what you typed",
    async (ctx) => {
    /* MEASURED, on the real page: GitHub's Type and Language menus do not
       navigate. They fetch, then REPLACE the children of
       `#user-repositories-list` — our host is removed, a new <ul> with new
       <li> elements arrives, every `data-sh-*` is gone, and NO `turbo:*` event
       fires, so the MutationObserver is the only thing that notices. The rows
       cannot be kept; they are different elements.

       What survives is the JavaScript context. So two things must survive with
       it: the answer this visit already paid for, and the query the reader
       typed. Both were lost before — `"wire"`, 3 of 54, gone half a second
       after touching a dropdown, and every repo resolved again from scratch. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [],
      repos: [
        { name: "wire-a", topics: ["keep"], private: true },
        { name: "wire-b", topics: ["keep"], private: true },
        { name: "other", topics: [], private: true },
      ],
    });
    await settle(1400);
    let v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    const firstReads = w.counters.scraped.length;
    const firstApi = w.counters.api;
    assert(ctx, firstReads === 3,
      "the first pass reads what the API cannot see, got " + firstReads);

    // the reader filters
    type(w.win, "wire");
    assert(ctx, /2 of 3/.test(readShelves(w.win).found),
      "filtered, got: " + readShelves(w.win).found);

    /* Now GitHub's dropdown, reproduced exactly as measured: the host and the
       list are removed together and a brand-new <ul> of brand-new rows is put
       in their place. No turbo event — the observer is on its own. */
    const holder = w.win.document.getElementById("user-repositories-list");
    assert(ctx, holder, "the fixture must have the list container");
    if (!holder) return;
    const fresh = w.win.document.createElement("ul");
    [...w.win.document.querySelectorAll("#shelves-host li[data-sh-name]")]
      .forEach((li) => {
        const copy = li.cloneNode(true);
        /* GitHub's rows arrive with none of our marks on them. */
        ["shName", "shHay", "shText", "shMargin", "shLoose"].forEach((k) => {
          delete copy.dataset[k];
        });
        copy.querySelectorAll(".sh-margin").forEach((m) => m.remove());
        fresh.appendChild(copy);
      });
    holder.innerHTML = "";
    holder.appendChild(fresh);
    await settle(1600);

    v = readShelves(w.win);
    assert(ctx, v, "the observer must shelve the replacement list");
    if (!v) return;

    /* 1. IT COSTS NOTHING. Every repo was answered earlier in this visit, so
       no rung below the memo has anything to do. */
    assert(ctx, w.counters.scraped.length === firstReads,
      "a dropdown must not re-read repositories this visit already read: " +
      (w.counters.scraped.length - firstReads) + " extra page reads");
    /* THE API RUNG IS THE ONE THE DISK CACHE CANNOT SAVE. `repoFacts` only
       ever answers rung 4, so `askWorker` fires on EVERY run — measured on the
       real page, one api.github.com call per dropdown, warm or cold. The memo
       is what makes the whole ladder stand down when this visit has already
       answered every repo on the list. */
    assert(ctx, w.counters.api === firstApi,
      "nor spend an API call on an answer it already has, spent " +
      (w.counters.api - firstApi) + " more");
    assert(ctx, /already read/.test(v.note),
      "and the source line says where the answer came from, got: " + v.note);

    /* 2. AND IT KEEPS WHAT THE READER TYPED. */
    assert(ctx, v.find.value === "wire",
      "the query survives GitHub's swap, got: " + JSON.stringify(v.find.value));
    assert(ctx, /2 of 3/.test(v.found),
      "and it is applied, not merely displayed, got: " + v.found);
    assert(ctx, v.visible.sort().join() === "wire-a,wire-b",
      "so the right rows are showing, got: " + v.visible.join());

    /* CLEARING IT MUST ALSO STICK. A remembered filter that cannot be
       forgotten would follow the reader through every dropdown for the rest of
       the visit. And the counts only read as plain numbers once nothing is
       filtered — "2 / 2" is the filtered form, not a broken one. */
    type(w.win, "");
    assert(ctx, w.win.Shelves.lastFilter === null,
      "an empty box is not a filter to remember");

    const b = byLabel(readShelves(w.win));
    assert(ctx, b.keep && b.keep.count === 2,
      "and the shelves are rebuilt correctly, keep: " + ((b.keep || {}).count));
    ctx.info = "0 extra reads across the swap; the query and its rows kept";
  }),

  check("density - compact is a posture, not a second rendering path",
    async (ctx) => {
    /* GitHub draws a repository row 109px tall: 24px of padding either side of
       a block column holding a heading, a description it may not have, a topic
       row it may not have, and a footer line. On 77 repos that is eight
       screens to read a list, and the shelves cannot help because the shelves
       are not what is tall. Measured in a real browser: 109px -> 41px, nine
       rows a screen -> twenty-four.

       THE HEIGHTS ARE NOT ASSERTED HERE. jsdom computes no layout, so a
       stylesheet claim is worth nothing to it; `tests/density.py` measures the
       pixels against a real profile. What IS asserted is everything the
       stylesheet hangs off: the attribute, the toggle, the memory, and the
       fact that nothing is removed from the row. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"] }, apiRepos: [],
      repos: [
        { name: "a", topics: ["keep"], private: true, description: "the first one" },
        { name: "b", topics: [], private: true, description: "the second one" },
      ],
    });
    await settle(1400);
    const doc = w.win.document;
    const host = doc.getElementById("shelves-host");
    assert(ctx, host, "never rendered");
    if (!host) return;

    assert(ctx, host.dataset.density === "roomy",
      "GitHub's own spacing is the default, got: " + host.dataset.density);
    const btn = [...doc.querySelectorAll("#shelves-host .sh-btn")]
      .find((b) => b.textContent === "compact");
    assert(ctx, btn, "the toolbar must offer it");
    if (!btn) return;

    btn.click();
    assert(ctx, host.dataset.density === "compact",
      "one attribute on the host is the whole switch, got: " + host.dataset.density);
    assert(ctx, btn.textContent === "roomy",
      "and the button then offers the way back, got: " + btn.textContent);

    /* NOTHING IS REMOVED FROM THE ROW. Compact is CSS: the description is
       still in the DOM, still in the search index, and still there the moment
       the reader presses `roomy`. A second rendering path that stripped the
       row would take the filter's reach with it. */
    const rows = [...doc.querySelectorAll("#shelves-host li[data-sh-name]")];
    assert(ctx, rows.length === 2, "both rows are still drawn, got " + rows.length);
    assert(ctx, rows.every((li) => li.querySelector("p")),
      "the description is hidden by CSS, never deleted");
    assert(ctx, (rows[0].dataset.shHay || "").indexOf("first") !== -1,
      "so the filter still reaches it");

    assert(ctx, w.win.Shelves.density.read("octo") === "compact",
      "and the choice is remembered for this profile");
    btn.click();
    assert(ctx, host.dataset.density === "roomy" &&
                w.win.Shelves.density.read("octo") === "roomy",
      "toggling back is remembered too");

    /* REMEMBERED MEANS READ BEFORE THE FIRST PAINT. Applying it afterwards
       would draw the roomy page and then collapse it under the reader. */
    const w2 = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"] }, apiRepos: [],
      repos: [{ name: "a", topics: ["keep"], private: true }],
    });
    w2.win.localStorage.setItem("shelves:density:octo", "compact");
    await settle(1400);
    const host2 = w2.win.document.getElementById("shelves-host");
    assert(ctx, host2 && host2.dataset.density === "compact",
      "a remembered compact profile opens compact, got: " +
      ((host2 || {}).dataset || {}).density);
    ctx.info = "one attribute, remembered per profile; the row keeps every field";
  }),

  check("keyboard - the shelves are the navigation, so they answer to keys",
    async (ctx) => {
    /* GitHub's readers live on the keyboard, and the shelves have replaced the
       list `/` used to be about. Every key here stands down inside a field —
       including GitHub's own boxes and our note editor — so the only keys they
       ever take are ones pressed while reading. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["one", "two", "three"], startCollapsed: true },
      apiRepos: [],
      repos: [
        { name: "a", topics: ["one"], private: true },
        { name: "b", topics: ["two"], private: true },
        { name: "c", topics: ["three"], private: true },
        { name: "d", topics: [], private: true },
      ],
    });
    await settle(1400);
    const doc = w.win.document;
    const host = doc.getElementById("shelves-host");
    assert(ctx, host, "never rendered");
    if (!host) return;

    const press = (key, target) => {
      const ev = new w.win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      (target || doc.body).dispatchEvent(ev);
      return ev;
    };
    const shelves = () => [...host.querySelectorAll("details.sh-shelf")];
    const focusedShelf = () => {
      const a = doc.activeElement;
      const d = a && a.closest ? a.closest("details.sh-shelf") : null;
      return d ? d.querySelector(".sh-name").textContent : null;
    };

    // `/` — the filter, focused and selected
    press("/");
    assert(ctx, doc.activeElement === host.querySelector(".sh-find"),
      "`/` focuses the filter");

    // j / k walk the shelves, and they move FOCUS, not just the scroll —
    // focus is what a screen reader follows and what Enter then acts on.
    doc.activeElement.blur();
    press("j");
    assert(ctx, focusedShelf() === "one", "`j` lands on the first shelf, got: " + focusedShelf());
    press("j");
    assert(ctx, focusedShelf() === "two", "`j` again moves on, got: " + focusedShelf());
    press("k");
    assert(ctx, focusedShelf() === "one", "`k` goes back, got: " + focusedShelf());

    /* IT WRAPS RATHER THAN STOPPING DEAD. A cursor that sticks at the end
       gives no feedback distinguishable from a key that did nothing. */
    press("k");
    assert(ctx, focusedShelf() === shelves()[shelves().length - 1]
      .querySelector(".sh-name").textContent,
      "`k` from the first shelf wraps to the last, got: " + focusedShelf());

    // digits jump AND open — a shelf you jumped to and cannot see is not a jump
    press("2");
    assert(ctx, focusedShelf() === "two", "`2` jumps to the second shelf");
    assert(ctx, shelves()[1].open === true, "and opens it");

    // e / c are expand-all and collapse-all
    press("e");
    assert(ctx, shelves().every((d) => d.open), "`e` expands every shelf");
    press("c");
    assert(ctx, shelves().every((d) => !d.open), "`c` collapses every shelf");

    /* A DIGIT NAMING NO SHELF IS NOT OURS TO TAKE. With four shelves, `9` must
       reach the page untouched — GitHub may want it. */
    const nine = press("9");
    assert(ctx, !nine.defaultPrevented,
      "a digit naming no shelf must not be swallowed");

    /* AND NOTHING FIRES INSIDE A FIELD. Typing `j` into the filter must type a
       `j`, and a modifier belongs to the browser: ctrl+J is the download
       shelf, and a shortcut that eats it is a bug in somebody else's app. */
    const find = host.querySelector(".sh-find");
    const inField = press("j", find);
    assert(ctx, !inField.defaultPrevented, "`j` inside the filter box is a letter");
    const ctrl = new w.win.KeyboardEvent("keydown",
      { key: "j", ctrlKey: true, bubbles: true, cancelable: true });
    doc.body.dispatchEvent(ctrl);
    assert(ctx, !ctrl.defaultPrevented, "and a modified key is the browser's");

    ctx.info = "/ j k 1-9 e c — focus moves, digits open, fields and modifiers untouched";
  }),

  check("rule-shelf - a shelf may be a question, not only a word",
    async (ctx) => {
    /* Every shelf until now was one topic string matched literally — the right
       default, and the whole answer for a well-tagged collection. It cannot
       express the shelf people describe out loud: *the Python ones I still
       work on*. That is three fields and a date, and `facts.js` already
       harvests all four from the request the ladder was making anyway. */
    const day = 86400000;
    const now = Date.now();
    /* `pushed_at` is an ISO string in GitHub's body and `background.js` parses
       it — a number here reaches `Date.parse` as "1756…" and comes back null,
       which is a fixture that quietly tests nothing. */
    const ago = (d) => new Date(now - d * day).toISOString();
    const w = build({
      viewer: "octo", owner: "octo",
      settings: {
        groups: ["Live Python = topic:ai lang:python fork:false pushed:<90d",
                 "misc"],
      },
      apiRepos: [
        { name: "live", topics: ["ai"], language: "Python",
          updated: ago(10) },
        { name: "cold", topics: ["ai"], language: "Python",
          updated: ago(400) },
        { name: "wrong-lang", topics: ["ai"], language: "Go", updated: ago(1) },
        { name: "a-fork", topics: ["ai"], language: "Python", fork: true,
          updated: ago(1) },
        { name: "plain", topics: ["misc"], updated: ago(1) },
      ],
      repos: [
        { name: "live", topics: ["ai"] }, { name: "cold", topics: ["ai"] },
        { name: "wrong-lang", topics: ["ai"] }, { name: "a-fork", topics: ["ai"] },
        { name: "plain", topics: ["misc"] },
      ],
    });
    await settle(1600);
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    const b = byLabel(v);

    /* THE SHELF IS NAMED BY ITS LABEL, NOT BY ITS EXPRESSION. `Name = expr` —
       the separator is `=` because every term inside already uses `:`. */
    assert(ctx, b["Live Python"], "the shelf wears its name, not its rule: " +
      v.shelves.map((x) => x.label).join(" | "));
    if (!b["Live Python"]) return;
    assert(ctx, b["Live Python"].count === 1,
      "only the repo that satisfies EVERY term, got " + b["Live Python"].count +
      " (" + (b["Live Python"].repos || []).join() + ")");
    assert(ctx, (b["Live Python"].repos || []).join() === "live",
      "and it is the right one, got: " + (b["Live Python"].repos || []).join());

    /* A plain topic entry beside a rule, in one list, in the reader's order. */
    assert(ctx, b.misc && b.misc.count === 1,
      "a topic shelf still works beside a rule one, got " + ((b.misc || {}).count));
    assert(ctx, b.Ungrouped && b.Ungrouped.count === 3,
      "and everything the rule refused falls to the leftovers shelf, got " +
      ((b.Ungrouped || {}).count));

    /* A TERM NOBODY CAN PARSE IS NAMED, NOT DROPPED. A shelf that silently
       ignores a third of itself leaves the reader unable to explain what they
       are looking at. */
    const bad = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["Oops = lang:python topc:ai pushed:90"] },
      apiRepos: [{ name: "x", topics: [], language: "Python" }],
      repos: [{ name: "x", topics: [] }],
    });
    await settle(1400);
    const bv = readShelves(bad.win);
    assert(ctx, bv && /unreadable in Oops/.test(bv.note),
      "the toolbar names the terms it could not read, got: " + (bv || {}).note);
    assert(ctx, bv && /topc:ai/.test(bv.note) && /pushed:90/.test(bv.note),
      "both of them - a bare number is not an age, got: " + (bv || {}).note);
    /* ---- THE FOUR WAYS A RULE LIED, EACH MEASURED ON THE REAL COLLECTION.
       A term that quietly means something other than what it says is worse
       than one that refuses: the shelf still looks right. */
    const R = w.win.Shelves;
    const rec = (o) => Object.assign(
      { via: "api", name: "starfleet1334/x", topics: [], language: "",
        license: "", stars: 0, forks: 0, updated: now, archived: false,
        fork: false, private: false }, o);
    const hits = (expr, f) => R.matchRule(R.parseRule("x = " + expr), f, f.topics).yes;

    /* 1. `lang:` was a SUBSTRING, so `lang:java` held 26 Java repos and 2
          JavaScript ones — a Java shelf of 28. `lang:c` is the same trap
          waiting for C++, C#, CSS and Clojure. */
    assert(ctx, hits("lang:java", rec({ language: "Java" })), "Java is Java");
    assert(ctx, !hits("lang:java", rec({ language: "JavaScript" })),
      "but JavaScript is not Java");
    assert(ctx, !hits("lang:c", rec({ language: "C++" })), "nor is C++ C");

    /* 2. `name:` matched `owner/name`, so on an account called StarFleet1334
          the term `name:star` matched all 54 rows. */
    assert(ctx, !hits("name:star", rec({ name: "starfleet1334/2com" })),
      "the owner is in every name and is not part of the repo's");
    assert(ctx, hits("name:2com", rec({ name: "starfleet1334/2com" })),
      "the repo's own name still matches");

    /* 3. `private` was listed as carried and never written, so `private:false`
          matched every repository on the account and `private:true` matched
          none — the whole private half of a collection on the wrong side. */
    assert(ctx, hits("private:true", rec({ private: true })),
      "a private repo is private");
    assert(ctx, !hits("private:false", rec({ private: true })),
      "and is not public");

    /* 4. A FIELD THE SOURCE CANNOT SEE IS UNKNOWN, NOT EMPTY. Measured on six
          real repo pages: the server HTML `scrape()` parses carries zero
          `<relative-time>` and zero language links — GitHub renders both on
          the client. Claiming otherwise made `lang:python` answer "0 matched,
          0 unknown" on a scraped collection, which reads as "you have no
          Python" when the truth is "nobody could look". */
    const scraped = { via: "page", name: "o/x", topics: [], language: "" };
    assert(ctx, R.matchRule(R.parseRule("x = lang:python"), scraped, []).unknown,
      "a scraped record cannot answer for its language");
    assert(ctx, R.matchRule(R.parseRule("x = pushed:<90d"), scraped, []).unknown,
      "nor for when it was pushed");
    assert(ctx, !R.matchRule(R.parseRule("x = readme:hello"), scraped, []).unknown,
      "but it CAN answer for its README, which the API never carries");

    /* ---- A RULE WITH NOTHING LEFT TO TEST MATCHES NOTHING ------------------
       `[].every()` is `true`, so a rule whose every term failed to parse was a
       UNIVERSAL match — and because the first matching shelf wins, one typo
       anywhere in the list became a black hole. Reproduced before the fix:
       `Oops = topc:ai` drew one shelf holding all three repos and the
       configured `misc` shelf vanished from the page entirely. It is the exact
       inversion of the charter's failure shape. */
    const hole = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["Oops = topc:ai", "misc"] },
      apiRepos: [{ name: "one", topics: ["misc"] }, { name: "two", topics: [] }],
      repos: [{ name: "one", topics: ["misc"] }, { name: "two", topics: [] }],
    });
    await settle(1400);
    const hv = readShelves(hole.win);
    const hb = byLabel(hv || { shelves: [] });
    assert(ctx, !hb.Oops || hb.Oops.count === 0,
      "an unreadable rule must hold nothing, got " + ((hb.Oops || {}).count));
    assert(ctx, hb.misc && hb.misc.count === 1,
      "and must not swallow the shelves after it, misc: " + ((hb.misc || {}).count));

    /* ---- ONE SHELF PER LABEL ----------------------------------------------
       A topic entry beside a rule of the same name built the same <details>
       twice, and the second build re-parented the rows out of the first — a
       phantom empty shelf with a non-zero count printed on it. */
    const dup = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["ai", "ai = lang:python"] },
      apiRepos: [{ name: "p", topics: [], language: "Python" },
                 { name: "t", topics: ["ai"] }],
      repos: [{ name: "p", topics: [] }, { name: "t", topics: ["ai"] }],
    });
    await settle(1400);
    const dv = readShelves(dup.win);
    const named = (dv || { shelves: [] }).shelves.filter((x) => x.label === "ai");
    assert(ctx, named.length === 1,
      "two entries with one name are one shelf, got " + named.length);
    assert(ctx, named[0] && named[0].repos.length === Number(named[0].count),
      "and its count is what it holds, got " + (named[0] || {}).count +
      " printed over " + ((named[0] || {}).repos || []).length + " rows");

    /* ---- AN EMPTY RULE SHELF WITH SOMETHING TO SAY IS STILL DRAWN ---------
       On the very collection the rule was built for — scraped, so no language
       and no dates — the shelf matched nothing, was dropped from the order,
       and the page said nothing at all. */
    const blind = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["Python = lang:python", "misc"] },
      apiRepos: 401,
      apiPublic: 401,
      repos: [{ name: "a", topics: [] }, { name: "b", topics: ["misc"] }],
    });
    await settle(1600);
    const blv = readShelves(blind.win);
    const blb = byLabel(blv || { shelves: [] });
    assert(ctx, blb.Python,
      "a rule that could judge nobody is still drawn, shelves: " +
      (blv || { shelves: [] }).shelves.map((x) => x.label).join(" | "));
    const wt = blind.win.document.querySelector("#shelves-host .sh-weight");
    assert(ctx, wt && /unjudged/.test(wt.textContent),
      "carrying the count of repos it could not decide about, got: " +
      ((wt || {}).textContent));

    ctx.info = "5 repos, 1 satisfies the rule; unreadable terms named";
  }),

  check("weight - a shelf header says what the shelf is worth",
    async (ctx) => {
    /* A count is the least a shelf header could say, and the records to say
       more are already here. One of the three sentences is one GitHub cannot
       say at all: it knows when every repo was pushed and has no idea when you
       last looked. */
    const day = 86400000;
    const now = Date.now();
    const ago = (d) => new Date(now - d * day).toISOString();
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [
        { name: "big", topics: ["keep"], stars: 100, updated: ago(2) },
        { name: "old", topics: ["keep"], stars: 20, updated: ago(500) },
        { name: "mid", topics: ["keep"], stars: 3, updated: ago(30) },
      ],
      repos: [
        { name: "big", topics: ["keep"] }, { name: "old", topics: ["keep"] },
        { name: "mid", topics: ["keep"] },
      ],
    });
    /* Seeded before the first paint: main.js reads it once per visit. */
    w.win.localStorage.setItem("shelves:seen:octo", String(now - 7 * day));
    await settle(1600);
    const el = w.win.document.querySelector("#shelves-host .sh-weight");
    assert(ctx, el, "the shelf header must carry its weight");
    if (!el) return;
    const t = el.textContent;
    assert(ctx, /123/.test(t), "stars are totalled, got: " + t);
    assert(ctx, /1 stale/.test(t),
      "stale is nothing pushed in a year, got: " + t);
    assert(ctx, /1 since you were here/.test(t),
      "and the one GitHub cannot say, got: " + t);

    /* IT SAYS NOTHING RATHER THAN ZERO. A page the chips answered carries no
       stars and no dates, and `* 0 - 0 stale` would be a statement about the
       collection when it is a statement about the source. */
    const chips = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"] },
      repos: [{ name: "a", chips: ["keep"] }, { name: "b", chips: ["keep"] }],
    });
    await settle(1400);
    const cv = readShelves(chips.win);
    assert(ctx, cv && /via page$/.test(cv.note.split(" · ").slice(-1)[0] ? cv.note : ""),
      "the cheap rung answered, got: " + (cv || {}).note);
    assert(ctx, !chips.win.document.querySelector("#shelves-host .sh-weight"),
      "a source that carries no stars and no dates must say nothing at all");

    /* AND THE LAST-VISIT STAMP IS TAKEN ONCE. Read per render, the answer is
       "since a few hundred milliseconds ago", i.e. always zero. */
    assert(ctx, Number(w.win.localStorage.getItem("shelves:seen:octo")) >= now,
      "the visit is stamped for next time");
    ctx.info = "123 stars, 1 stale, 1 since you were here; silent on rung 1";
  }),

  check("sibling-shelves - the row says which shelves it also matched",
    async (ctx) => {
    /* First match wins the row and it has to: a repo on two shelves is two
       counts that do not add up. But the information that rule throws away is
       real, and it is most of what a reader wants when a shelf looks thin. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["tooling", "Java = lang:java", "ai"] },
      apiRepos: [
        { name: "both", topics: ["tooling", "ai"], language: "Java" },
        { name: "only-ai", topics: ["ai"], language: "Go" },
      ],
      repos: [
        { name: "both", topics: ["tooling", "ai"] },
        { name: "only-ai", topics: ["ai"] },
      ],
    });
    await settle(1600);
    const doc = w.win.document;
    const li = [...doc.querySelectorAll("#shelves-host li[data-sh-name]")]
      .find((x) => x.dataset.shName === "octo/both");
    assert(ctx, li, "the row must be on the page");
    if (!li) return;
    assert(ctx, li.closest("details").querySelector(".sh-name").textContent === "tooling",
      "first match still wins the row");

    const chips = [...li.querySelectorAll(".sh-sib")].map((x) => x.textContent);
    assert(ctx, chips.indexOf("Java") !== -1 && chips.indexOf("ai") !== -1,
      "and the shelves it also matched are given back, got: " + chips.join(" | "));
    assert(ctx, chips.indexOf("tooling") === -1,
      "never the shelf it is actually on - that is the shelf it is in");

    const solo = [...doc.querySelectorAll("#shelves-host li[data-sh-name]")]
      .find((x) => x.dataset.shName === "octo/only-ai");
    assert(ctx, solo && !solo.querySelector(".sh-sib"),
      "a row that matched one shelf wears nothing");

    /* THEY RIDE IN THE NOTE MARGIN, which on a row with no note is parked in
       the padding GitHub already leaves — so they cost the row no height. The
       pixels are only ever true in a browser; what is asserted here is that
       they are in that element and not in one of their own. */
    assert(ctx, li.querySelector(".sh-margin .sh-sibs"),
      "and they live in the margin, not in a line of their own");
    ctx.info = "on tooling, also Java and ai, no line of its own";
  }),

  check("pin-top - a few repos belong at the top of their shelf",
    async (ctx) => {
    /* A shelf of thirty is a scroll like any other. Ordering is the cheapest
       possible edit: the rows are already there, nothing is fetched, nothing
       is hidden. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [],
      pins: { "octo/c": true },
      repos: [
        { name: "a", topics: ["keep"], private: true },
        { name: "b", topics: ["keep"], private: true },
        { name: "c", topics: ["keep"], private: true },
      ],
    });
    await settle(1600);
    const doc = w.win.document;
    const order = () => [...doc.querySelectorAll("#shelves-host li[data-sh-name]")]
      .map((x) => x.dataset.shName.split("/")[1]);
    assert(ctx, order().join() === "c,a,b",
      "a pinned repo opens at the top of its shelf, got: " + order().join());

    /* AND NOTHING ELSE MOVES. GitHub's order inside a shelf is the reader's
       own `Sort` setting; the only claim being made is "these few first". */
    const li = [...doc.querySelectorAll("#shelves-host li[data-sh-name]")]
      .find((x) => x.dataset.shName === "octo/b");
    if (!li) return;
    li.querySelector(".sh-grip").click();
    const pick = li.querySelector(".sh-pinpick");
    assert(ctx, pick && /pin to top/.test(pick.textContent),
      "the grip offers it, got: " + ((pick || {}).textContent));
    if (!pick) return;
    pick.click();
    await settle(400);
    assert(ctx, order().join() === "c,b,a",
      "pinning puts it BELOW the ones already pinned, so pinning three in a " +
      "row does not reverse them, got: " + order().join());
    /* THE VALUE IS *WHEN*, not `true`. The page shows pinned rows in the order
       they were pinned — the order the reader watched them rise in — and
       without a stamp the next load re-derived that block in GitHub's own
       source order, so the page quietly rearranged itself between the session
       and the reload. The fixture seeds a legacy `true` above, which must
       still work and must sort first. */
    const stamp = (await w.win.Shelves.pins.read())["octo/b"];
    assert(ctx, typeof stamp === "number" && stamp > 0,
      "and it is written down, with when: " + JSON.stringify(stamp));

    /* AND THE ORDER SURVIVES A RELOAD. Pinning out of source order is the case
       that broke: pin `c` then `a` and the session showed `c,a` while the next
       load showed `a,c`. What `bucket()` derives must equal what the page did. */
    const derived = w.win.Shelves.bucket(
      [...doc.querySelectorAll("#shelves-host li[data-sh-name]")],
      [["keep"], ["keep"], ["keep"]],
      { groups: ["keep"], otherLabel: "Ungrouped" },
      [...doc.querySelectorAll("#shelves-host li[data-sh-name]")]
        .map((x) => x.dataset.shName),
      {}, [],
      { pins: await w.win.Shelves.pins.read() }
    );
    assert(ctx,
      (derived.buckets.get("keep") || []).map((x) => x.dataset.shName.split("/")[1])
        .join() === order().join(),
      "the next load must draw the order this one showed: page " +
      order().join() + " vs derived " +
      (derived.buckets.get("keep") || []).map((x) => x.dataset.shName.split("/")[1]).join());

    /* Unpinning drops it back under the pinned ones, not to the very bottom. */
    li.querySelector(".sh-grip").click();
    const off = li.querySelector(".sh-pinpick");
    assert(ctx, off && /unpin/.test(off.textContent),
      "the same control takes it back, got: " + ((off || {}).textContent));
    if (off) off.click();
    await settle(400);
    assert(ctx, order().join() === "c,b,a" || order().join() === "c,a,b",
      "unpinned it sits below the pinned ones, got: " + order().join());
    assert(ctx, (await w.win.Shelves.pins.read())["octo/b"] === undefined,
      "and the key goes with it");
    /* ---- AND A PIN MUST NOT RELOAD THE PAGE -------------------------------
       main.js reloads on any storage key it did not expect, and `pins` was not
       on the exemption list — so in a real browser every pin press reloaded,
       taking the reader's scroll, their filter and their open shelves with it,
       which is the precise cost `overrides` was added to that list to avoid.

       The harness could not see it: `onChanged` was a stub that never fired,
       so a correct exemption list and a forgotten entry looked identical.
       It fires now, and this is the assertion it was missing. */
    const was = w.reloads.n;
    await w.win.Shelves.pins.toggle("octo/a");
    await settle(300);
    assert(ctx, w.reloads.n === was,
      "writing a pin must be quiet, got " + (w.reloads.n - was) + " reload(s)");

    /* And the guard is real rather than vacuous — a key nobody exempted DOES
       reload, which is what makes the silence above mean something. */
    await new Promise((r) =>
      w.win.chrome.storage.sync.set({ startCollapsed: true }, r));
    await settle(400);
    assert(ctx, w.reloads.n === was + 1,
      "a setting the options page changed still reloads, got " +
      (w.reloads.n - was));

    ctx.info = "pinned rows first, in the order they were pinned";
  }),

  check("pins - the first paint keeps pin order, not GitHub's source order",
    async (ctx) => {
    /* THE SCENARIO ABOVE COULD NOT SEE THIS. Its reload check re-buckets rows
       the render had ALREADY stamped with `data-sh-name`, and the bug lived in
       exactly that stamp: `bucket()` sorted the pinned block by
       `li.dataset.shName`, which `render()` writes only after `bucket()` has
       returned. So on the first paint every stamp read as 0 and the pinned
       rows came out in GitHub's order. A cold run (chipped topics, no API)
       has no second pass to paper over it, so what is drawn after settle IS
       the first paint. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [],
      pins: { "octo/gamma": 1, "octo/alpha": 2 },
      repos: [
        { name: "alpha", topics: ["keep"], private: true },
        { name: "beta",  topics: ["keep"], private: true },
        { name: "gamma", topics: ["keep"], private: true },
      ],
    });
    await settle(1600);
    const doc = w.win.document;
    const order = [...doc.querySelectorAll("#shelves-host li[data-sh-name]")]
      .map((x) => x.dataset.shName.split("/")[1]).join();
    assert(ctx, order === "gamma,alpha,beta",
      "gamma was pinned first, so it is drawn first, got: " + order);

    /* AND STRAIGHT FROM `bucket()` ON UNSTAMPED ROWS, which is the input the
       first paint actually gives it. A legacy `true` predates every stamp and
       sorts first; unpinned rows keep their source order after the block —
       and a shelf whose rows are ALL pinned is still sorted, not skipped. */
    const mk = () => doc.createElement("li");
    const run = (names, pins) => {
      const rows = names.map(mk);
      const tag = new Map(rows.map((li, i) => [li, names[i]]));
      const out = w.win.Shelves.bucket(rows, names.map(() => ["keep"]),
        { groups: ["keep"], otherLabel: "Ungrouped" }, names, {}, [], { pins });
      return (out.buckets.get("keep") || []).map((li) => tag.get(li)).join();
    };
    const mixed = run(["u1", "p5", "u2", "legacy", "p3", "u3"],
      { p5: 5, legacy: true, p3: 3 });
    assert(ctx, mixed === "legacy,p3,p5,u1,u2,u3",
      "legacy first, then by stamp, then the unpinned in source order, got: " + mixed);
    const all = run(["a", "b", "c"], { a: 3, b: true, c: 1 });
    assert(ctx, all === "b,c,a",
      "a shelf that is all pins is still in pin order, got: " + all);

    ctx.info = "first paint " + order + "; mixed " + mixed;
  }),

  check("pins - a pinned row that changes shelf in the second pass lands in the pinned block",
    async (ctx) => {
    /* REBUCKET HONOURED THE SHELF AND DROPPED THE ORDER. Phase two moved a row
       only `if (li.parentElement !== ul)`, and moved it with `appendChild` —
       so a pinned repo whose shelf was only known once the ladder answered
       (a rule shelf on `lang:`, or here a private repo whose topics need the
       repo-page rung) arrived at the very bottom, under every unpinned row.
       Rung 4 is slowed so the two passes are two passes. */
    const at = Date.now();
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [],
      pins: { "octo/slow-p": 1, "octo/known-b": 2 },
      cache: {
        "octo/known-a": { at, topics: ["keep"], name: "octo/known-a", via: "page" },
        "octo/known-b": { at, topics: ["keep"], name: "octo/known-b", via: "page" },
      },
      repos: [
        { name: "known-a", topics: ["keep"], private: true },
        { name: "known-b", topics: ["keep"], private: true },
        { name: "slow-p", topics: ["keep"], private: true },
      ],
    });
    const real = w.win.fetch;
    w.win.fetch = (u) => new Promise((r) => setTimeout(() => r(real(u)), 700));
    const doc = w.win.document;
    const keep = () => {
      const d = [...doc.querySelectorAll("details.sh-shelf")].find(
        (x) => (x.querySelector(".sh-name") || {}).textContent === "keep");
      return d ? [...d.querySelectorAll("li[data-sh-name]")]
        .map((x) => x.dataset.shName.split("/")[1]).join() : "";
    };

    await settle(450);
    const host = doc.getElementById("shelves-host");
    assert(ctx, host && host.dataset.provisional === "1",
      "the first frame must be a guess, or this is not testing the second pass");
    const first = keep();
    assert(ctx, first === "known-b,known-a",
      "the guess shelves only the cached two, got: " + first);

    await settle(2600);
    assert(ctx, host.dataset.provisional === undefined, "and the answer arrives");
    const final = keep();
    assert(ctx, final === "slow-p,known-b,known-a",
      "slow-p was pinned first, so it goes on top of its new shelf, got: " + final);
    ctx.info = "guess " + first + " -> answer " + final;
  }),

  check("pins - moving a pinned row to another shelf files it in that shelf's pinned block",
    async (ctx) => {
    /* `moveRow` APPENDED, so a pinned repo moved by hand sat at the bottom of
       its new shelf until the next load put it back on top. It now goes where
       `bucket()` would have put it: among the target's pins, by pin time. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep", "other"] },
      apiRepos: [],
      pins: { "octo/o1": 1, "octo/mover": 2, "octo/o3": 3 },
      repos: [
        { name: "k1", topics: ["keep"], private: true },
        { name: "mover", topics: ["keep"], private: true },
        { name: "o1", topics: ["other"], private: true },
        { name: "o2", topics: ["other"], private: true },
        { name: "o3", topics: ["other"], private: true },
      ],
    });
    await settle(1600);
    const doc = w.win.document;
    const shelf = (label) => {
      const d = [...doc.querySelectorAll("details.sh-shelf")].find(
        (x) => (x.querySelector(".sh-name") || {}).textContent === label);
      return d ? [...d.querySelectorAll("li[data-sh-name]")]
        .map((x) => x.dataset.shName.split("/")[1]).join() : "";
    };
    assert(ctx, shelf("other") === "o1,o3,o2",
      "the target starts pins-first in pin order, got: " + shelf("other"));

    const li = [...doc.querySelectorAll("#shelves-host li[data-sh-name]")]
      .find((x) => x.dataset.shName === "octo/mover");
    if (!li) return assert(ctx, false, "no row for mover");
    li.querySelector(".sh-grip").click();
    const pick = [...li.querySelectorAll(".sh-shelfpick")]
      .find((x) => x.textContent === "other");
    assert(ctx, pick, "the menu offers `other`");
    if (!pick) return;
    pick.click();
    await settle(400);
    const got = shelf("other");
    assert(ctx, got === "o1,mover,o3,o2",
      "pinned between o1 (t=1) and o3 (t=3), above the unpinned o2, got: " + got);

    /* AND A PIN MADE THIS SESSION IS THE NEWEST, so it files after every
       older pin when moved — `repin` stamps the row with the time. */
    const k1 = [...doc.querySelectorAll("#shelves-host li[data-sh-name]")]
      .find((x) => x.dataset.shName === "octo/k1");
    k1.querySelector(".sh-grip").click();
    k1.querySelector(".sh-pinpick").click();
    await settle(400);
    k1.querySelector(".sh-grip").click();
    const to = [...k1.querySelectorAll(".sh-shelfpick")]
      .find((x) => x.textContent === "other");
    if (to) to.click();
    await settle(400);
    const after = shelf("other");
    assert(ctx, after === "o1,mover,o3,k1,o2",
      "a fresh pin files after the older ones, got: " + after);
    ctx.info = "moved into " + got + "; then " + after;
  }),

  check("backup - the three things nothing can rebuild can get out, and back in",
    async (ctx) => {
    /* The fact cache is derived and a rescan re-earns it; `groups` is a few
       words you can retype. Notes, by-hand shelvings and pins are none of
       that. And the charter lists "uninstalling is a complete undo" as a
       FEATURE — which it is, right up until it is pointed at the one category
       P.I exempts from being derivable. One profile reset took all three. */
    const w = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"] }, apiRepos: [],
      notes: { "octo/a": "the flaky one" },
      overrides: { "octo/b": "keep" },
      pins: { "octo/c": 1700000000000 },
      repos: [{ name: "a", topics: [] }, { name: "b", topics: [] },
              { name: "c", topics: ["keep"] }],
    });
    await settle(1400);
    const S = w.win.Shelves;

    const packed = await S.backup.pack(1700000000000);
    assert(ctx, packed.notes["octo/a"] === "the flaky one" &&
                packed.overrides["octo/b"] === "keep" &&
                packed.pins["octo/c"] === 1700000000000,
      "an export carries all three stores, got: " + JSON.stringify(packed));
    assert(ctx, !("token" in packed) && !("repoFacts" in packed) &&
                !("shelfMap" in packed),
      "and nothing else - a credential must never be in a file the reader " +
      "is invited to move between machines: " + Object.keys(packed).join());

    /* THE INCUMBENT WINS EVERY COLLISION. Importing is what a reader does when
       they are worried about losing something; a silent overwrite of the
       sentence they wrote this morning is the one unrecoverable act this
       extension would be capable of. */
    const incoming = JSON.parse(JSON.stringify({
      shelves: 1,
      notes: { "octo/a": "THEIRS", "octo/d": "a new one" },
      overrides: { "octo/d": "keep" },
      pins: { "octo/d": 1 },
    }));
    const r = S.backup.merge(
      { notes: packed.notes, overrides: packed.overrides, pins: packed.pins },
      incoming);
    assert(ctx, r.stores.notes["octo/a"] === "the flaky one",
      "a note already here survives an import, got: " +
      JSON.stringify(r.stores.notes["octo/a"]));
    assert(ctx, r.stores.notes["octo/d"] === "a new one", "and a new one lands");
    assert(ctx, r.added === 3 && r.kept === 1,
      "counted so that 'nothing happened' and 'you already had all of it' are " +
      "different sentences: added " + r.added + ", kept " + r.kept);

    /* A FILE IS THE MOST UNTRUSTED INPUT THIS EXTENSION TAKES — the only one
       that arrives without GitHub in front of it.

       `JSON.parse` and not an object literal, and the difference is the whole
       point: `{"__proto__": x}` written as a LITERAL sets the prototype and
       `Object.keys` never sees the key, so a fixture built that way tests
       nothing. Parsed from text it is a real own property, which is what the
       import path actually receives. */
    const hostile = JSON.parse('{"notes":{' +
      '"__proto__":"pwned",' +
      '"constructor":"pwned",' +
      '"octo/e":"fine",' +
      '"nota/repo/name":"x",' +
      '"NOSLASH":"x",' +
      '"../../settings/tokens":"x",' +
      '"octo/f":{"deep":1},' +
      '"octo/g":12345' +
      '},"pins":{"octo/e":"notatimestamp"},"overrides":{"octo/e":["array"]}}');
    const h = S.backup.merge({ notes: {}, overrides: {}, pins: {} }, hostile);
    assert(ctx, ({}).pwned === undefined &&
                Object.getPrototypeOf({}) === Object.prototype,
      "a key out of a file must not reach Object.prototype");
    assert(ctx, Object.keys(h.stores.notes).join() === "octo/e",
      "only keys that name a repository survive, got: " +
      Object.keys(h.stores.notes).join(" | "));
    assert(ctx, !Object.keys(h.stores.pins).length &&
                !Object.keys(h.stores.overrides).length,
      "and only values of the shape that store holds, got pins " +
      JSON.stringify(h.stores.pins) + " overrides " +
      JSON.stringify(h.stores.overrides));
    /* Seven keys in `notes` that name no repository or carry the wrong shape,
       plus one in `pins` and one in `overrides`. */
    assert(ctx, h.skipped === 9,
      "every refusal is counted rather than silent, got " + h.skipped);

    /* AND IT ROUND-TRIPS THROUGH THE STORE, not just through the merge. */
    const back = await S.backup.restore({ notes: { "octo/z": "restored" } });
    assert(ctx, back.ok && (await S.notes.read())["octo/z"] === "restored",
      "a restore reaches the store the page reads");
    ctx.info = "3 stores out, incumbent wins, 9 hostile keys refused";
  }),

  check("vocabulary - the tag system, read as a system", async (ctx) => {
    /* Every finding the panel can make, in one small collection:
         project      on 5 of 6 tagged repos      -> a blanket label
         ai-project / aiproject                   -> one idea, two spellings
         ai                                       -> a word inside ai-project
         kubernetes / kubernets                   -> one character apart
       and four topics used exactly once. */
    const w = build({
      owner: "octo",
      settings: { groups: ["ai-project", "kubernetes"] },
      apiRepos: [],
      repos: [
        { name: "alpha", topics: ["project", "ai-project"] },
        { name: "beta", topics: ["project", "ai-project"] },
        { name: "gamma", topics: ["project", "aiproject"] },
        { name: "delta", topics: ["project", "ai"] },
        { name: "epsilon", topics: ["project", "kubernetes"] },
        { name: "zeta", topics: ["kubernets"] },
      ],
    });
    await settle(1200);
    let v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;

    const p = openVocab(w.win);
    assert(ctx, p.open, "the audit button must open the panel");
    if (!p.open) return;

    /* THE BADGE IS THE POINT. A panel nobody opens tells nobody anything, and
       the premise is that these problems are invisible - so the count has to be
       on the CLOSED button.

       NINE, not six: the topics half finds 1 family + 3 suspicions + 1 blanket
       + 1 habit, and the repos half finds three gaps beside it (none of these
       fixtures carries a description, a README or a licence). One button, one
       count, both questions - which is the arrangement being asserted here. */
    assert(ctx, w.win.Shelves.vocabIssues(
      w.win.Shelves.vocabulary(
        [["project", "ai-project"], ["project", "ai-project"], ["project", "aiproject"],
         ["project", "ai"], ["project", "kubernetes"], ["kubernets"]], [])) === 6,
      "the topics half alone must find 6");
    assert(ctx, p.badge === 9, "the toolbar must badge every finding, got " + p.badge);
    assert(ctx, /6 of 6 repos tagged/.test(p.sub) && /6 topics/.test(p.sub),
      "the topics section counts its own subject, got: " + p.sub);

    const kinds = (k) => p.finds.filter((f) => f.kind === k);

    const fams = kinds("family");
    assert(ctx, fams.length === 1, "one family, got " + fams.length);
    assert(ctx, fams[0] && fams[0].terms.join() === "ai-project,aiproject",
      "the family is the two spellings, got: " + (fams[0] || {}).terms);
    /* THE REPO COUNT IS A UNION, NOT A SUM. Two spellings across three repos is
       three; saying four would turn a labelling problem into a bigger
       collection, which is the opposite of what the panel is for. */
    assert(ctx, fams[0] && /across 3 repos/.test(fams[0].text),
      "spellings are counted as a union of repos, got: " + (fams[0] || {}).text);

    const blanket = kinds("blanket");
    assert(ctx, blanket.length === 1 && blanket[0].terms.join() === "project",
      "'project' is on almost everything and must be named, got: " +
      JSON.stringify(blanket.map((b) => b.terms)));
    assert(ctx, /5 of 6/.test(blanket[0] ? blanket[0].text : ""),
      "and its share is stated, got: " + (blanket[0] || {}).text);

    /* A GUESS IS DRAWN AS A GUESS. Same letters is arithmetic and becomes a
       family; "looks related" is this panel's opinion and stays a suspicion,
       never merged into anything. */
    const typo = kinds("typo");
    assert(ctx, typo.length === 1 && typo[0].terms.slice().sort().join() ===
      "kubernetes,kubernets",
      "a one-character difference is offered as a typo, got: " +
      JSON.stringify(typo.map((t) => t.terms)));
    const narrow = kinds("narrower").map((n) => n.terms.join());
    assert(ctx, narrow.indexOf("ai,ai-project") !== -1,
      "'ai' is a whole word inside 'ai-project', got: " + JSON.stringify(narrow));

    const once = kinds("once");
    assert(ctx, once.length === 1 && /4 used once/.test(once[0].tag),
      "four topics used once, counted as ONE habit, got: " +
      JSON.stringify(once.map((o) => o.tag)));

    assert(ctx, p.terms.length === 6, "every topic is listed, got " + p.terms.length);
    const chip = Object.fromEntries(p.terms.map((t) => [t.topic, t]));
    assert(ctx, chip.project && chip.project.count === 5, "with its repo count");
    assert(ctx, chip["ai-project"] && chip["ai-project"].shelf === true,
      "a topic that is already a shelf wears that shelf's own mark");
    assert(ctx, chip.project && chip.project.shelf === false,
      "and one that is not, does not");

    /* Reading that a label is broken is half of it; seeing WHICH repos wear it
       is the other half, and it is one press away. */
    pickTerm(w.win, "aiproject");
    v = readShelves(w.win);
    assert(ctx, v.visible.join() === "gamma",
      "pressing a topic filters the page to its repos, got: " + v.visible.join());

    /* THE SUSPICION PASS USED TO BE O(k^2) AND RAN ON EVERY RENDER, opened or
       not, because the badge needs it. Measured before the fix: 330 ms at
       1 000 distinct topics, 1.3 s at 2 000, 5.2 s at 4 000, 25 s on a
       synthetic 600-repo account - a frozen tab, on exactly the accounts this
       extension is for. Two indexes replaced the pairwise scan; this pins it. */
    const many = Array.from({ length: 600 }, (_, i) =>
      Array.from({ length: 5 }, (_, j) => "topic-name-" + ((i * 5 + j) % 3000)));
    const t0 = Date.now();
    const big = w.win.Shelves.vocabulary(many, many.map((_, i) => "o/r" + i));
    const ms = Date.now() - t0;
    assert(ctx, ms < 400, "3000 topics must resolve in well under a frame budget, took " + ms + " ms");
    assert(ctx, big.near.length <= 40 && big.terms.length <= 200,
      "and the LISTS are capped too, or the DOM becomes the next unbounded thing");
    assert(ctx, big.nearMore > 0 && big.termsMore > 0,
      "with the truncation counted, never silent");

    ctx.info = p.badge + " findings over " + p.terms.length + " topics · 3000 topics in " + ms + " ms";
  }),

  check("audit - what is missing from the REPOS, honestly denominated", async (ctx) => {
    /* Two sources answer this collection, which is the whole point of the
       scenario: `a` and `b` come from the API and `c`/`d`/`e` from their own
       pages. The API body carries no README at all, so a README gap counted
       over all five would be reporting the API's shape as the reader's
       failing - on a token-holding account, for every repo they own. */
    const w = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      repos: [
        { name: "a", topics: [], description: "public one", license: "MIT" },
        { name: "b", topics: [], license: "MIT" },
        { name: "c", topics: ["keep"], private: true, description: "private one",
          license: "MIT", readme: "It reads like this." },
        { name: "d", topics: [], private: true },
        { name: "e", topics: [], private: true, description: "done with", archived: true },
      ],
      apiRepos: [
        { name: "a", topics: [], description: "public one", license: "MIT" },
        { name: "b", topics: [], license: "MIT" },
      ],
    });
    await settle(1400);
    let v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;

    const A = w.win.Shelves.audit;
    const p = openVocab(w.win);
    const gap = Object.fromEntries(
      p.finds.filter((f) => f.kind === "gap" || f.kind === "archived")
        .map((f) => [f.tag, f])
    );

    assert(ctx, /4 of 5/.test((gap["no topics"] || {}).text || ""),
      "4 of 5 have no topics, got: " + (gap["no topics"] || {}).text);

    /* THE LOAD-BEARING ASSERTION. Three repos were read from their own pages
       and could therefore be asked about a README; two were answered by the
       API and could not. The denominator has to be 3. */
    const readme = (gap["no README"] || {}).text || "";
    assert(ctx, /2 of 3/.test(readme),
      "a README gap is denominated over the repos whose source could carry one, got: " +
      readme);
    assert(ctx, /readme/.test(p.caveat) && /2 repos/.test(p.caveat),
      "and what could not be asked is SAID, not silently dropped, got: " + p.caveat);

    /* Description and licence are carried by both sources, so those denominate
       over all five - the rule is per field, not per record. */
    assert(ctx, /2 of 5/.test((gap["no description"] || {}).text || ""),
      "descriptions denominate over everything, got: " + (gap["no description"] || {}).text);
    assert(ctx, /1 of 5/.test((gap.archived || {}).text || ""),
      "the archived repo is named, got: " + (gap.archived || {}).text);

    /* An audit finding is not a query anyone could type, so it addresses rows
       by NAME - and that mode has to move the same page the text filter does. */
    pickGap(w.win, "no README");
    v = readShelves(w.win);
    assert(ctx, v.visible.sort().join() === "d,e",
      "pressing a finding shows exactly those repos, got: " + v.visible.join());
    assert(ctx, /no README/.test(v.found),
      "and the bar says which set it is showing, got: " + v.found);

    // the reader's next keystroke drops straight back into text search
    type(w.win, "private one");
    v = readShelves(w.win);
    assert(ctx, v.visible.join() === "c",
      "typing leaves the name-set mode, got: " + v.visible.join());
    type(w.win, "");
    v = readShelves(w.win);
    assert(ctx, v.visible.length === 5, "and clearing restores every row");

    // the pure function, asked directly, for the shape rather than the wording
    const direct = A(
      [{ via: "api" }, { via: "api" }, { via: "page", readme: "x" }, { via: "page" }],
      ["o/a", "o/b", "o/c", "o/d"], [[], [], [], []]
    );
    const r = direct.gaps.find((g) => g.key === "noreadme");
    assert(ctx, r && r.of === 2 && r.names.join() === "o/d",
      "audit() itself never asks a source a question it cannot answer");
    ctx.info = "gaps denominated per field, per source";
  }),

  check("mark - the shelf follows the repo onto its own page", async (ctx) => {
    const w = build({
      owner: "octo",
      at: "octo/throttle-kit",
      settings: { groups: ["rag", "tooling"] },
      page: { topics: ["rag"], description: "Token bucket rate limiting" },
      notes: { "octo/throttle-kit": "the one with the broken deploy" },
    });
    await settle();

    const m = readMark(w.win);
    assert(ctx, m, "no chip on the repo's own page");
    if (!m) return;

    assert(ctx, m.label === "rag", "it names the shelf, got: " + m.label);
    assert(ctx, m.href === "/octo?tab=repositories",
      "and links back to the shelves, got: " + m.href);
    assert(ctx, m.inSidebar,
      "the chip belongs beside the topics that put it on that shelf");

    /* THE COLOUR MUST BE THE SAME COLOUR. identity() resolves palette
       collisions across the whole label set, so a page that guessed from one
       label would produce a chip that disagrees with the shelves - and a mark
       that disagrees is worse than no mark. */
    const want = w.win.Shelves.identity(["rag", "tooling", "Ungrouped"], "Ungrouped").get("rag");
    assert(ctx, m.glyph === want.glyph && m.hue === String(want.hue),
      "the chip wears the shelf's own mark, got " + m.glyph + "/" + m.hue +
      " want " + want.glyph + "/" + want.hue);

    /* The note is the reason this beats a breadcrumb: it exists nowhere on
       GitHub and was previously only visible on a page you had left. */
    assert(ctx, m.note === "the one with the broken deploy",
      "the private note comes with it, got: " + m.note);

    // FREE. This is a page the reader opened to read code, not to be shelved.
    assert(ctx, w.counters.api === 0 && w.counters.scraped.length === 0,
      "the mark must cost no request at all");

    // idempotent, like run(): turbo fires repeatedly and the observer wakes often
    w.win.document.dispatchEvent(new w.win.Event("turbo:render"));
    w.win.document.body.appendChild(w.win.document.createElement("div"));
    await settle();
    assert(ctx, w.win.document.querySelectorAll("#shelves-mark").length === 1,
      "a second pass must not hang a second chip");

    /* github.com/<a>/<b> is a guess, not a shape. */
    const P = w.win.Shelves.isRepoPage;
    const at = (path, search) => P({ pathname: path, search: search || "" });
    assert(ctx, at("/octo/throttle-kit"), "a real repo page");
    assert(ctx, !at("/settings/appearance"), "settings is not a repository");
    assert(ctx, !at("/orgs/acme"), "nor is an org page");
    assert(ctx, !at("/features/copilot"), "nor a marketing page");
    assert(ctx, !at("/octo/throttle-kit/issues"), "nor a sub-page: no About sidebar");
    assert(ctx, !at("/octo", "?tab=repositories"), "nor the profile tab itself");

    /* THE CLASS IS A FAST PATH, NOT THE FINDER. Measured on a real logged-in
       repo page: neither `.Layout-sidebar` nor the testid matched, and the chip
       never appeared beside an About panel that was plainly on screen. A class
       name is the half of GitHub's markup that churns, so the fallback climbs
       from the "About" heading to the first ancestor holding another sidebar
       landmark. */
    const moved = build({
      owner: "octo",
      at: "octo/throttle-kit",
      settings: { groups: ["rag", "tooling"] },
      page: { topics: ["rag"], sidebarClass: "AboutPanel-module__container--x7f2k" },
    });
    await settle();
    const mm = readMark(moved.win);
    assert(ctx, mm && mm.label === "rag",
      "a renamed sidebar must not cost the chip, got: " + JSON.stringify(mm));
    assert(ctx, mm && mm.box.parentElement &&
      /AboutPanel/.test(mm.box.parentElement.className),
      "and it still lands INSIDE the panel it belongs to, got: " +
      (mm && mm.box.parentElement ? mm.box.parentElement.className : "nowhere"));

    /* ...and a page with neither an About panel nor a title still draws
       nothing, because a chip in the wrong place is worse than no chip. */
    const bare = build({
      owner: "octo", at: "octo/nothing-here",
      settings: { groups: ["rag"] },
      page: { topics: [], sidebarClass: "x", noAbout: true },
    });
    await settle();
    assert(ctx, readMark(bare.win) === null,
      "with nowhere safe to sit, it draws nothing rather than guessing");
    ctx.info = m.glyph + " " + m.label + " + note, zero requests; survives a renamed sidebar";
  }),

  check("mark follows an override - the chip and the shelf must never disagree",
    async (ctx) => {
    /* THE FAILURE THE WHOLE SHELF MAP EXISTS TO PREVENT. `bucketFor` on this
       page was called without the third argument, so the chip resolved from
       TOPICS alone: a repo pinned to `keep` wore `elsewhere`, and an untagged
       repo pinned to a real shelf wore `Ungrouped`, uncoloured - the feature
       disagreeing with itself on the one page built to agree with it. */
    const w = build({
      viewer: "octo",
      at: "octo/nameless",
      owner: "octo",
      settings: { groups: ["keep", "elsewhere"] },
      overrides: { "octo/nameless": "keep" },
      shelfMap: { octo: { order: ["keep", "elsewhere", "Ungrouped"],
                          counts: { keep: 4 }, at: Date.now() } },
      page: { name: "nameless", topics: [] },
      repos: [{ name: "nameless", topics: [] }],
    });
    await settle(900);
    const m = readMark(w.win);
    assert(ctx, m, "the chip must still be drawn");
    if (!m) return;
    assert(ctx, m.label === "keep",
      "an untagged repo the reader pinned wears the shelf they put it on, got: " +
      m.label);

    /* A RULE SHELF THE CHIP COULD NOT POSSIBLY RE-DERIVE. At the ~160ms the
       mark is drawn, GitHub has not rendered the languages bar or the
       timestamps — they arrive with its own client-side pass — so `lang:java`
       is unanswerable here and re-deriving fell to Ungrouped on a repo the
       profile had on `Java`. The map is the answer; it is written on every
       render for exactly this. */
    const ruled = build({
      viewer: "octo", at: "octo/app", owner: "octo",
      settings: { groups: ["Java = lang:java"] },
      shelfMap: { octo: { order: ["Java", "Ungrouped"], counts: { Java: 4 },
                          on: { "octo/app": "Java" } } },
      page: { name: "app", topics: [] },      // nothing on the page says Java
      repos: [{ name: "app", topics: [] }],
    });
    await settle(900);
    const rm = readMark(ruled.win);
    assert(ctx, rm && rm.label === "Java",
      "the chip reads the shelf the profile recorded, got: " + ((rm || {}).label));
    assert(ctx, rm && !rm.plain,
      "and wears that shelf's colour rather than the leftovers one");
    assert(ctx, !m.plain && m.hue,
      "and it is coloured like that shelf, not drawn as the leftovers one");
    ctx.info = "pinned to keep, chip reads keep " + (m.glyph || "");
  }),

  check("mark degrades - no shelf map means no colour, never a wrong one",
    async (ctx) => {
      /* Auto-grouping derives its labels from every repo's topics, which a
         single repo page cannot see. With no map written by the profile page
         there is genuinely no way to know the palette, so the chip names the
         shelf and declines to claim a colour. */
      const w = build({
        owner: "octo",
        at: "octo/throttle-kit",
        settings: { groups: [] },
        page: { topics: ["rag"] },
      });
      await settle();
      let m = readMark(w.win);
      assert(ctx, m, "a missing map must not cost the chip");
      if (!m) return;
      assert(ctx, m.label === "rag", "the shelf is still named, got: " + m.label);
      assert(ctx, m.plain && m.hue === "",
        "but no colour is invented, got hue=" + m.hue);

      /* Given the map the profile page leaves behind, the same page now agrees
         with the shelves exactly. */
      const w2 = build({
        owner: "octo",
        at: "octo/throttle-kit",
        settings: { groups: [] },
        page: { topics: ["rag"] },
        shelfMap: { octo: { order: ["aiproject", "rag", "tooling", "Ungrouped"],
                            counts: { rag: 7 }, at: Date.now() } },
      });
      await settle();
      m = readMark(w2.win);
      const want = w2.win.Shelves.identity(
        ["aiproject", "rag", "tooling", "Ungrouped"], "Ungrouped").get("rag");
      assert(ctx, m && !m.plain && m.hue === String(want.hue) && m.glyph === want.glyph,
        "with the map it matches the shelves exactly, got " +
        JSON.stringify(m && [m.glyph, m.hue]));
      assert(ctx, m && m.count === "7", "and carries the shelf's size, got: " + (m || {}).count);

      /* THE LEFTOVERS CHIP KEEPS ITS DOT. Caught in a real browser: the glyph
         was inside the branch that paints the colour, and the plain shelf has
         no colour by design — so `Ungrouped` wore its dot on the shelf and
         nothing at all on the chip. Two drawings of one thing that disagree is
         the exact failure the identity system exists to prevent. */
      const w3 = build({
        owner: "octo",
        at: "octo/untagged-thing",
        settings: { groups: ["rag"] },
        page: { topics: [] },
      });
      await settle();
      const u = readMark(w3.win);
      assert(ctx, u && u.label === "Ungrouped" && u.plain,
        "a repo with no topics lands on the leftovers shelf, got: " + JSON.stringify(u));
      assert(ctx, u && u.glyph === "·",
        "and still wears the mark the shelf wears, got: " + JSON.stringify((u || {}).glyph));
      ctx.info = "no map: named but uncoloured; with map: identical to the shelf";
    }),

  check("warm - opt-in, bounded, and it never discovers", async (ctx) => {
    const day = 86400000;
    const now = Date.now();
    const w = build({
      owner: "octo",
      at: "octo/throttle-kit",
      page: { topics: ["rag"] },
      // what exists on this fake GitHub, so a top-up fetch can resolve
      repos: ["old-one", "older", "oldest", "fresh"].map((n) => ({
        name: n, topics: ["rag"], description: "warmed",
      })),
      cache: {
        "octo/old-one": { at: now - 6 * day, topics: [] },
        "octo/older": { at: now - 20 * day, topics: [] },
        "octo/oldest": { at: now - 40 * day, topics: [] },
        "octo/fresh": { at: now - 60000, topics: ["rag"] },
      },
    });
    await settle();
    const S = w.win.Shelves;
    const base = { cacheDays: 7, warmBatch: 2, prewarm: true };

    /* OFF BY DEFAULT, AND IT HAS TO BE. Everything else here spends a request
       on a page the reader opened to see the result; this spends them on pages
       they opened for something else, which needs its own consent (P.II). */
    const off = await S.warm({ ...base, prewarm: false }, { gap: 0, now });
    assert(ctx, off.warmed === 0 && off.why === "off",
      "prewarm must default off, got: " + JSON.stringify(off));
    const loaded = await S.load();
    assert(ctx, loaded.prewarm === false,
      "and the stored default must be off, got: " + loaded.prewarm);

    const before = w.counters.scraped.length;
    const out = await S.warm(base, { gap: 0, now });

    assert(ctx, out.warmed === 2,
      "the budget is warmBatch and no more, warmed " + out.warmed);
    const fetched = w.counters.scraped.slice(before);
    /* STALEST FIRST, or a budget of two spent over many visits circles the
       same two names and the rest of the cache never gets refreshed at all. */
    assert(ctx, fetched.join() === "octo/oldest,octo/older",
      "the stalest are refreshed first, got: " + fetched.join());
    assert(ctx, fetched.indexOf("octo/fresh") === -1,
      "and a fresh entry is left alone");

    /* IT REFRESHES; IT NEVER DISCOVERS. A first run is still cold - the point
       is that the second week is not. */
    assert(ctx, !w.counters.scraped.some((n) => n === "octo/throttle-kit"),
      "the repo we are standing on is not in the cache and must not be fetched");

    const after = w.store.local.repoFacts || {};
    assert(ctx, after["octo/oldest"] && after["octo/oldest"].at > now - 1000,
      "and the refreshed entry is written back");
    assert(ctx, after["octo/oldest"] && after["octo/oldest"].saw === undefined,
      "a parse's own evidence must never reach the cache");

    // The profile tab warms itself; two writers on one cache is a race.
    const w2 = build({ owner: "octo", settings: {}, repos: [{ name: "x", chips: ["a"] }] });
    await settle();
    const onTab = await w2.win.Shelves.warm(base, { gap: 0, now });
    assert(ctx, onTab.warmed === 0 && /profile tab/.test(onTab.why),
      "it must stand down on the page the ladder already owns, got: " + onTab.why);

    /* A background job that keeps knocking through a 429 is how a convenience
       gets the foreground throttled. */
    const w3 = build({
      owner: "octo", at: "octo/throttle-kit", page: { topics: [] },
      repos: [{ name: "a", topics: [] }, { name: "b", topics: [] }],
      cache: {
        "octo/a": { at: now - 40 * day, topics: [] },
        "octo/b": { at: now - 40 * day, topics: [] },
      },
    });
    await settle();
    w3.win.fetch = async () => ({ ok: false, status: 429, text: async () => "" });
    const hit = await w3.win.Shelves.warm({ ...base, warmBatch: 2 }, { gap: 0, now });
    assert(ctx, hit.warmed === 0 && /429/.test(hit.why),
      "one refusal ends the visit, got: " + JSON.stringify(hit));
    ctx.info = "off by default; " + out.warmed + " stalest refreshed; stops on 429";
  }),

  check("canary - a moved selector is SAID, not silently absorbed", async (ctx) => {
    /* The pages still carry their topics, and the parse still returns
       something that looks right - the About panel is simply no longer called
       `.Layout-sidebar` and the description meta is gone. That is precisely the
       failure worth catching: a page that came back empty would have been
       obvious without a canary. */
    const broken = (n) => ({ name: n, topics: ["keep"], private: true, broken: true });
    const w = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [],
      repos: [broken("a"), broken("b"), broken("c"), broken("d"),
              broken("e"), broken("f")],
    });
    await settle(1600);
    const v = readShelves(w.win);
    assert(ctx, v, "a broken page must never cost the render");
    if (!v) return;

    assert(ctx, /changed shape/.test(v.canary),
      "the canary must say the page moved, got: " + JSON.stringify(v.canary));
    assert(ctx, /read 6 pages/.test(v.canary),
      "with the sample it is speaking from, got: " + v.canary);
    // it must still shelve: a warning is not a failure (P.III)
    const total = v.shelves.reduce((n, s) => n + s.count, 0);
    assert(ctx, total === 6, "every repo is still on the page, got " + total);

    /* A RENAMED CLASS IS RECOVERED, NOT MOURNED. `broken` renames the About
       panel's class AND drops the description meta; the class half is exactly
       what the structural finder in facts.js exists for, and it is why this
       assertion is about the TOPICS rather than about the sentence. The
       fixture has carried a decoy `/topics/decoy` link outside the sidebar
       since it was written, and nothing ever asserted it stayed out — which is
       how `|| doc` survived: a fabricated field looks exactly like a found one.

       MEASURED, the day this changed: the old class pair matched 0 of 6 real
       repo pages parsed the way scrape() parses them, and 0 of 50 on a live
       run. The finder matched 6 of 6. */
    assert(ctx, !/changed shape.*sidebar/.test(v.canary) &&
                !/About sidebar on 0/.test(v.canary),
      "a merely renamed class must be RECOVERED by the structural finder, " +
      "not reported as a moved sidebar, got: " + v.canary);
    const keep = v.shelves.find((sh) => sh.label === "keep");
    assert(ctx, keep && keep.count === 6,
      "and the topics must still be read out of it, keep holds: " +
      ((keep || {}).count));
    assert(ctx, !v.shelves.some((sh) => sh.label === "decoy"),
      "the README's decoy /topics/ link must never become a shelf — that is " +
      "what scoping is for, and `|| doc` is how it was lost");

    /* FIVE PAGES IS THE FLOOR. Below it a run of genuinely sparse repos is
       indistinguishable from a dead selector, and a canary that cries on a
       sample of two is turned off within a week. */
    const small = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [],
      repos: [broken("a"), broken("b"), broken("c"), broken("d")],
    });
    await settle(1400);
    assert(ctx, readShelves(small.win).canary === "",
      "four pages is not a sample, got: " + readShelves(small.win).canary);

    /* AND THE GRAVE CASE STILL EXISTS. `noAbout` takes the heading the finder
       climbs from, so there is genuinely nowhere to read topics from — the
       failure the canary was written for, now stated in the one shape that
       still produces it. */
    const gone = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [],
      repos: "abcdef".split("").map((n) => ({
        name: n, topics: ["keep"], private: true, broken: true, noAbout: true,
      })),
    });
    await settle(1600);
    const g = readShelves(gone.win);
    assert(ctx, /unreliable/.test(g.canary || ""),
      "no About panel at all is grave — every shelf depends on it, got: " +
      JSON.stringify((g || {}).canary));

    // and a healthy run says nothing at all
    const ok = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      apiRepos: [],
      repos: "abcdef".split("").map((n) => ({
        name: n, topics: ["keep"], private: true, description: "fine",
      })),
    });
    await settle(1600);
    assert(ctx, readShelves(ok.win).canary === "",
      "an intact page must be silent, got: " + readShelves(ok.win).canary);
    ctx.info = "renamed class recovered; no About panel is grave; 4 below the floor; a healthy run quiet";
  }),

  check("credentials - the reader's token and session are spent on the reader's " +
        "own pages only", async (ctx) => {
    /* MEASURED BEFORE THE FIX, on a stranger's profile with the reader's own
       token: 1 API call carrying the reader's Bearer, 12 of the stranger's repo
       pages fetched with the reader's cookie, and 12 entries written to the
       reader's cache — which the background top-up then refreshes forever. One
       click on a link. This scenario is that measurement, inverted. */
    const strangers = Array.from({ length: 8 }, (_, i) => ({
      name: "theirs-" + i, topics: ["aiproject"], private: false,
    }));
    const away = build({
      viewer: "me",                       // signed in as...
      owner: "some-stranger",             // ...looking at someone else
      token: "github_pat_THE_READERS_OWN",
      settings: { groups: ["aiproject"] },
      repos: strangers,
      apiRepos: [],                       // API answers nothing -> rung 4 would fire
    });
    await settle(1500);
    const v = away.win.Shelves;
    assert(ctx, v.isMine() === false, "the guard must see this is not the reader's profile");

    assert(ctx, away.counters.lastAuth === false,
      "the reader's token must NOT be sent to a page it cannot answer for");
    assert(ctx, away.counters.scraped.length === 0,
      "and no repo page of theirs may be fetched with the reader's cookie, got " +
      away.counters.scraped.length);
    assert(ctx, Object.keys(away.store.local.repoFacts || {}).length === 0,
      "and nothing of theirs may enter the reader's cache");

    /* A NARROWING, NOT A REFUSAL. The free rungs still run, so the page is
       still shelved - and P.IV means the toolbar says which rungs answered. */
    const view = readShelves(away.win);
    assert(ctx, view, "a stranger's profile must still render");
    assert(ctx, view && /not yours/.test(view.note),
      "the source line says so, got: " + (view || {}).note);
    assert(ctx, view && /free rungs only/.test(view.warn),
      "and the warning explains the narrowing, got: " + (view || {}).warn);

    // ...and on the reader's OWN profile nothing has changed.
    const home = build({
      viewer: "me", owner: "me", token: "github_pat_THE_READERS_OWN",
      settings: { groups: ["aiproject"] },
      repos: [{ name: "mine", topics: ["aiproject"], private: true }],
      apiRepos: [{ name: "mine", topics: ["aiproject"], private: true }],
    });
    await settle();
    assert(ctx, home.win.Shelves.isMine() === true, "the reader's own profile is theirs");
    assert(ctx, home.counters.lastAuth === true,
      "and the token is still sent where it can actually answer");

    /* UNKNOWN COUNTS AS MINE. If the meta ever moves, answering "not yours"
       would disable the extension for everybody at once. */
    const blind = build({
      owner: "whoever", token: "github_pat_X",       // no viewer meta at all
      settings: { groups: ["aiproject"] },
      repos: [{ name: "r", topics: ["aiproject"], private: true }],
      apiRepos: [],
    });
    await settle(1200);
    assert(ctx, blind.win.Shelves.isMine() === true,
      "an unreadable viewer must degrade to the old behaviour, not to nothing");

    /* The chip is about the reader's OWN shelves; on someone else's repository
       it would answer a question nobody asked. */
    const theirRepo = build({
      viewer: "me", at: "some-stranger/thing",
      settings: { groups: ["aiproject"] },
      page: { topics: ["aiproject"], viewer: "me" },
    });
    await settle();
    assert(ctx, readMark(theirRepo.win) === null,
      "no shelf chip on a repository that is not the reader's");
    ctx.info = "stranger: 0 token, 0 scrapes, 0 cache writes, still shelved";
  }),

  /* ---- SIGNED OUT ------------------------------------------------------
     `isMine()` read "no viewer" as "cannot tell, behave as before" — which is
     right when GitHub moves the meta, and exactly wrong when GitHub is saying
     out loud that nobody is signed in. Signed out on github.com/torvalds the
     guard answered "yes, yours": the reader's configured token went to
     `/user/repos` (answering with the READER's repos, on Linus's page), rung 4
     fetched the stranger's repo pages, and every one of them entered
     `repoFacts`, which the background top-up then refreshes forever. These
     four pin the tri-state: signed out is NOT unknown, and unknown is still
     unknown. */

  check("signed out — a stranger's profile gets the free rungs only", async (ctx) => {
    const theirs = Array.from({ length: 6 }, (_, i) => ({
      name: "kernel-" + i, topics: ["aiproject"],        // no chips: rung 4 bait
    }));
    const w = build({
      signedOut: true,                     // body.logged-out, empty user-login
      owner: "torvalds",
      token: "github_pat_THE_READERS_OWN", // configured, and NOT to be spent here
      settings: { groups: ["aiproject"] },
      repos: theirs,
      apiRepos: [],                        // API answers nothing -> rung 4 would fire
    });
    await settle(1500);
    const S = w.win.Shelves;

    /* THE GUARD ITSELF, read directly. Signed out has no viewer, and that is
       the whole point — the empty viewer is what used to be read as "mine". */
    assert(ctx, S.viewer() === "", "signed out has no viewer, got: " + JSON.stringify(S.viewer()));
    assert(ctx, typeof S.signedIn === "function",
      "S.signedIn is missing — there is no way to tell signed out from unknown");
    if (typeof S.signedIn === "function") {
      assert(ctx, S.signedIn() === false,
        "a logged-out body with an empty user-login meta is POSITIVE evidence, got: " +
        JSON.stringify(S.signedIn()));
    }
    assert(ctx, S.isMine() === false,
      "signed out, no profile on GitHub is the reader's, got isMine() === " + S.isMine());

    /* THE CREDENTIALS. Every call, not the last one. */
    const authed = w.counters.calls.filter((c) => c.auth);
    assert(ctx, w.counters.calls.length > 0, "the public API must still be asked (free rung)");
    assert(ctx, authed.length === 0,
      "the reader's token must not be sent while signed out, carried on: " +
      authed.map((c) => c.url).join(", "));
    assert(ctx, !w.counters.calls.some((c) => /\/user\/repos/.test(c.url)),
      "and `/user/repos` — the reader's OWN list — must not be asked on torvalds' page, got: " +
      w.counters.calls.map((c) => c.url).join(", "));
    assert(ctx, w.counters.scraped.length === 0,
      "rung 4 must not fetch a stranger's repo pages, fetched " + w.counters.scraped.length +
      ": " + w.counters.scraped.join(", "));
    const facts = Object.keys(w.store.local.repoFacts || {});
    assert(ctx, facts.length === 0,
      "and nothing of theirs may enter repoFacts for the top-up to refresh, got " +
      facts.length + ": " + facts.join(", "));

    /* A NARROWING, NOT A REFUSAL — exactly as for a signed-in stranger. */
    const v = readShelves(w.win);
    assert(ctx, v, "a signed-out reader's page must still be shelved");
    if (v) {
      const rows = v.shelves.reduce((n, s) => n + s.count, 0);
      assert(ctx, rows === theirs.length,
        "every row is still on a shelf, counted " + rows + " of " + theirs.length);
      assert(ctx, /not yours|signed out/.test(v.note),
        "the source line says which rungs were allowed to answer, got: " + v.note);
    }
    const doc = w.win.document;
    assert(ctx, doc.querySelectorAll("#shelves-host .sh-grip").length === 0,
      "no grip — it would pin a stranger's repo in the reader's store, got " +
      doc.querySelectorAll("#shelves-host .sh-grip").length);
    const rec = (w.store.local.shelfMap || {}).torvalds;
    assert(ctx, rec && rec.status && rec.status.mine === false,
      "the shelf map labels it not the reader's, got: " +
      JSON.stringify(rec && rec.status && rec.status.mine));

    /* THE FIRST-DAY VERBS, on the shape that offers them (no groups yet). */
    const fresh = build({
      signedOut: true, owner: "torvalds", settings: { groups: [] },
      apiRepos: [
        { name: "wiremock-api", topics: [] }, { name: "wiremock-data", topics: [] },
        { name: "wiremock-demo", topics: [] }, { name: "loose", topics: [] },
      ],
      repos: [
        { name: "wiremock-api", topics: [] }, { name: "wiremock-data", topics: [] },
        { name: "wiremock-demo", topics: [] }, { name: "loose", topics: [] },
      ],
    });
    await settle(1400);
    const fd = fresh.win.document;
    assert(ctx, readShelves(fresh.win), "the fresh signed-out page is still shelved");
    assert(ctx, fd.querySelectorAll("#shelves-host .sh-sug").length === 0,
      "no suggestion may write settings.groups from a signed-out stranger's page, got " +
      fd.querySelectorAll("#shelves-host .sh-sug").length);
    assert(ctx, fd.querySelectorAll("#shelves-host .sh-bench").length === 0,
      "nor a walk through their untagged repos, got " +
      fd.querySelectorAll("#shelves-host .sh-bench").length);
    assert(ctx, fd.querySelectorAll("#shelves-host .sh-grip").length === 0,
      "nor a grip, got " + fd.querySelectorAll("#shelves-host .sh-grip").length);
    ctx.info = "signed out: " + w.counters.calls.length + " call(s), 0 authed, " +
      w.counters.scraped.length + " scrapes, " + facts.length + " cache writes, still shelved";
  }),

  check("signed out — the repo page draws no chip", async (ctx) => {
    /* THE CONTROL FIRST: the same page with no session markers at all is
       "unknown", counts as mine, and draws — so a missing chip below means the
       guard, not a fixture that could never have drawn one. */
    const blind = build({
      at: "torvalds/linux", settings: { groups: ["aiproject"] },
      page: { topics: ["aiproject"] },
    });
    await settle();
    assert(ctx, readMark(blind.win) !== null,
      "control: an unknown session still draws the chip — otherwise this proves nothing");

    const out = build({
      signedOut: true, at: "torvalds/linux", settings: { groups: ["aiproject"] },
      page: { topics: ["aiproject"] },
    });
    await settle();
    const m = readMark(out.win);
    assert(ctx, m === null,
      "no shelf chip on torvalds/linux for a signed-out reader, drew: " +
      JSON.stringify(m && m.label));
    ctx.info = "unknown: chip drawn · signed out: " + (m ? "chip drawn" : "no chip");
  }),

  check("signed out — unknown still counts as mine", async (ctx) => {
    /* THE OVER-CORRECTION GUARD. No user-login meta and NO signed-out markers
       is "GitHub moved the meta", and answering "not yours" there would turn
       the extension off for everybody at once. The fix must leave this world
       exactly as it was: token sent, rung 4 run, cache written. */
    const repos = [{ name: "r1", topics: ["aiproject"] }, { name: "r2", topics: ["aiproject"] }];
    const w = build({
      owner: "whoever", token: "github_pat_X",
      settings: { groups: ["aiproject"] },
      repos, apiRepos: [],
    });
    await settle(1400);
    const S = w.win.Shelves;
    assert(ctx, S.isMine() === true,
      "no evidence either way must degrade to mine, got " + S.isMine());
    if (typeof S.signedIn === "function") {
      assert(ctx, S.signedIn() === null,
        "and the session reads as UNKNOWN, not as signed out, got: " +
        JSON.stringify(S.signedIn()));
    }
    assert(ctx, w.counters.calls.some((c) => c.auth),
      "the token is still sent, calls: " + JSON.stringify(w.counters.calls));
    assert(ctx, w.counters.scraped.length === repos.length,
      "and rung 4 still reads every unanswered row, scraped " +
      w.counters.scraped.length + " of " + repos.length);
    assert(ctx, Object.keys(w.store.local.repoFacts || {}).length === repos.length,
      "and caches them, got " + Object.keys(w.store.local.repoFacts || {}).length);
    ctx.info = "unknown: mine, token sent, " + w.counters.scraped.length + " scraped";
  }),

  check("signed out — signed in with the meta moved still counts as mine", async (ctx) => {
    /* `<body class="logged-in">` with no readable login: the reader IS signed
       in and we cannot say who. That is today's "cannot tell", and must stay
       "mine" — the logged-in body is evidence of a session, never of a
       stranger. */
    const repos = [{ name: "r1", topics: ["aiproject"] }];
    const w = build({
      signedInNoMeta: true, owner: "whoever", token: "github_pat_X",
      settings: { groups: ["aiproject"] },
      repos, apiRepos: [],
    });
    await settle(1400);
    const S = w.win.Shelves;
    assert(ctx, S.viewer() === "", "the login is unreadable here, got: " + JSON.stringify(S.viewer()));
    assert(ctx, S.isMine() === true,
      "signed in with the meta moved counts as mine, got " + S.isMine());
    if (typeof S.signedIn === "function") {
      assert(ctx, S.signedIn() === true,
        "and the session reads as signed in, got: " + JSON.stringify(S.signedIn()));
    }
    assert(ctx, w.counters.calls.some((c) => c.auth && /\/user\/repos/.test(c.url)),
      "the token is sent to /user/repos, calls: " + JSON.stringify(w.counters.calls));
    assert(ctx, w.counters.scraped.length === repos.length,
      "and rung 4 still runs, scraped " + w.counters.scraped.length + " of " + repos.length);
    ctx.info = "logged-in body, no meta: mine, token sent";
  }),

  check("signed out — the tri-state reads positive evidence only", async (ctx) => {
    /* THE GUARD AS A FUNCTION, over hand-built heads and headers — the
       shapes a session can arrive in, one at a time, so a scenario above that
       goes red can be told apart from the one marker that moved. */
    const w = build({ owner: "octo", repos: [] });
    await settle(200);
    const S = w.win.Shelves;
    assert(ctx, typeof S.signedIn === "function", "S.signedIn is missing");
    if (typeof S.signedIn !== "function") return;
    const Parser = new w.win.DOMParser();
    const doc = (head, body) => Parser.parseFromString(
      "<!doctype html><html><head>" + head + "</head>" + body + "</html>", "text/html");
    const loc = { pathname: "/torvalds" };
    const cases = [
      ["logged-out body + empty meta", '<meta name="user-login" content="">',
        '<body class="logged-out env-production"></body>', false, false],
      ["logged-out header alone", "",
        '<body><header class="Header-old header-logged-out"><a href="/login">Sign in</a></header></body>',
        false, false],
      ["logged-out body alone", "", '<body class="logged-out"></body>', false, false],
      /* PRESENT AND EMPTY is GitHub saying "nobody"; ABSENT is the markup
         having moved. The two must never read the same. */
      ["empty user-login meta alone", '<meta name="user-login" content="">', "<body></body>",
        false, false],
      /* A BARE /login LINK IS NOT EVIDENCE: the repo page carries one outside
         the header, and signed-in pages carry `return_to` links too. Reading it
         as "signed out" would take the reader's own profile away from them. */
      ["a /login link and nothing else", "",
        '<body><a href="/login?return_to=%2Ftorvalds">Sign in</a></body>', null, true],
      ["no evidence at all", "", "<body></body>", null, true],
      ["logged-in body, meta moved", "", '<body class="logged-in"></body>', true, true],
      ["meta names a stranger", '<meta name="user-login" content="me">',
        '<body class="logged-in"></body>', true, false],
      ["meta names the owner", '<meta name="user-login" content="Torvalds">',
        '<body class="logged-in"></body>', true, true],
      ["signed in, a Sign in link elsewhere on the page", "",
        '<body class="logged-in"><a href="/login">Sign in</a></body>', true, true],
    ];
    let ok = 0;
    for (const [label, head, body, want, mine] of cases) {
      const d = doc(head, body);
      const got = S.signedIn(d);
      const gotMine = S.isMine(loc, d);
      if (got === want && gotMine === mine) { ok++; continue; }
      assert(ctx, false, label + ": signedIn " + JSON.stringify(got) + " (want " +
        JSON.stringify(want) + "), isMine " + gotMine + " (want " + mine + ")");
    }
    ctx.info = ok + " of " + cases.length + " session shapes read correctly";
  }),

  /* ── THE STRANGER CACHE ────────────────────────────────────────────────
     The signed-out bug is fixed, but what it wrote is not undone by fixing it:
     every stranger's repo page it scraped is still sitting in repoFacts, and
     neither eviction path can reach it. `prune` waits for 90 untouched days,
     and the top-up touches everything it finds — so a polluted record is
     refreshed, with the reader's session cookie, forever. These scenarios hold
     the sweep to its two halves: once the reader is KNOWN, nobody else's
     record survives a write or earns a fetch; while the reader is NOT known,
     nothing is decided at all. */

  check("stranger cache — the top-up sweeps another owner's records and never fetches them",
    async (ctx) => {
    const day = 86400000;
    const now = Date.now();
    const mine = ["old-one", "older"];
    const theirs = ["linux", "subsurface", "git"];
    const cache = {};
    mine.forEach((n, i) => { cache["octo/" + n] = { at: now - (20 + i) * day, topics: [] }; });
    /* STALER THAN THE READER'S OWN, on purpose: stalest-first would put every
       stranger at the head of the queue, so a sweep that only filtered the
       write (and not the due list) is caught spending the budget on them. */
    theirs.forEach((n, i) => { cache["torvalds/" + n] = { at: now - (60 + i) * day, topics: [] }; });
    const w = build({
      owner: "octo", viewer: "octo", at: "octo/throttle-kit", page: { topics: ["rag"] },
      repos: mine.map((n) => ({ name: n, topics: ["rag"], description: "warmed" })),
      cache,
    });
    await settle();
    const S = w.win.Shelves;
    /* EVERY SAME-ORIGIN FETCH, not just the ones world.js can answer — a
       stranger's page 404s there, so `counters.scraped` alone would never see
       the request that is the whole bug. */
    const fetched = [];
    const inner = w.win.fetch;
    w.win.fetch = async (u, o) => { fetched.push(String(u)); return inner(u, o); };

    assert(ctx, S.viewer() === "octo", "fixture: the reader must be readable, got " +
      JSON.stringify(S.viewer()));
    const out = await S.warm({ cacheDays: 7, warmBatch: 10, prewarm: true }, { gap: 0, now });

    const strangers = fetched.filter((u) => /\/torvalds\//i.test(u));
    assert(ctx, strangers.length === 0,
      "a stranger's repo page must never be fetched by the top-up, fetched " +
      strangers.length + ": " + strangers.join(", "));
    assert(ctx, out.warmed === mine.length,
      "the reader's own stale entries are still refreshed, warmed " + out.warmed +
      " of " + mine.length + " (" + JSON.stringify(out) + ")");
    assert(ctx, out.swept === theirs.length,
      "the return says how many were swept, got swept=" + JSON.stringify(out.swept) +
      " want " + theirs.length);
    const after = Object.keys(w.store.local.repoFacts || {});
    const left = after.filter((k) => /^torvalds\//i.test(k));
    assert(ctx, left.length === 0,
      "no torvalds record may survive the write, left " + left.length + ": " + left.join(", "));
    const kept = mine.filter((n) => after.includes("octo/" + n));
    assert(ctx, kept.length === mine.length,
      "and every one of the reader's own is kept, kept " + kept.length + " of " + mine.length +
      ": " + after.join(", "));
    ctx.info = "warmed " + out.warmed + ", swept " + out.swept + ", " +
      strangers.length + " stranger fetches";
  }),

  check("stranger cache — the sweep is written even when nothing is due", async (ctx) => {
    /* THE ONE-TIME CLEANUP CANNOT WAIT FOR A STALE ENTRY. A reader whose own
       cache is fresh would otherwise carry the strangers until something of
       theirs aged past half the TTL — and the strangers are exactly the
       records that are being refreshed, so that day could be a long way off. */
    const now = Date.now();
    const w = build({
      owner: "octo", viewer: "octo", at: "octo/throttle-kit", page: { topics: [] },
      repos: [{ name: "a", topics: [] }, { name: "b", topics: [] }],
      cache: {
        "octo/a": { at: now - 60000, topics: [] },
        "octo/b": { at: now - 60000, topics: [] },
        "torvalds/linux": { at: now - 60000, topics: [] },
        "Torvalds/Git": { at: now - 60000, topics: [] },     // case is not identity
      },
    });
    await settle();
    const S = w.win.Shelves;
    const fetched = [];
    const inner = w.win.fetch;
    w.win.fetch = async (u, o) => { fetched.push(String(u)); return inner(u, o); };

    const out = await S.warm({ cacheDays: 7, warmBatch: 6, prewarm: true }, { gap: 0, now });
    assert(ctx, fetched.length === 0,
      "a fresh cache costs zero requests, fetched: " + fetched.join(", "));
    assert(ctx, out.warmed === 0, "nothing was due, warmed " + out.warmed);
    assert(ctx, out.swept === 2, "two strangers swept, got swept=" + JSON.stringify(out.swept));
    const after = Object.keys(w.store.local.repoFacts || {});
    assert(ctx, !after.some((k) => /^torvalds\//i.test(k)),
      "the strangers are gone from the store even though nothing was warmed, left: " +
      after.join(", "));
    assert(ctx, after.includes("octo/a") && after.includes("octo/b"),
      "and the reader's fresh entries are untouched, got: " + after.join(", "));
    ctx.info = "0 fetches, swept " + out.swept + ", store: " + after.join(", ");
  }),

  check("stranger cache — the cleanup does not wait for the top-up's opt-in", async (ctx) => {
    /* PREWARM IS OFF BY DEFAULT, so a sweep that lived behind it would reach
       almost nobody. The opt-in is consent to SPEND requests; the sweep spends
       none, so it runs regardless — and the top-up itself still stands down. */
    const now = Date.now();
    const w = build({
      owner: "octo", viewer: "octo", at: "octo/throttle-kit", page: { topics: [] },
      repos: [{ name: "a", topics: [] }],
      cache: {
        "octo/a": { at: now - 40 * 86400000, topics: [] },
        "torvalds/linux": { at: now - 40 * 86400000, topics: [] },
      },
    });
    await settle();
    const S = w.win.Shelves;
    const fetched = [];
    const inner = w.win.fetch;
    w.win.fetch = async (u, o) => { fetched.push(String(u)); return inner(u, o); };

    const out = await S.warm({ cacheDays: 7, warmBatch: 6, prewarm: false }, { gap: 0, now });
    assert(ctx, fetched.length === 0,
      "with the top-up off nothing is fetched, fetched: " + fetched.join(", "));
    assert(ctx, out.why === "off" && out.swept === 1,
      "it reports off AND the one stranger swept, got: " + JSON.stringify(out));
    const after = Object.keys(w.store.local.repoFacts || {});
    assert(ctx, after.length === 1 && after[0] === "octo/a",
      "only the reader's record survives, got: " + after.join(", "));
    ctx.info = "prewarm off: 0 fetches, swept " + out.swept + ", store: " + after.join(", ");
  }),

  check("stranger cache — signed out, the top-up does nothing", async (ctx) => {
    /* SIGNED OUT, THERE IS NO SESSION TO SPEND AND NO READER TO KEEP FOR.
       So the top-up stands down entirely — and it also does not sweep: with
       nobody signed in there is no "own" to keep, and an empty owner would
       read every record in the cache as a stranger's. The cleanup waits for
       the reader to come back. */
    const day = 86400000;
    const now = Date.now();
    const seed = {
      "octo/a": { at: now - 40 * day, topics: [] },
      "torvalds/linux": { at: now - 40 * day, topics: [] },
    };
    const w = build({
      signedOut: true, owner: "octo", at: "octo/throttle-kit", page: { topics: [] },
      repos: [{ name: "a", topics: [] }],
      cache: JSON.parse(JSON.stringify(seed)),
    });
    await settle();
    const S = w.win.Shelves;
    const fetched = [];
    const inner = w.win.fetch;
    w.win.fetch = async (u, o) => { fetched.push(String(u)); return inner(u, o); };

    const out = await S.warm({ cacheDays: 7, warmBatch: 6, prewarm: true }, { gap: 0, now });
    assert(ctx, fetched.length === 0,
      "signed out, the top-up must fetch nothing, fetched: " + fetched.join(", "));
    assert(ctx, out.warmed === 0 && out.why === "signed out",
      "and it says why, got: " + JSON.stringify(out));
    const after = w.store.local.repoFacts || {};
    assert(ctx, JSON.stringify(Object.keys(after).sort()) === JSON.stringify(Object.keys(seed).sort()),
      "with no reader known nothing is swept, got: " + Object.keys(after).join(", "));
    assert(ctx, Object.keys(seed).every((k) => after[k] && after[k].at === seed[k].at),
      "and nothing is rewritten either — every `at` is as seeded");
    ctx.info = "signed out: " + fetched.length + " fetches, why=" + out.why;
  }),

  check("stranger cache — unknown reader, unchanged", async (ctx) => {
    /* THE OVER-CORRECTION GUARD, again. No login and no signed-out evidence is
       "GitHub moved the meta", not "nobody". Sweeping there would treat the
       reader's whole cache as a stranger's and charge them a cold run; so the
       top-up must behave exactly as it did before the sweep existed — every
       stale entry, whoever owns it, refreshed. */
    const day = 86400000;
    const now = Date.now();
    const w = build({
      owner: "octo", at: "octo/throttle-kit", page: { topics: [] },
      repos: [{ name: "a", topics: [] }],
      cache: {
        "octo/a": { at: now - 40 * day, topics: [] },
        "torvalds/linux": { at: now - 41 * day, topics: [] },
      },
    });
    await settle();
    const S = w.win.Shelves;
    assert(ctx, S.signedIn() === null && S.viewer() === "",
      "fixture: the session must read as UNKNOWN, got signedIn=" +
      JSON.stringify(S.signedIn()) + " viewer=" + JSON.stringify(S.viewer()));
    /* world.js only answers the profile owner's pages, and a 404 ends the
       visit — so the stranger's page is answered here, or the scenario would
       prove only that warm stops on a 404. */
    const fetched = [];
    const inner = w.win.fetch;
    w.win.fetch = async (u, o) => {
      fetched.push(String(u));
      if (/\/torvalds\//i.test(String(u))) {
        return { ok: true, status: 200, text: async () => "<!doctype html><html><body></body></html>" };
      }
      return inner(u, o);
    };

    const out = await S.warm({ cacheDays: 7, warmBatch: 6, prewarm: true }, { gap: 0, now });
    assert(ctx, out.warmed === 2,
      "every stale entry is refreshed, whoever owns it, got: " + JSON.stringify(out));
    assert(ctx, fetched.some((u) => /\/torvalds\/linux/i.test(u)) &&
                fetched.some((u) => /\/octo\/a/i.test(u)),
      "both owners are fetched, as before, got: " + fetched.join(", "));
    assert(ctx, !out.swept,
      "and nothing is swept, got swept=" + JSON.stringify(out.swept));
    const after = w.store.local.repoFacts || {};
    assert(ctx, after["torvalds/linux"] && after["torvalds/linux"].at > now - 1000,
      "the stranger's record is kept and refreshed exactly as before, got: " +
      JSON.stringify(after["torvalds/linux"]));
    assert(ctx, after["octo/a"] && after["octo/a"].at > now - 1000,
      "and so is the reader's");
    ctx.info = "unknown: warmed " + out.warmed + ", swept " + (out.swept || 0);
  }),

  check("stranger cache — a foreground run on your own profile drops strangers on write",
    async (ctx) => {
    /* THE OTHER WRITER. Rung 4 writes the cache too, on the one page where the
       reader is most certainly known — so the first time they open their own
       profile is a cleanup, whether or not the top-up was ever switched on. */
    const now = Date.now();
    const repos = [{ name: "r1", topics: ["aiproject"] }, { name: "r2", topics: ["aiproject"] }];
    const w = build({
      owner: "octo", viewer: "octo",
      settings: { groups: ["aiproject"] },
      repos, apiRepos: [],                       // API answers nothing -> rung 4
      cache: {
        "torvalds/linux": { at: now - 60000, topics: ["kernel"] },
        "torvalds/git": { at: now - 60000, topics: [] },
        "TORVALDS/subsurface": { at: now - 60000, topics: [] },
      },
    });
    await settle(1400);
    const S = w.win.Shelves;
    assert(ctx, S.isMine() === true, "fixture: octo's own profile, got isMine()=" + S.isMine());
    assert(ctx, w.counters.scraped.length === repos.length,
      "rung 4 ran, scraped " + w.counters.scraped.length + " of " + repos.length);
    const after = Object.keys(w.store.local.repoFacts || {});
    const left = after.filter((k) => /^torvalds\//i.test(k));
    assert(ctx, left.length === 0,
      "the foreground write drops every stranger, left " + left.length + ": " + left.join(", "));
    const ours = repos.filter((r) => after.includes("octo/" + r.name));
    assert(ctx, ours.length === repos.length,
      "and writes the reader's new records, got " + ours.length + " of " + repos.length +
      ": " + after.join(", "));
    ctx.info = "rung 4 wrote " + ours.length + ", strangers left " + left.length;
  }),

  check("stranger cache — sweep is pure, case-blind, and decides nothing without a reader",
    async (ctx) => {
    const w = build({ owner: "octo", repos: [] });
    await settle(200);
    const S = w.win.Shelves;
    assert(ctx, S.cache && typeof S.cache.sweep === "function",
      "S.cache.sweep is missing — nothing can drop a stranger's record");
    if (!(S.cache && typeof S.cache.sweep === "function")) return;

    const input = {
      "Octo/a": { at: 1 },
      "octo/b": { at: 2 },
      "OCTO/C": { at: 3 },
      "torvalds/linux": { at: 4 },
      /* AN OWNER IS A WHOLE SEGMENT, not a prefix: these are other people. */
      "octopus/ink": { at: 5 },
      "octo-fan/x": { at: 6 },
      /* MALFORMED: no owner at all is nobody's, so it does not survive. */
      "/orphan": { at: 7 },
      "": { at: 8 },
    };
    const snapshot = JSON.stringify(input);
    const got = S.cache.sweep(input, "OcTo");
    const keys = Object.keys((got && got.cache) || {}).sort();
    assert(ctx, JSON.stringify(keys) === JSON.stringify(["OCTO/C", "Octo/a", "octo/b"]),
      "only the reader's own survive, in any case, got: " + JSON.stringify(keys));
    assert(ctx, got && got.dropped === 5, "five dropped, got " + JSON.stringify(got && got.dropped));
    assert(ctx, got && got.cache["Octo/a"] === input["Octo/a"],
      "a kept record is the record, not a copy that could drift");
    assert(ctx, JSON.stringify(input) === snapshot,
      "PURE: the input must not be mutated, got: " + JSON.stringify(input));

    let falsy = 0;
    for (const who of ["", null, undefined]) {
      const r = S.cache.sweep(input, who);
      const same = r && r.dropped === 0 &&
        JSON.stringify(Object.keys(r.cache).sort()) === JSON.stringify(Object.keys(input).sort());
      if (same) falsy++;
      else assert(ctx, false, "viewer " + JSON.stringify(who) + " must keep everything, got: " +
        JSON.stringify(r && { dropped: r.dropped, keys: Object.keys(r.cache || {}) }));
    }
    const none = S.cache.sweep({}, "octo");
    assert(ctx, none && none.dropped === 0 && Object.keys(none.cache).length === 0,
      "an empty cache sweeps to an empty cache, got: " + JSON.stringify(none));
    ctx.info = keys.length + " kept, " + (got && got.dropped) + " dropped; " +
      falsy + " of 3 falsy viewers decided nothing";
  }),

  check("backoff and unread - GitHub says stop, and the reader is told", async (ctx) => {
    const w = build({
      viewer: "me", owner: "me",
      settings: { groups: ["keep"], concurrency: 3 },
      apiRepos: [],
      repos: Array.from({ length: 30 }, (_, i) => ({ name: "r" + i, topics: [] })),
    });
    /* Swapped in before the ladder reaches rung 4 - the run starts ~120ms in. */
    let asked = 0;
    w.win.fetch = async () => { asked++; return { ok: false, status: 429, text: async () => "" }; };
    await settle(2000);

    /* MEASURED BEFORE THE FIX: 40 of 40 requests issued against a server saying
       stop, and a page of Ungrouped repos with no explanation at all. This is
       the extension's highest-volume path and was the only one without a
       backoff, while warm.js - which makes six requests - had one. */
    assert(ctx, asked > 0 && asked <= 6,
      "it must stop within one wave of in-flight requests, issued " + asked + " of 30");

    const v = readShelves(w.win);
    assert(ctx, v, "a rate limit must never cost the render");
    if (!v) return;
    assert(ctx, /429/.test(v.warn) && /unread/.test(v.warn),
      "and the reader is told what happened and how many, got: " + JSON.stringify(v.warn));
    assert(ctx, /rescan/.test(v.warn), "with the cure named, got: " + v.warn);
    const total = v.shelves.reduce((n, sh) => n + sh.count, 0);
    assert(ctx, total === 30, "every repo is still on the page, got " + total);

    /* A RATE LIMIT IS NOT THE ONLY WAY TO GO UNREAD. A 404, a network blip or
       a repo that vanished mid-run all end the same way — Ungrouped — and a
       reader cannot tell that from untagged by looking. The count is over
       everything that failed, not just the refusals. */
    const w2 = build({
      viewer: "me", owner: "me",
      settings: { groups: ["keep"] },
      apiRepos: [],
      repos: Array.from({ length: 6 }, (_, i) => ({ name: "q" + i, topics: [] })),
    });
    let n = 0;
    const pass = w2.win.fetch;
    w2.win.fetch = async (u) => (++n <= 2
      ? { ok: false, status: 404, text: async () => "" }
      : pass(u));
    await settle(1600);
    const v2 = readShelves(w2.win);
    assert(ctx, v2 && /unread/.test(v2.warn),
      "unreadable repos are counted even with no rate limit, got: " +
      JSON.stringify((v2 || {}).warn));
    assert(ctx, v2 && !/429/.test(v2.warn),
      "and not blamed on a refusal that did not happen, got: " + (v2 || {}).warn);
    ctx.info = asked + " requests before stopping, of 30 · " + v.warn;
  }),

  check("untrusted-names - a page-supplied href is not a URL to fetch",
    async (ctx) => {
      const w = build({
        viewer: "me", owner: "me", settings: { groups: [] },
        repos: [{ name: "ok", topics: [] }], apiRepos: [],
      });
      await settle();
      const safe = w.win.Shelves.safeRepo;

      /* `fullNameOf` reads two path segments off an href the PAGE supplied, and
         that string goes into `fetch("/" + name)` in three files. The leading
         slash contains it to github.com - measured, no SSRF - but it does not
         contain WHICH github.com path: `/settings/tokens/x` resolved cleanly to
         an authenticated GET of the reader's token page, whose text would then
         be cached and made searchable in their own UI. */
      const good = [["octo", "repo"], ["octo", ".github"], ["o-1", "a_b.c-d"]];
      good.forEach(([o, r]) =>
        assert(ctx, safe(o, r) === o + "/" + r, "must accept " + o + "/" + r));

      const bad = [
        ["settings", "tokens"], ["https:", "evil.example"], ["octo", "repo?x=1"],
        ["..", ".."], ["octo", ".."], ["__proto__", "x"], ["octo", "a/b"],
        ["octo", "n%0d%0aX"], ["orgs", "acme"], ["", "x"], ["octo", ""],
      ];
      bad.forEach(([o, r]) =>
        assert(ctx, safe(o, r) === "",
          "must reject " + JSON.stringify(o + "/" + r) + ", got " + JSON.stringify(safe(o, r))));

      /* ...and a crafted row on a real page is simply not fetched. */
      const w2 = build({
        viewer: "me", owner: "me", settings: { groups: [] }, apiRepos: [],
        repos: [{ name: "real", topics: [] }],
      });
      await settle();
      const li = w2.win.document.querySelector("#shelves-host li");
      assert(ctx, li && li.dataset.shName === "me/real",
        "a legitimate row keeps its name, got: " + (li && li.dataset.shName));
      /* ---- AND THE ONE PLACE A NAME NOW BECOMES A URL ----------------------
         The workbench opens `https://github.com/<name>` in a tab. That is a
         second sink for the same untrusted string, added after the scar that
         named the first one, so it is checked the same way: every crafted
         shape that `safeRepo` lets through must still land on github.com. */
      const crafted = [
        ["evil.com", "x"], ["", "evil.com"], ["..", "evil.com"],
        ["settings", "tokens"], ["a", "../../settings/tokens"],
        ["a", "b?next=//evil.com"], ["evil.com:8080", "x"], ["@evil.com", "x"],
        ["a\evil.com", "x"], ["a", "b%2f..%2fsettings"], ["javascript", "alert"],
      ];
      let offHost = 0, passed = 0;
      crafted.forEach(([o, r]) => {
        const n = w.win.Shelves.safeRepo(o, r);
        if (!n) return;
        passed++;
        let host = null;
        try { host = new w.win.URL("https://github.com/" + n).host; } catch (e) {}
        if (host !== "github.com") offHost++;
      });
      assert(ctx, offHost === 0,
        "a name that reaches window.open must not steer it off github.com, " +
        offHost + " of " + passed + " did");

      /* ---- SETTINGS ARE INPUT TOO -----------------------------------------
         `settings.groups` is parsed on every render — twice on a progressive
         one — and the obvious spelling of "Name = expression",
         `^([^=]+?)\s*=\s*(.+)$`, is QUADRATIC: the lazy group grows one
         character at a time and `\s*=` re-fails at every position. Measured on
         an entry with no `=` in it: 5k chars 13ms, 20k 200ms, 80k 3 169ms —
         fourfold for every doubling, and it freezes the tab. It is one scan,
         not a regex. */
      const big = "A" + " ".repeat(200000) + "B";
      const t0 = Date.now();
      w.win.Shelves.isRule(big);
      w.win.Shelves.parseRule(big);
      const ms = Date.now() - t0;
      assert(ctx, ms < 100,
        "the rule parser must stay linear in the length of a group entry: " +
        "200k chars took " + ms + "ms");

      ctx.info = good.length + " accepted, " + bad.length + " rejected; " +
        passed + " crafted names contained; 200k-char entry parsed in " + ms + "ms";
    }),

  check("forgets - the fact cache is not immortal", async (ctx) => {
    const w = build({ viewer: "me", owner: "me", settings: {}, repos: [], apiRepos: [] });
    await settle();
    const C = w.win.Shelves.cache;
    const day = 86400000;
    const now = Date.now();

    /* THERE WAS NO EVICTION PATH IN THE WHOLE EXTENSION. An entry written once
       lived forever, and warm.js refreshes everything it finds - so one visit
       to a stranger's 300-repo profile left the browser re-fetching somebody
       else's repositories for as long as the extension was installed. */
    const cache = {
      "o/fresh": { at: now - day, topics: [] },
      "o/aging": { at: now - 60 * day, topics: [] },
      "o/ancient": { at: now - 400 * day, topics: [] },
      "o/undated": { topics: [] },
    };
    const kept = C.prune(cache, { cacheDays: 7 }, now);
    assert(ctx, "o/fresh" in kept && "o/aging" in kept,
      "anything inside the window survives, got: " + Object.keys(kept).join());
    assert(ctx, !("o/ancient" in kept), "a year-old entry is dropped");
    assert(ctx, !("o/undated" in kept), "and one with no timestamp cannot be judged fresh");

    /* The floor is generous on purpose: pruning at the TTL would fight the
       top-up, which exists to refresh things around it. */
    const long = C.prune({ "o/x": { at: now - 200 * day } }, { cacheDays: 90 }, now);
    assert(ctx, "o/x" in long,
      "a 90-day TTL must not have its own entries pruned at 90 days");

    // and a count cap for the case age cannot catch
    const many = {};
    for (let i = 0; i < 3200; i++) many["o/r" + i] = { at: now - i * 1000 };
    const capped = C.prune(many, { cacheDays: 7 }, now);
    assert(ctx, Object.keys(capped).length === 3000,
      "capped at 3000, got " + Object.keys(capped).length);
    assert(ctx, "o/r0" in capped && !("o/r3199" in capped),
      "keeping the newest, which are the ones being looked at");
    ctx.info = "age + count, and the newest survive";
  }),

  check("packaging - what actually ships, and what it promises", async (ctx) => {
    /* THE ONLY SCENARIO THAT READS THE REPOSITORY RATHER THAN DRIVING IT.
       Everything else here proves the code behaves; this proves the package
       around it does — because a `exclude_matches` somebody deletes and a
       charter sentence that goes stale are both regressions, and neither one
       would fail a single test above. */
    const fs = require("fs");
    const path = require("path");
    const root = path.join(__dirname, "..");
    const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

    const m = JSON.parse(read("extension/manifest.json"));
    assert(ctx, Object.keys(m.permissions || []).length >= 0 &&
      JSON.stringify(m.permissions) === '["storage"]',
      "one permission, and it is storage, got: " + JSON.stringify(m.permissions));
    assert(ctx, JSON.stringify(m.host_permissions) ===
      '["https://github.com/*","https://api.github.com/*"]',
      "two hosts, both GitHub, got: " + JSON.stringify(m.host_permissions));
    assert(ctx, !m.externally_connectable && !m.web_accessible_resources,
      "nothing on the outside may reach in");

    /* GitHub keeps its most sensitive state on these routes, and a content
       script has no business reading them even if it never transmits. */
    const ex = (m.content_scripts[0].exclude_matches || []).join(" ");
    ["settings", "sessions", "login", "account"].forEach((r) =>
      assert(ctx, ex.indexOf(r) !== -1, "the content script must stand off /" + r));

    assert(ctx, /MIT License/.test(read("LICENSE")),
      "a repo with no licence is not legally reusable by anyone — including " +
      "the one this extension's own audit panel keeps saying it about");

    const ignored = read(".gitignore");
    [".claude/", "proofs.json", "node_modules/"].forEach((f) =>
      assert(ctx, ignored.indexOf(f) !== -1, ".gitignore must exclude " + f));

    /* A PROMISE THE CODE CONTRADICTS IS WORSE THAN NO PROMISE. That sentence
       was true while the cache held topics and false from facts.js onward,
       which caches descriptions, README openings and private repo names.
       Whitespace-normalised, because it was line-wrapped and a reflowed
       paragraph must not smuggle it back in. */
    const charter = read("CHARTER.md").replace(/\s+/g, " ");
    const claim = "never stores your repositories anywhere";
    const at = charter.indexOf(claim);
    /* IT MAY APPEAR EXACTLY ONCE, AND ONLY AS A QUOTATION OF ITSELF. The first
       version of this test asserted the sentence was simply absent, and failed
       — correctly, and for an interesting reason. The charter SHOULD still
       carry it, inside the paragraph explaining that it stopped being true:
       deleting a retired promise hides the correction as thoroughly as never
       making it. What must never come back is the sentence standing alone as a
       claim. */
    assert(ctx, at !== -1 && charter.indexOf(claim, at + 1) === -1,
      "the retired promise must appear exactly once, found " +
      (at === -1 ? "none" : "more than one"));
    assert(ctx, /An earlier version of this paragraph said/.test(
      charter.slice(Math.max(0, at - 140), at)),
      "and only as a quotation inside the correction, never as a promise");
    ["chrome.storage.local", "unencrypted", "private"].forEach((w) =>
      assert(ctx, charter.indexOf(w) !== -1,
        "and the charter must say what IS kept — missing: " + w));

    const readme = read("README.md");
    assert(ctx, /What it stores/.test(readme),
      "the README must carry the same statement, in its own words");
    ctx.info = "1 permission, 2 hosts, " +
      (m.content_scripts[0].exclude_matches || []).length +
      " excluded routes, MIT, and the storage claim is honest";
  }),

  check("identity - a colour and a glyph per shelf, derived and stable", async (ctx) => {
    const w = build({
      owner: "octo",
      settings: { groups: ["aiproject", "tooling", "rag"] },
      repos: [
        { name: "agent", chips: ["aiproject"] },
        { name: "wisp", chips: ["tooling"] },
        { name: "retrieve", chips: ["rag"] },
        { name: "notes", chips: [] },
      ],
    });
    await settle();
    const v = readShelves(w.win);
    assert(ctx, v, "never rendered");
    if (!v) return;

    const named = v.shelves.filter((s) => s.label !== "Ungrouped");
    assert(ctx, named.length === 3, "three named shelves, got " + named.length);
    assert(ctx, named.every((s) => s.glyph && !s.plain && /^\d+$/.test(s.hue)),
      "every named shelf carries a glyph and a hue, got: " +
      JSON.stringify(named.map((s) => [s.label, s.glyph, s.hue])));
    assert(ctx, new Set(named.map((s) => s.glyph)).size === 3,
      "and no two share a glyph, got: " + named.map((s) => s.glyph).join());
    assert(ctx, new Set(named.map((s) => s.hue)).size === 3,
      "or a hue, got: " + named.map((s) => s.hue).join());

    /* The leftovers shelf is a remainder, not an idea. A colour of its own
       would claim it was one. */
    const other = v.shelves.find((s) => s.label === "Ungrouped");
    assert(ctx, other && other.plain && other.hue === "",
      "Ungrouped stays outside the palette, got: " + JSON.stringify(other));

    const ID = w.win.Shelves.identity;

    /* THE PROPERTY THAT MAKES IT WORTH HAVING. Auto-grouping sorts shelves by
       size, so resolving collisions in DRAWING order would repaint a shelf
       whenever a repo moved between two others - and a map that changes under
       you is worse than a map with no colours at all. Same labels, any order,
       same answer. */
    const a = ID(["tooling", "aiproject", "rag", "Ungrouped"], "Ungrouped");
    const b = ID(["rag", "Ungrouped", "tooling", "aiproject"], "Ungrouped");
    assert(ctx, ["tooling", "aiproject", "rag"].every(
      (k) => a.get(k).slot === b.get(k).slot && a.get(k).glyph === b.get(k).glyph
    ), "identity must not depend on the order the shelves are drawn in");

    /* ...and the page agrees with the function, so the stability proved above
       is the stability the reader actually gets. */
    assert(ctx, named.every((s) => a.get(s.label).glyph === s.glyph &&
      String(a.get(s.label).hue) === s.hue),
      "the rendered shelf must wear the identity the function assigns");

    /* A HASH ALONE IS NOT ENOUGH: twelve labels into twelve slots collide
       almost every time, so this fails outright without the walk to the next
       free slot. */
    const m12 = ID("abcdefghijkl".split(""), "Ungrouped");
    const slots12 = new Set([...m12.values()].map((x) => x.slot)).size;
    assert(ctx, slots12 === 12,
      "twelve shelves must get twelve distinct slots, got " + slots12);

    /* PAST THE PALETTE, THE PAIR IS WHAT STAYS UNIQUE.
       This used to assert that one hue always wore one glyph — a single slot
       driving both channels. It reads like the stronger promise and it is the
       weaker one: with twelve slots and thirteen shelves the walk wrapped and
       handed out a DUPLICATE, the same colour and the same shape together,
       which is the one failure two channels exist to prevent. Proved with
       sixteen labels: three shelves on slot 11, all `▽`, all one colour.

       Hue and glyph are now walked independently, so twelve remain twelve
       distinct hues AND twelve distinct glyphs (asserted above), and above
       that the PAIR carries the identity — 144 of them. The honest cost, which
       the README now states: past twelve, one channel necessarily repeats,
       and the other is what tells the two shelves apart. */
    const m20 = ID("abcdefghijklmnopqrst".split(""), "Ungrouped");
    assert(ctx, m20.size === 20, "every shelf gets an identity, got " + m20.size);
    const pairs = new Set([...m20.values()].map((x) => x.hue + ":" + x.glyph));
    assert(ctx, pairs.size === 20,
      "twenty shelves must be twenty distinct hue+glyph pairs, got " + pairs.size);
    /* And when a hue repeats, the glyph must be the thing that differs - a
       repeat of BOTH is the collision this replaced. */
    const byHue = new Map();
    let bothRepeat = false;
    m20.forEach((x) => {
      const seen = byHue.get(x.hue) || new Set();
      if (seen.has(x.glyph)) bothRepeat = true;
      seen.add(x.glyph);
      byHue.set(x.hue, seen);
    });
    assert(ctx, !bothRepeat,
      "two shelves may share a hue, but never a hue AND a glyph");

    /* THE CEILING IS 144, AND IT MUST DEGRADE RATHER THAN COLLAPSE. */
    const big = ID(Array.from({ length: 144 }, (_, i) => "s" + i), "Ungrouped");
    const bigPairs = new Set([...big.values()].map((x) => x.hue + ":" + x.glyph));
    assert(ctx, bigPairs.size === 144,
      "the pair space is 12x12 and all of it must be reachable, got " + bigPairs.size);

    /* Derived, never stored: none of this may have reached the disk. */
    const wrote = Object.keys(w.store.local || {}).concat(Object.keys(w.store.sync || {}));
    assert(ctx, wrote.indexOf("shelfColors") === -1 && wrote.indexOf("identity") === -1,
      "identity is a hash of the name, not a stored preference");

    ctx.info = named.map((s) => s.glyph + " " + s.label).join("   ") +
      "   " + other.glyph + " Ungrouped";
  }),
  check("horizon - the fetch ceiling is carried out of the loop, not discarded",
    async (ctx) => {
    /* MEASURED BEFORE THE FIX: `fetchRestOfPages` returned its rows and nothing
       else, so every exit looked identical from outside. The ceiling at
       `maxPages`, a 429, a throw and a page whose list moved all returned "here
       are some rows" — and the caller then hid GitHub's pager, which is the only
       navigation to the pages that were skipped. At 400 repos and a ceiling of
       10: 330 shelved, 70 unreachable, toolbar reading `330 repos`.

       The record is driven directly here because the shapes that matter are
       exactly the ones a fixture cannot reach by accident: a profile whose next
       link never runs out, and three different ways for one page to fail. */
    const w = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      repos: [{ name: "a", chips: ["keep"] }],
      page2: [{ name: "b", chips: ["keep"] }],
    });
    await settle();
    const F = w.win.Shelves.fetchRestOfPages;

    /* THE CEILING. Every page served carries a link to another one, which is
       what a 13-page profile looks like to a limit of three. */
    let served = 0;
    w.win.fetch = async () => ({
      ok: true, status: 200, text: async () => endlessPage(++served),
    });
    const cap = await F(3);
    assert(ctx, cap.pagesRead === 3,
      "the ceiling must hold at 3, read " + cap.pagesRead);
    assert(ctx, cap.rows.length === 6,
      "and still merge what it did read, got " + cap.rows.length + " rows");
    assert(ctx, cap.truncated === true,
      "a page left in hand IS truncation, got " + cap.truncated);
    assert(ctx, cap.stopped === "cap",
      "and it must name the ceiling rather than an error, got: " + cap.stopped);

    /* THE HEALTHY EXIT, which is the only one that may report truncated:false
       — and the only one that licenses the caller to hide the pager. */
    w.win.fetch = async () => ({
      ok: true, status: 200,
      text: async () => profilePage("octo", [{ name: "z", chips: ["keep"] }], ""),
    });
    const end = await F(3);
    assert(ctx, end.truncated === false && end.stopped === "end",
      "a next link that runs out is the end, got: " +
      JSON.stringify({ truncated: end.truncated, stopped: end.stopped }));
    assert(ctx, end.pagesRead === 1 && end.rows.length === 1,
      "one page read, one row merged, got " + end.pagesRead + "/" + end.rows.length);

    /* THE THREE BREAK PATHS. Each one used to be the same silence, and they
       want fixing differently: a 429 is "come back later", a throw is the
       network, and a missing list is GitHub having moved the markup. */
    w.win.fetch = async () => ({ ok: false, status: 429, text: async () => "" });
    const http = await F(3);
    assert(ctx, http.stopped === "http 429" && http.truncated === true,
      "a refusal is reported with its status, got: " + http.stopped);
    assert(ctx, http.pagesRead === 0 && http.rows.length === 0,
      "and nothing is claimed to have been read, got " + http.pagesRead);

    w.win.fetch = async () => { throw new TypeError("network down"); };
    const threw = await F(3);
    assert(ctx, threw.stopped === "error" && threw.truncated === true,
      "a throw is still an unread page, got: " + threw.stopped);

    w.win.fetch = async () => ({
      ok: true, status: 200,
      text: async () => "<!doctype html><html><body><div>moved</div></body></html>",
    });
    const nolist = await F(3);
    assert(ctx, nolist.stopped === "nolist" && nolist.truncated === true,
      "a page with no list is the canary's problem, not a silent 0, got: " +
      nolist.stopped);

    ctx.info = "cap/end/http 429/error/nolist, and only `end` says truncated:false";
  }),

  check("horizon - GitHub's pager survives whatever the merge could not reach",
    async (ctx) => {
    /* THE OTHER HALF OF THE SAME DEFECT, and the half the reader actually
       feels. `hidePager()` sets display:none on `.paginate-container`; run past
       the ceiling, that deleted the only route to the repositories we had just
       decided not to fetch. The rows were not merely absent from the shelves,
       they were unreachable from the page. */
    let served = 0;
    const over = build({
      owner: "octo",
      settings: { groups: ["keep"], maxPages: 2 },
      repos: [{ name: "a", chips: ["keep"] }],
      page2: [{ name: "b", chips: ["keep"] }],
    });
    const pass = over.win.fetch;
    over.win.fetch = async (u) => (/[?&]page=\d/.test(String(u))
      ? { ok: true, status: 200, text: async () => endlessPage(++served) }
      : pass(u));
    await settle(1200);

    const pager = over.win.document.querySelector(".paginate-container");
    assert(ctx, pager, "the fixture must have a pager to hide");
    assert(ctx, pager && pager.style.display !== "none",
      "a truncated merge must leave GitHub's own navigation standing, display: " +
      (pager && pager.style.display));
    const v = readShelves(over.win);
    assert(ctx, v && v.names.length === 5,
      "and the two pages it DID read are still merged, rows " +
      ((v || {}).names || []).length);

    /* AND IT IS NOT A REFUSAL TO EVER HIDE IT. A merge that reached the end has
       genuinely replaced what the pager navigates to. */
    const whole = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      repos: [{ name: "a", chips: ["keep"] }],
      page2: [{ name: "b", chips: ["keep"] }],
    });
    await settle(1200);
    const hidden = whole.win.document.querySelector(".paginate-container");
    assert(ctx, hidden && hidden.style.display === "none",
      "a complete merge still hides the pager it replaced, display: " +
      (hidden && hidden.style.display));

    ctx.info = "2 of N pages read: pager kept, 5 rows merged · complete run: pager hidden";
  }),

  check("total - read off the nav, and null rather than wrong under a filter",
    async (ctx) => {
    /* THE EXTENSION CANNOT COUNT WHAT IT DID NOT FETCH, so the figure is read
       from the one place GitHub renders it. The trust rule is the whole test:
       that counter counts the PROFILE, and Type / Language / search replace the
       LIST without touching it — so a filtered list of 12 beside a counter of
       400 is two true numbers and a false relationship. The reader has no way
       to catch that, which is why it must come back null. */
    const w = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      repos: [{ name: "a", chips: ["keep"] }],
    });
    await settle();
    const T = w.win.Shelves.repoTotal;
    const here = { search: "?tab=repositories" };

    assert(ctx, T(here, w.win.document) === null,
      "no counter on the page is no claim, got: " + T(here, w.win.document));

    navCounter(w.win, { title: "400" });
    assert(ctx, T(here, w.win.document) === 400,
      "a clean profile answers its own count, got: " + T(here, w.win.document));

    /* GitHub abbreviates the text and keeps the exact figure in `title`. */
    navCounter(w.win, { title: "1,234", text: "1.2k" });
    assert(ctx, T(here, w.win.document) === 1234,
      "the title is the exact figure and wins, got: " + T(here, w.win.document));

    /* AND AN ABBREVIATION ALONE IS NOT A NUMBER. 1200 against a true 1234
       would be a visible lie about 34 repositories, so it is null — this is
       deliberately stricter than facts.js's star counter, which rounds. */
    navCounter(w.win, { text: "1.2k" });
    assert(ctx, T(here, w.win.document) === null,
      "a rounded count may not stand in for an exact one, got: " +
      T(here, w.win.document));

    navCounter(w.win, { title: "400" });
    ["type=fork", "language=python", "q=wire"].forEach((f) => {
      assert(ctx, T({ search: "?tab=repositories&" + f }, w.win.document) === null,
        "a filtered list may not be measured against the profile's count (" +
        f + "), got: " + T({ search: "?tab=repositories&" + f }, w.win.document));
    });

    /* THE THREE THAT ARE NOT FILTERS. Sorting reorders and `page` offsets;
       neither changes which repositories are in the collection being counted,
       and answering null there would cost the number for no reason. */
    ["sort=name", "direction=asc", "page=3"].forEach((p) => {
      assert(ctx, T({ search: "?tab=repositories&" + p }, w.win.document) === 400,
        p + " does not change the collection, got: " +
        T({ search: "?tab=repositories&" + p }, w.win.document));
    });

    ctx.info = "400 · title beats 1.2k · 1.2k alone is null · q/type/language null · sort/page kept";
  }),

  check("total - the toolbar qualifies its count only when there is more behind it",
    async (ctx) => {
    /* P.IV, applied to the first number on the line rather than the last. `330
       repos` was the extension stating the size of a collection it had only
       partly read, which is the same silence the source line exists to forbid
       — and it is worse than a missing rung, because nothing on the page
       contradicts it. */
    const six = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      repos: Array.from({ length: 4 }, (_, i) => ({ name: "a" + i, chips: ["keep"] })),
      page2: [{ name: "b0", chips: ["keep"] }, { name: "b1", chips: ["keep"] }],
    });
    navCounter(six.win, { title: "10" });
    await settle(1200);
    const v = readShelves(six.win);
    assert(ctx, v, "never rendered");
    if (!v) return;
    assert(ctx, /^6 of 10 repos · /.test(v.note),
      "a known total that exceeds the rows is said out loud, got: " + v.note);
    assert(ctx, /4 on pages not read/.test(v.note),
      "and the difference is named, got: " + v.note);

    /* UNCHANGED WHERE THERE IS NOTHING TO QUALIFY. `10 of 10` on every ordinary
       profile would teach the reader to skip the number, and the form only
       works because it is unusual. */
    const four = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      repos: Array.from({ length: 4 }, (_, i) => ({ name: "a" + i, chips: ["keep"] })),
    });
    navCounter(four.win, { title: "4" });
    await settle(1200);
    const v2 = readShelves(four.win);
    assert(ctx, v2 && /^4 repos · /.test(v2.note),
      "a complete page reads exactly as it always did, got: " + (v2 || {}).note);
    assert(ctx, v2 && !/pages not read/.test(v2.note),
      "with nothing appended, got: " + (v2 || {}).note);

    /* THE THIRD STATE. Truncated with no counter to read: we know there is more
       and cannot count it, and a number there would be the guess `repoTotal`
       refused to make. Never `0 on pages not read`, which is the claim that the
       page is complete. */
    let served = 0;
    const blind = build({
      owner: "octo",
      settings: { groups: ["keep"], maxPages: 1 },
      repos: [{ name: "a", chips: ["keep"] }],
      page2: [{ name: "b", chips: ["keep"] }],
    });
    const pass = blind.win.fetch;
    blind.win.fetch = async (u) => (/[?&]page=\d/.test(String(u))
      ? { ok: true, status: 200, text: async () => endlessPage(++served) }
      : pass(u));
    await settle(1200);
    const v3 = readShelves(blind.win);
    assert(ctx, v3 && /^3 repos · /.test(v3.note),
      "an uncountable total leaves the count bare, got: " + (v3 || {}).note);
    assert(ctx, v3 && /more on pages not read/.test(v3.note),
      "and says `more`, not a figure and not 0, got: " + (v3 || {}).note);
    assert(ctx, v3 && !/\d+ on pages not read/.test(v3.note),
      "no invented number may appear there, got: " + (v3 || {}).note);

    ctx.info = "6 of 10 · 4 unread | 4 repos, nothing appended | 3 repos · more unread";
  }),

  check("shelf map - the status block is what the popup reads instead of guessing",
    async (ctx) => {
    /* THE POPUP HAS NO PAGE. No content script, no DOM, nothing to count — so
       every number it shows is either written here by the page that worked it
       out or invented beside it, and two halves of one extension disagreeing in
       public is the failure this map was built to prevent for the repo chip.

       The seeded record is a previous visit's, and it must not survive: a write
       replaces the owner's record wholesale. */
    const w = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      repos: Array.from({ length: 4 }, (_, i) => ({
        name: "a" + i, chips: i < 3 ? ["keep"] : [],
      })),
      page2: [{ name: "b0", chips: ["keep"] }, { name: "b1", chips: [] }],
      shelfMap: {
        octo: { at: 1, order: ["stale"], counts: { stale: 9 }, on: { "octo/gone": "stale" },
                status: { repos: 1, provisional: true } },
      },
    });
    navCounter(w.win, { title: "10" });

    /* EVERY WRITE IS RECORDED, because the thing worth proving is a NEGATIVE:
       a chipped profile renders twice, and the first render is provisional. If
       a guess ever reached the store the popup could read a draft as an answer
       — and on a long cold run it would read it for the whole run. */
    const writes = [];
    const real = w.win.Shelves.shelfmap.write.bind(w.win.Shelves.shelfmap);
    w.win.Shelves.shelfmap.write = (owner, map) => {
      writes.push(map);
      return real(owner, map);
    };
    await settle(1400);

    const rec = (w.store.local.shelfMap || {}).octo;
    assert(ctx, rec && rec.status, "the map must carry a status block");
    if (!rec || !rec.status) return;
    const st = rec.status;
    const v = readShelves(w.win);

    assert(ctx, rec.order.indexOf("stale") === -1,
      "the previous visit's record is replaced, not merged into, got: " +
      JSON.stringify(rec.order));
    assert(ctx, writes.length === 1 && writes[0].status.provisional === false,
      "a provisional render must never publish — writes: " + writes.length +
      ", provisional: " + JSON.stringify(writes.map((m) => m.status.provisional)));

    assert(ctx, st.repos === 6, "repos is the rows actually shelved, got " + st.repos);
    assert(ctx, st.total === 10, "total is the nav's figure, got " + st.total);
    assert(ctx, st.unread === 4, "unread is the difference, got " + st.unread);
    assert(ctx, st.truncated === false,
      "a merge that reached the end is not truncated, got " + st.truncated);
    assert(ctx, st.pagesRead === 1, "one extra page was read, got " + st.pagesRead);
    assert(ctx, st.shelves === rec.order.length && st.shelves === v.shelves.length,
      "shelves agrees with the order AND with the page, got " + st.shelves);
    assert(ctx, st.tagged === 4,
      "tagged counts the repos with topics, got " + st.tagged);
    assert(ctx, typeof st.source === "string" && st.source.length > 0 &&
      v.note.indexOf("via " + st.source) !== -1,
      "source is the same rung the page named, got: " + st.source);
    assert(ctx, st.warning === "" && st.health === "",
      "a clean run carries empty sentences, never undefined, got: " +
      JSON.stringify([st.warning, st.health]));
    assert(ctx, st.deferred === 0, "nothing was deferred, got " + st.deferred);

    /* THE NUMBERS IN THE BLOCK AND THE NUMBERS ON THE LINE ARE ONE FACT. If
       these can drift, the popup is a second opinion rather than a copy. */
    assert(ctx, v.note.indexOf(st.repos + " of " + st.total + " repos") === 0,
      "the block must say what the toolbar says, got: " + v.note);

    ctx.info = "1 write, provisional:false, 6 of 10, " + st.shelves +
      " shelves, 4 tagged, via " + st.source;
  }),

  check("filter counts - a shelf counts repositories, not the <li> inside its rows",
    async (ctx) => {
    /* `moveRow` already carried the comment explaining this trap and the fix for
       it; `applyFilter` had neither, and counted every descendant <li>. GitHub
       ships a list inside each row's star control, so a five-row shelf with one
       match reported `6 / 10` — the denominator merely silly, the numerator
       structural: nothing ever gives those nested <li> `sh-hide`, so `hits === 0`
       was unreachable and a shelf with no match could never be dimmed.

       The fixture adds the nested list explicitly, because world.js's row does
       not ship one and a test that cannot see the trap cannot see the fix. */
    const w = build({
      owner: "octo",
      settings: { groups: ["keep", "other"] },
      repos: Array.from({ length: 5 }, (_, i) => ({ name: "k" + i, chips: ["keep"] }))
        .concat([{ name: "o1", chips: ["other"] }]),
    });
    await settle(1200);
    const host = w.win.document.getElementById("shelves-host");
    assert(ctx, host, "never rendered");
    if (!host) return;

    const rows = [...host.querySelectorAll("li[data-sh-name]")];
    assert(ctx, rows.length === 6, "six rows expected, got " + rows.length);
    rows.forEach((li) => {
      const ul = w.win.document.createElement("ul");
      const inner = w.win.document.createElement("li");
      inner.textContent = "Add this repository to a list";
      ul.appendChild(inner);
      li.appendChild(ul);
    });

    type(w.win, "k3");
    const v = readShelves(w.win);
    const b = byLabel(v);
    assert(ctx, b.keep, "the keep shelf must exist");
    if (!b.keep) return;

    const keep = v.shelves.find((s) => s.label === "keep");
    const counts = [...host.querySelectorAll("details.sh-shelf")].map((d) => [
      (d.querySelector(".sh-name") || {}).textContent,
      (d.querySelector(".sh-count") || {}).textContent,
    ]);
    assert(ctx, counts.some((c) => c[0] === "keep" && c[1] === "1 / 5"),
      "one match among five rows reads `1 / 5`, not `6 / 10`, got: " +
      JSON.stringify(counts));
    assert(ctx, v.found === "1 of 6",
      "and the toolbar's own tally never counted them, got: " + v.found);

    const other = [...host.querySelectorAll("details.sh-shelf")].find(
      (d) => (d.querySelector(".sh-name") || {}).textContent === "other");
    assert(ctx, other && other.classList.contains("sh-nomatch"),
      "a shelf with nothing matching is dimmed — unreachable while its rows' " +
      "own <li> counted as hits");
    const keepEl = [...host.querySelectorAll("details.sh-shelf")].find(
      (d) => (d.querySelector(".sh-name") || {}).textContent === "keep");
    assert(ctx, keepEl && !keepEl.classList.contains("sh-nomatch"),
      "and a shelf with a match is not");
    assert(ctx, keep && keep.repos.indexOf("k3") !== -1,
      "the matching row is still where it was");

    ctx.info = "1 / 5 with a nested <li> per row (was 6 / 10), and `other` dims";
  }),
  check("shelf map - whose profile it was is written down, not left to be guessed",
    async (ctx) => {
    /* A STRANGER'S TAB IS STILL SHELVED (P.XIV narrows the verbs that spend the
       reader's token and write their configuration, not the reading of the
       page), so a record is written either way — and the two records were
       indistinguishable. The popup has no DOM on the tab and cannot call
       `isMine()`; buying that access costs a permission, which P.II does not
       allow it to spend on a label. So the page that knows says so.

       Withholding the stranger's record would not have been the safe option:
       "not yours" would read as "never opened", on a page that is fully shelved
       in front of the reader. */
    const mine = build({
      viewer: "octo", owner: "octo",
      settings: { groups: ["keep"] },
      repos: [{ name: "a", chips: ["keep"] }, { name: "b", chips: [] }],
    });
    await settle(1200);
    const r1 = (mine.store.local.shelfMap || {}).octo;
    assert(ctx, r1 && r1.status && r1.status.mine === true,
      "the reader's own profile is labelled as theirs, got: " +
      JSON.stringify(r1 && r1.status && r1.status.mine));

    const theirs = build({
      viewer: "me", owner: "octo",
      settings: { groups: ["keep"] },
      repos: [{ name: "a", chips: ["keep"] }, { name: "b", chips: [] }],
    });
    await settle(1200);
    const r2 = (theirs.store.local.shelfMap || {}).octo;
    assert(ctx, r2 && r2.status,
      "a stranger's profile still produces a record — it was still shelved");
    assert(ctx, r2 && r2.status && r2.status.mine === false,
      "and it says so, got: " + JSON.stringify(r2 && r2.status && r2.status.mine));

    /* AND IT CARRIES THE FIGURES, because the page it describes is shelved.
       These were briefly withheld after a leak — a profile passed through a
       minute ago outranked the reader's own visit on timestamp, so the popup
       drew SOMEONE ELSE'S `99 repos · 3 shelves` under "the last profile
       Shelves grouped". Withholding was the wrong fix: the numbers were right
       and the attribution was wrong, and it cost the reader the answer the free
       rungs had already produced for a page covered in shelves in front of
       them. `latestOf` in popup.js refuses a record that is not the reader's;
       that is where the bug lived. */
    assert(ctx, r2 && r2.status && r2.status.repos === 2,
      "the rest of the block is the same page it always was, got " +
      (r2 && r2.status && r2.status.repos));
    assert(ctx, r2 && r2.on && Object.keys(r2.on).length,
      "including which shelf each of their repos landed on");
    assert(ctx, /not yours/.test(String(r2 && r2.status && r2.status.source)),
      "and the source says which rungs were allowed to answer, got: " +
      JSON.stringify(r2 && r2.status && r2.status.source));

    /* UNKNOWN COUNTS AS MINE, exactly as `isMine` has it. A viewer meta GitHub
       moves must not make this one field read the same silence as a stranger —
       that would stand the popup down on the reader's own profile. */
    const blind = build({
      owner: "octo",
      settings: { groups: ["keep"] },
      repos: [{ name: "a", chips: ["keep"] }],
    });
    await settle(1200);
    const r3 = (blind.store.local.shelfMap || {}).octo;
    assert(ctx, r3 && r3.status && r3.status.mine === true,
      "a page with no viewer meta degrades to `mine`, got: " +
      JSON.stringify(r3 && r3.status && r3.status.mine));

    ctx.info = "own: mine true · stranger: figures kept, mine false, source says `not yours` · unreadable viewer: true";
  }),

  check("shelf map - other people's profiles are kept, but not hoarded",
    async (ctx) => {
    /* The reader's own profiles are the point of this map and are never
       evicted. Other people's are a browsing history, and one permanent entry
       per profile ever passed through would be a record of where the reader has
       been — kept forever, for a panel that only asks about the tab in front of
       it. So the newest few survive. */
    const w = build({ viewer: "me", owner: "me", settings: { groups: ["keep"] },
                      repos: [{ name: "a", chips: ["keep"] }] });
    await settle(1200);

    const map = w.store.local.shelfMap || {};
    for (let i = 1; i <= 7; i++) {
      await w.win.Shelves.shelfmap.write("stranger" + i, {
        order: ["keep"], counts: { keep: 1 }, on: {},
        status: { mine: false, repos: 1 },
      });
    }
    const after = w.store.local.shelfMap || {};
    const theirs = Object.keys(after).filter((k) => after[k].status.mine === false);

    assert(ctx, theirs.length === 5,
      "five of the seven strangers survive, got " + theirs.length);
    assert(ctx, theirs.indexOf("stranger1") === -1 && theirs.indexOf("stranger2") === -1,
      "and it is the oldest two that fell off, got: " + JSON.stringify(theirs.sort()));
    assert(ctx, !!after.me && after.me.status.mine === true,
      "the reader's own profile is never evicted, whatever else arrives");
    assert(ctx, typeof map === "object", "and the map is still a map");

    ctx.info = "7 strangers written, newest 5 kept, oldest 2 evicted, own profile untouched";
  }),
];

/* ---------------------------------------------------------------------- */

(async () => {
  /* AN ARGUMENT IS A NUMBER OR A KEYWORD. A number is an index and moves the
     moment a scenario is inserted above it; a keyword matches the scenario's
     own name and does not. Roadmap proofs should use keywords for exactly
     that reason — `node tests/harness.js facts` still means what it meant. */
  const args = process.argv.slice(2).filter(Boolean);
  const nums = args.filter((a) => /^\d+$/.test(a)).map(Number).filter((n) => n > 0);
  const words = args.filter((a) => !/^\d+$/.test(a)).map((a) => a.toLowerCase());
  const named = new Set();
  SCENARIOS.forEach((sc, i) => {
    if (words.some((w) => sc.name.toLowerCase().includes(w))) named.add(i + 1);
  });
  const pick = [...new Set([...nums, ...named])];

  /* A SELECTOR THAT NAMES NOTHING MUST FAIL, not pass emptily. `harness.js 9`
     printed "all 0 scenarios passed" and exited 0 — and a roadmap milestone
     whose proof is a scenario selector would therefore tick itself before the
     scenario was written, which is the one thing a proof exists to prevent. */
  const unknown = [
    ...nums.filter((n) => n > SCENARIOS.length).map(String),
    ...words.filter((w) => !SCENARIOS.some((sc) => sc.name.toLowerCase().includes(w))),
  ];
  if (unknown.length) {
    console.log("  FAIL  no such scenario: " + unknown.join(", ") +
                " (there are " + SCENARIOS.length + ")");
    process.exitCode = 1;
    return;
  }
  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    if (pick.length && !pick.includes(i + 1)) continue;
    const ctx = { bad: [], info: "" };
    try {
      await s.fn(ctx);
    } catch (e) {
      ctx.bad.push("threw: " + (e && e.stack ? e.stack.split("\n")[0] : e));
    }
    const ok = ctx.bad.length === 0;
    if (!ok) failures++;
    results.push({ n: i + 1, name: s.name, ok, bad: ctx.bad, info: ctx.info });
    console.log(
      (ok ? "  PASS  " : "  FAIL  ") + String(i + 1) + ". " + s.name +
      (ctx.info ? "\n          " + ctx.info : "")
    );
    ctx.bad.forEach((b) => console.log("          → " + b));
  }

  const ran = results.length;
  console.log(
    "\n" + (failures ? failures + " of " + ran + " scenarios FAILED" : "all " + ran + " scenarios passed")
  );
  process.exitCode = failures ? 1 : 0;
})();
