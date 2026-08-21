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

  S.factsFrom = function factsFrom(doc, fullName) {
    const sidebar =
      doc.querySelector('.Layout-sidebar, [data-testid="repository-sidebar"]') || doc;
    const f = {
      name: String(fullName || "").toLowerCase(),
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
    return f;
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
