/* SHELVES — facts.js
 *
 * ONE PARSE, TEN FACTS. `scrape()` was already fetching each repo's own page,
 * reading four topic chips out of the sidebar, and throwing the document away.
 * That same HTML carries the description, the language, stars, forks, the
 * licence, the homepage, whether it is archived or a fork, when it was last
 * touched, and the README's opening line. All of it for a request we are
 * already paying for — the difference between an expensive way to get topics
 * and an index of everything you own.
 *
 * THE SELECTORS LIVE HERE AND NOWHERE ELSE. dom.js owns the profile list;
 * this file owns the repo page. When GitHub restructures — measurement 6 says
 * it will — there are two files to look at and no third.
 *
 * Every extractor is its own function with its own fallback chain, and every
 * one of them may return "" or null. A field that cannot be read costs that
 * field and nothing else (P.III); there is no arrangement of missing data in
 * which this file throws.
 *
 * MEASURED vs BEST-EFFORT, stated plainly because the difference matters:
 * `topics` and `description` are read the way the prototype measured them
 * (sidebar chips, and the page's own <meta>). The rest are best-effort until
 * they have been driven against a real logged-in repo page — they prefer
 * <meta> tags and href SHAPES over class names precisely because class names
 * are the half that churns. A wrong selector here is an absent field, never a
 * wrong one, which is why this was safe to ship ahead of that pass.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  const text = (el) => (el ? String(el.textContent || "").trim() : "");

  /** "1.2k" / "12,345" / "" → a number, or null when it cannot be read. */
  function count(raw) {
    const s = String(raw || "").trim().toLowerCase().replace(/,/g, "");
    if (!s) return null;
    const m = s.match(/^([\d.]+)\s*([km])?$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!isFinite(n)) return null;
    return Math.round(n * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1));
  }

  function meta(doc, name) {
    const el =
      doc.querySelector('meta[name="' + name + '"]') ||
      doc.querySelector('meta[property="' + name + '"]');
    return el ? String(el.getAttribute("content") || "").trim() : "";
  }

  /* GitHub appends its own boilerplate to the page description; the repo's
     actual About text is everything before it. Keeping the tail would make
     every description on the page end in the same sentence, which is worse
     than none — the filter would match every row on the word "contribute".

     THE JOINING PERIOD IS TAKEN WITH IT, and that choice is not free. GitHub
     writes "<about>. Contribute to …" and there is no way to tell its
     separator from a full stop the owner typed. Eating it costs one character
     of cosmetics on descriptions that ended in a period anyway; keeping it
     leaves a stray "." on every description that did not, which is the more
     visible of the two wrongs and the one a reader would report as a bug. */
  const BOILER = /[\s.]*(Contribute to .+? development by creating an account on GitHub\.?|Create an account on GitHub.*)$/i;

  /* ---- WHERE THE ABOUT PANEL IS, STRUCTURALLY -----------------------------
   * `.Layout-sidebar, [data-testid="repository-sidebar"]` used to be the whole
   * answer here, with `|| doc` behind it. mark.js measured that pair as dead
   * on the live page and grew a structural finder; this file kept the pair and
   * never got one, which mattered more, because `|| doc` does not fail — it
   * SUCCEEDS WRONGLY. Unscoped, `topicsIn` reads every /topics/ link in the
   * document, so a README full of them becomes the repo's tags (the scar this
   * scoping exists for), and `license` and `homepage` are read off README
   * badges. Three fabricated fields where P.XI promises absent ones.
   *
   * RE-MEASURED, on six real repo pages fetched and parsed exactly as
   * `scrape()` parses them — the server's HTML through DOMParser, no scripts,
   * no layout: the class pair matched 0 of 6, the structural finder matched
   * 6 of 6 and scoped the topics correctly. The live canary said the same
   * thing at scale in the same hour: "read 50 pages, found the About sidebar
   * on 0". Both documents agree, which is the fact nobody had written down —
   * mark.js reads the hydrated DOM and this file reads the server's response,
   * and the selector strategy turns on whether they differ. They do not.
   *
   * Climb from the "About" heading until an ancestor also holds one of the
   * sidebar's other landmarks. Bounded so an unbounded climb cannot end at
   * <body>: never an ancestor containing the repo's <h1>, and — only where
   * layout reports a width at all, so a parsed document is not fenced out —
   * never something as wide as half the window. */
  const LANDMARK =
    /^(releases?|packages?|languages?|contributors?|deployments?|environments?|used by)$/i;

  function heading(doc, re) {
    return [...doc.querySelectorAll("h2, h3")].filter((h) =>
      re.test(String(h.textContent || "").trim())
    );
  }

  S.sidebarOf = function sidebarOf(doc) {
    /* The class stays as a FAST PATH: when it is right it is right, and it
     * costs one selector to find out. */
    const named = doc.querySelector(
      '.Layout-sidebar, [data-testid="repository-sidebar"]'
    );
    if (named) return named;

    const about = heading(doc, /^about$/i)[0];
    if (!about) return null;
    const others = heading(doc, LANDMARK);
    const h1 = doc.querySelector("h1");
    const win = doc.defaultView;
    const room = win && win.innerWidth ? win.innerWidth : 0;

    let el = about.parentElement;
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      if (h1 && el.contains(h1)) return null;          // climbed out of the column
      const w = el.getBoundingClientRect ? el.getBoundingClientRect().width : 0;
      if (room && w > room * 0.5) return null;         // that is the page, not a column
      const anchored =
        others.some((o) => el.contains(o)) ||
        !!el.querySelector('a[href^="/topics/"]');
      if (anchored) return el;
    }
    return null;
  };

  S.factsFrom = function factsFrom(doc, fullName) {
    const nest = S.sidebarOf(doc);
    /* NO `|| doc`. With no sidebar found, the three fields that live in it are
     * ABSENT — which is what P.XI asks for and what the canary below can then
     * report. Falling back to the whole document turned a selector failure
     * into invented data, and invented data is the one failure this file's
     * canary cannot see, because a fabricated field looks exactly like a
     * found one. */
    const sidebar = nest || doc.createElement("div");
    const f = {
      name: String(fullName || "").toLowerCase(),
      via: "page",
      topics: S.topicsIn(sidebar),          // measured (charter §7)
      description: description(doc),
      language: language(doc, sidebar),
      stars: stars(doc),
      forks: forks(doc),
      license: license(sidebar),
      homepage: homepage(sidebar),
      readme: readme(doc),
      updated: updated(doc),
      archived: archived(doc),
      fork: isFork(doc),
    };

    /* ---- the canary ------------------------------------------------------
     * WHICH ANCHORS WERE THERE AT ALL, as opposed to what they said. The two
     * are different questions and only the first can catch the failure this
     * file is guaranteed to meet eventually (measurement 6: GitHub will
     * restructure). A dead selector and a repo with nothing filled in produce
     * the SAME record — every field blank — so a reader watching values can
     * never tell "you have 76 untagged repos" from "the sidebar moved and
     * SHELVES is now shelving nothing correctly".
     *
     * `meta` is the sharpest of the four because GitHub ships a description
     * meta on every repo page it serves, INCLUDING repos with no About text
     * (it falls back to "Contribute to o/n development…"). So a missing raw
     * meta is close to proof that the parse, not the repo, is the empty one —
     * which is why it is recorded before the boilerplate is stripped.
     *
     * This never leaves the run: topics.js tallies it and drops it before the
     * record is cached, because it is a fact about this parse and not about
     * the repository. */
    f.saw = {
      meta: !!(meta(doc, "description") || meta(doc, "og:description")),
      sidebar: !!nest,
      counter: !!doc.querySelector('#repo-stars-counter-star, a[href$="/stargazers"]'),
      time: !!doc.querySelector("relative-time[datetime], time[datetime]"),
    };
    return f;
  };

  /**
   * Was this page the shape we know how to read? Counts the anchors seen
   * across a run of scrapes and answers with a sentence, or "" for fine.
   *
   * FIVE PAGES IS THE FLOOR, and it is not arbitrary: below that a run of
   * genuinely sparse repos is indistinguishable from a broken selector, and a
   * canary that cries on a sample of two would be turned off within a week —
   * at which point it is worth less than no canary at all. Half is the line
   * because GitHub rolls markup out gradually; a real change shows up as most
   * pages failing, never as one.
   */
  S.pageHealth = function pageHealth(seen) {
    const n = seen && seen.pages ? seen.pages : 0;
    if (n < 5) return "";
    const short = [];
    if (seen.meta / n < 0.5) short.push("a description on " + seen.meta);
    if (seen.sidebar / n < 0.5) short.push("the About sidebar on " + seen.sidebar);
    if (!short.length) return "";
    /* The sidebar is the one that matters: topics live in it, and topics are
       the whole product. A missing description costs a search term; a missing
       sidebar means every shelf on this page is wrong. */
    const grave = seen.sidebar / n < 0.5;
    return (grave ? "GitHub's repo page changed shape — shelving is unreliable"
                  : "GitHub's repo page may have changed shape") +
           ": read " + n + " pages, found " + short.join(" and ") + " (see facts.js)";
  };

  /* The <meta> is the same string GitHub gives Google and is far steadier than
     any class in the sidebar; og:description is the twin it ships beside it. */
  function description(doc) {
    let d = meta(doc, "description") || meta(doc, "og:description");
    d = d.replace(BOILER, "").trim();
    if (d) return d.slice(0, 300);
    return text(
      doc.querySelector('[data-testid="repo-description"], .Layout-sidebar p.f4')
    ).slice(0, 300);
  }

  /* The Languages section links to the repo's own code search, which is a URL
     SHAPE — `/owner/name/search?l=python` — rather than a class. The first one
     is the dominant language, which is what the row would show. */
  function language(doc, sidebar) {
    const a =
      sidebar.querySelector('a[href*="/search?l="]') ||
      doc.querySelector('[itemprop="programmingLanguage"]');
    if (!a) return "";
    const href = a.getAttribute && a.getAttribute("href");
    const m = href && href.match(/[?&]l=([^&]+)/);
    if (m) {
      try {
        return decodeURIComponent(m[1]).replace(/\+/g, " ");
      } catch (e) {
        return m[1];
      }
    }
    return text(a);
  }

  /* The counters carry the EXACT number in a title attribute and a rounded one
     in their text ("1.2k"); prefer the title, fall back to parsing the text. */
  function counter(doc, id, hrefEnd) {
    const el =
      doc.querySelector("#" + id) ||
      doc.querySelector('a[href$="/' + hrefEnd + '"] .Counter') ||
      doc.querySelector('a[href$="/' + hrefEnd + '"]');
    if (!el) return null;
    return count(el.getAttribute && el.getAttribute("title")) ?? count(text(el));
  }

  const stars = (doc) => counter(doc, "repo-stars-counter-star", "stargazers");
  const forks = (doc) => counter(doc, "repo-network-counter", "forks");

  function license(sidebar) {
    const a = sidebar.querySelector('a[href*="LICENSE"], a[href*="#license"]');
    // "MIT license" is the sidebar's own wording; the licence is the first word
    const t = text(a).replace(/\s*licen[cs]e\s*$/i, "");
    return t.slice(0, 40);
  }

  function homepage(sidebar) {
    const a = sidebar.querySelector('a[href^="http"]:not([href*="github.com"])');
    return a ? String(a.getAttribute("href") || "").slice(0, 200) : "";
  }

  /* The README's opening sentence is what a person would read to remember what
     a repo IS — the single most useful string for finding a repo you cannot
     name, and the reason `/` can beat GitHub's own name-only filter. */
  function readme(doc) {
    const body = doc.querySelector(
      'article.markdown-body, [data-testid="readme"] article, #readme article'
    );
    if (!body) return "";
    for (const p of body.querySelectorAll("p")) {
      const t = text(p);
      if (t.length > 12) return t.slice(0, 400);
    }
    return "";
  }

  /* <relative-time datetime> is a custom element GitHub has shipped for years
     and is the one timestamp on the page that is machine-readable. */
  function updated(doc) {
    const el = doc.querySelector("relative-time[datetime], time[datetime]");
    const raw = el && el.getAttribute("datetime");
    const t = raw ? Date.parse(raw) : NaN;
    return isFinite(t) ? t : null;
  }

  function archived(doc) {
    if (doc.querySelector('[data-testid="archived-banner"]')) return true;
    return /this repository has been archived/i.test(
      text(doc.querySelector(".flash, .Banner, .js-notice"))
    );
  }

  function isFork(doc) {
    if (doc.querySelector("span.fork-flag, .fork-flag")) return true;
    return /forked from/i.test(text(doc.querySelector('[data-testid="repo-header"], .Layout-main header')));
  }

  /* ---- the API's answer, in the same shape ------------------------------ */

  /**
   * The worker hands back what api.github.com already put in the body — the
   * same fields, so a repo answered by rung 2 and one answered by rung 4 are
   * indistinguishable downstream. Anything the API does not carry (the README)
   * is simply absent, which is the shape everything here already handles.
   */
  S.factsFromApi = function factsFromApi(row) {
    return {
      name: String(row.full_name || "").toLowerCase(),
      /* WHICH SOURCE ANSWERED, kept on the record. Not bookkeeping: the API
       * body carries no README, so "this repo has no README" and "this record
       * came from a source that could not have one" are different statements,
       * and an audit that cannot tell them apart reports a gap on every repo
       * the API answered. A field is absent for two reasons and only one of
       * them is the repository's fault. */
      via: "api",
      topics: Array.isArray(row.topics) ? row.topics.map((t) => String(t).toLowerCase()) : [],
      description: String(row.description || "").slice(0, 300),
      language: String(row.language || ""),
      stars: typeof row.stars === "number" ? row.stars : null,
      forks: typeof row.forks === "number" ? row.forks : null,
      license: String(row.license || ""),
      homepage: String(row.homepage || "").slice(0, 200),
      readme: "",
      updated: typeof row.updated === "number" ? row.updated : null,
      archived: !!row.archived,
      fork: !!row.fork,
    };
  };

  /**
   * Everything about a repo a person might type into the filter, as one
   * lowercase string. Built once per row and cached on the element, because
   * the filter runs on every keystroke over every row.
   */
  S.haystack = function haystack(rowText, facts, note) {
    const f = facts || {};
    return [
      rowText,
      f.description,
      (f.topics || []).join(" "),
      f.language,
      f.license,
      f.readme,
      note,
    ]
      .filter(Boolean)
      .join("  ")
      .toLowerCase();
  };
})(globalThis.Shelves);
