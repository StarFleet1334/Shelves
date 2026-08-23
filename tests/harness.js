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

const { build, readShelves, settle, type, writeNote, openVocab, pickTerm,
        pickGap, readMark } = require("./world");

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
      ctx.info = good.length + " accepted, " + bad.length + " rejected";
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
