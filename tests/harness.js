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

const { build, readShelves, settle, type, writeNote, openVocab, pickTerm } =
  require("./world");

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
    ctx.info = v.note + " · " + v.warn;
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
    assert(ctx, p.open, "the vocabulary button must open the panel");
    if (!p.open) return;

    /* THE BADGE IS THE POINT. A panel nobody opens tells nobody anything, and
       the premise is that these problems are invisible - so the count has to be
       on the CLOSED button. 1 family + 3 suspicions + 1 blanket + 1 habit. */
    assert(ctx, p.badge === 6, "the toolbar must badge 6 findings, got " + p.badge);
    assert(ctx, /6 repos/.test(p.sum) && /6 tagged/.test(p.sum) && /6 topics/.test(p.sum),
      "the panel counts its own subject, got: " + p.sum);

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

    ctx.info = p.badge + " findings over " + p.terms.length + " topics";
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

    /* Past the palette, colours repeat rather than run out - and the two
       channels must still agree, so either one alone identifies a shelf for a
       reader who cannot use the other. */
    const m20 = ID("abcdefghijklmnopqrst".split(""), "Ungrouped");
    assert(ctx, m20.size === 20, "every shelf gets an identity, got " + m20.size);
    const pair = new Map();
    let agree = true;
    m20.forEach((x) => {
      if (pair.has(x.hue) && pair.get(x.hue) !== x.glyph) agree = false;
      pair.set(x.hue, x.glyph);
    });
    assert(ctx, agree, "a hue and its glyph must never disagree");

    /* Derived, never stored: none of this may have reached the disk. */
    const wrote = Object.keys(w.store.local || {}).concat(Object.keys(w.store.sync || {}));
    assert(ctx, wrote.indexOf("shelfColors") === -1 && wrote.indexOf("identity") === -1,
      "identity is a hash of the name, not a stored preference");

    ctx.info = named.map((s) => s.glyph + " " + s.label).join("   ") +
      "   " + other.glyph + " Ungrouped";
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
