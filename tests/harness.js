/* SHELVES — tests/harness.js
 *
 *   node tests/harness.js            all scenarios
 *   node tests/harness.js 3 5        only those
 *
 * Assertions are on counts and membership, never on "it did not throw".
 */
"use strict";

const { build, readShelves, settle } = require("./world");

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

/* ---------------------------------------------------------------------- */

const SCENARIOS = [
  check("chips already on the page — zero network", async (ctx) => {
    const w = build({
      owner: "octo",
      settings: { groups: ["aiproject", "tooling"] },
      repos: [
        { name: "agent", chips: ["aiproject"] },
        { name: "rag", chips: ["aiproject", "python"] },
        { name: "dotfiles", chips: ["tooling"] },
        { name: "notes", chips: [] },
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
    assert(ctx, /via page/.test(v.note), "source should be 'page', got: " + v.note);
    assert(ctx, w.counters.api === 0, "page chips must cost no API call");
    assert(ctx, w.counters.scraped.length === 0, "page chips must cost no scraping");
    ctx.info = v.note;
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
    ctx.info = v.note + "  |  scraped " + w.counters.scraped.length;
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
    ctx.info = v.note + " · " + v.warn;
  }),
];

/* ---------------------------------------------------------------------- */

(async () => {
  const pick = process.argv.slice(2).map(Number).filter((n) => n > 0);
  /* A NUMBER THAT NAMES NOTHING MUST FAIL, not pass emptily. `harness.js 9`
     printed "all 0 scenarios passed" and exited 0 — and a roadmap milestone
     whose proof is a scenario number would therefore tick itself before the
     scenario was written, which is the one thing a proof exists to prevent. */
  const unknown = pick.filter((n) => n > SCENARIOS.length);
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
