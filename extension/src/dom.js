/* SHELVES — dom.js
 *
 * Everything that reads the GitHub page: is this the right route, where is the
 * list, what are its rows, and what is on pages 2..N.
 *
 * Reads only. It moves no nodes and creates none — view.js does that — so a
 * change to GitHub's markup has exactly one file to break.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  const HOST_ID = "shelves-host";
  const DONE = "shelvesDone"; // dataset flag: this <ul> is ours or is consumed

  S.HOST_ID = HOST_ID;
  S.DONE = DONE;

  /** The profile Repositories tab, and nothing else on github.com. */
  S.isRepoTab = function isRepoTab(loc) {
    loc = loc || location;
    const oneSegment = /^\/[^/]+\/?$/.test(loc.pathname);
    const tab = new URLSearchParams(loc.search).get("tab");
    return oneSegment && tab === "repositories";
  };

  S.owner = function owner(loc) {
    loc = loc || location;
    return (loc.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
  };

  /* MEASURED (charter §4): a <ul> we build still matches
   * "#user-repositories-list ul". Without both guards below, a second pass
   * regroups our own output and nests the whole page inside one shelf.
   * Guard one: never look inside our host. Guard two: never take a list
   * already marked consumed. */
  S.findList = function findList(root) {
    root = root || document;
    const selectors = [
      "#user-repositories-list ul",
      '[data-filterable-for="your-repos-filter"]',
      "#org-repositories ul",
    ];
    for (const sel of selectors) {
      for (const el of root.querySelectorAll(sel)) {
        if (el.closest && el.closest("#" + HOST_ID)) continue;
        if (el.dataset && el.dataset[DONE] === "1") continue;
        return el;
      }
    }
    return null;
  };

  S.rowsOf = function rowsOf(ul) {
    return Array.prototype.filter.call(ul.children, (n) => n.tagName === "LI");
  };

  /** "owner/name", lowercased — the key every topic source is keyed by. */
  S.fullNameOf = function fullNameOf(li) {
    const a =
      li.querySelector('a[itemprop~="name"]') ||
      li.querySelector("h3 a") ||
      li.querySelector('a[href^="/"]');
    if (!a) return "";
    const parts = (a.getAttribute("href") || "").split("/").filter(Boolean);
    return parts.length >= 2 ? (parts[0] + "/" + parts[1]).toLowerCase() : "";
  };

  /* MEASURED (charter §5): GitHub lowercases topics, so every topic in the
   * system is lowercase and comparisons can be too. */
  S.topicsIn = function topicsIn(root) {
    const out = [];
    root.querySelectorAll('a[href*="/topics/"], a.topic-tag').forEach((a) => {
      const m = (a.getAttribute("href") || "").match(/\/topics\/([^/?#]+)/);
      const raw = m ? m[1] : a.textContent.trim();
      if (!raw) return;
      let t;
      try {
        t = decodeURIComponent(raw);
      } catch (e) {
        t = raw;
      }
      t = t.toLowerCase();
      if (out.indexOf(t) === -1) out.push(t);
    });
    return out;
  };

  const nextLink = (root) =>
    root.querySelector('.paginate-container a[rel="next"], a.next_page');

  /* MEASURED (charter §3): the tab paginates at 30. Grouping only page one
   * gives shelves that are silently incomplete, which is worse than none.
   * Same-origin fetches, so the session cookie rides along for free (P.VII). */
  S.fetchRestOfPages = async function fetchRestOfPages(maxPages) {
    const out = [];
    let link = nextLink(document);
    let url = link ? link.href : null;
    let n = 0;
    while (url && n < (maxPages || 10)) {
      let doc;
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) break;
        doc = new DOMParser().parseFromString(await res.text(), "text/html");
      } catch (e) {
        break; // one unreachable page costs its repos, never the render (P.III)
      }
      const ul = S.findList(doc);
      if (!ul) break;
      S.rowsOf(ul).forEach((li) => out.push(document.importNode(li, true)));
      const nx = nextLink(doc);
      url = nx ? new URL(nx.getAttribute("href"), location.origin).href : null;
      n++;
    }
    return out;
  };

  S.hidePager = function hidePager() {
    const pager = document.querySelector(".paginate-container");
    if (pager) pager.style.display = "none";
  };
})(globalThis.Shelves);
