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

  /* github.com/<a>/<b> IS NOT A SHAPE, IT IS A GUESS. The same two segments
   * serve /settings/appearance, /orgs/acme, /features/copilot and every
   * marketing page GitHub has ever shipped, so matching on shape alone would
   * hang a shelf chip off the pricing page.
   *
   * The list below is a DENY list rather than an allow list, and that is the
   * direction that fails safe here: a reserved word nobody thought of costs
   * one wrong chip on one page, while an allow list that misses a shape costs
   * the whole feature everywhere. Both failures are visible; only one of them
   * is small. */
  const RESERVED = new Set([
    "about", "account", "apps", "blog", "business", "codespaces", "collections",
    "contact", "customer-stories", "dashboard", "enterprise", "events",
    "explore", "features", "gist", "issues", "join", "login", "logout",
    "marketplace", "new", "notifications", "orgs", "pricing", "pulls",
    "readme", "search", "security", "sessions", "settings", "site", "sponsors",
    "stars", "topics", "trending", "users", "watching", "welcome",
  ]);

  /** The repo's OWN landing page, and only that: a sub-page (issues, blob, …)
   *  does not carry the About sidebar the chip belongs beside. */
  S.isRepoPage = function isRepoPage(loc) {
    loc = loc || location;
    const parts = loc.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return false;
    if (RESERVED.has(parts[0].toLowerCase())) return false;
    if (new URLSearchParams(loc.search).get("tab")) return false;
    return true;
  };

  /** "owner/name" for the page we are standing on, lowercased like every other
   *  key in the system. */
  S.pageRepo = function pageRepo(loc) {
    loc = loc || location;
    const parts = loc.pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? (parts[0] + "/" + parts[1]).toLowerCase() : "";
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

  /* ---- names are page input, and page input is not trusted ---------------
   * `fullNameOf` reads two path segments off an href the PAGE supplied, and
   * that string goes straight into `fetch("/" + name)` in three files. The
   * leading slash contains it — every crafted form measured stayed on
   * github.com, so there is no SSRF here — but it does not contain WHICH
   * github.com path, and `/settings/tokens/x` resolved cleanly to
   * `github.com/settings/tokens`: an authenticated GET of a sensitive page,
   * whose text would then be cached and made searchable in the reader's own
   * UI. Nothing leaves the browser, so this is a capability that should not
   * exist rather than a breach — and it costs one regex to remove.
   *
   * A rejected name costs that row its shelf and nothing else (P.III), which
   * is the right failure: an owner spelled in some way GitHub allows and this
   * pattern does not is one unshelved repo, never a broken page. */
  const OWNER_RE = /^[a-z0-9][a-z0-9._-]*$/;
  const REPO_RE = /^[a-z0-9._-]+$/;

  S.safeRepo = function safeRepo(owner, repo) {
    const o = String(owner || "").toLowerCase();
    const r = String(repo || "").toLowerCase();
    if (!OWNER_RE.test(o) || !REPO_RE.test(r)) return "";
    if (RESERVED.has(o)) return "";          // /settings/tokens and friends
    if (r === "." || r === "..") return "";
    return o + "/" + r;
  };

  /** "owner/name", lowercased — the key every topic source is keyed by. */
  S.fullNameOf = function fullNameOf(li) {
    const a =
      li.querySelector('a[itemprop~="name"]') ||
      li.querySelector("h3 a") ||
      li.querySelector('a[href^="/"]');
    if (!a) return "";
    const parts = (a.getAttribute("href") || "").split("/").filter(Boolean);
    return parts.length >= 2 ? S.safeRepo(parts[0], parts[1]) : "";
  };

  /* ---- whose profile is this? --------------------------------------------
   * MEASURED, and it is the sharpest finding in the pre-publication review:
   * `isRepoTab()` tests the URL shape and the `tab` param, and NOTHING
   * anywhere asked whose profile it was. Opening a stranger's Repositories tab
   * therefore sent the reader's own Bearer token to the API — which answers
   * with the READER's repos, useless on that page — and then fetched every one
   * of the stranger's repo pages with the reader's session cookie, caching
   * them permanently. One click on a link, six hundred authenticated requests,
   * and a cache that the background top-up then refreshes forever.
   *
   * UNKNOWN COUNTS AS MINE. If the meta moves, answering "not yours" would
   * disable the extension for everybody at once; answering "yours" restores
   * exactly today's behaviour for the one case we cannot read. Principle III
   * says a missing input costs a feature, never the page. */
  S.viewer = function viewer(doc) {
    doc = doc || document;
    const metas = ["user-login", "octolytics-actor-login"];
    for (const n of metas) {
      const m = doc.querySelector('meta[name="' + n + '"]');
      const v = m && String(m.getAttribute("content") || "").trim().toLowerCase();
      if (v) return v;
    }
    // the header avatar carries it too, and has outlived several markup changes
    const av = doc.querySelector("[data-login]");
    const d = av && String(av.getAttribute("data-login") || "").trim().toLowerCase();
    return d || "";
  };

  S.isMine = function isMine(loc, doc) {
    const who = S.viewer(doc);
    if (!who) return true;                   // cannot tell: behave as before
    return who === S.owner(loc);
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

  /* A ROW MERGED FROM ANOTHER PAGE LEAVES ITS SPARKLINE BEHIND, AND THERE IS
   * NO WAY TO BRING IT. GitHub's commit graph is a <poll-include-fragment>
   * that carries a `data-nonce` belonging to the response it was served in,
   * and page 2's nonce is not page 1's. Imported into this document it never
   * reaches the network at all — measured on a real signed-in profile: 30
   * requests for the 30 rows GitHub served, and zero for the 47 we merged.
   * It goes straight to `is-error` and reveals the `data-show-on-forbidden-
   * error` blankslate GitHub ships inside it.
   *
   * THAT BLANKSLATE IS A FULL-WIDTH PAGE ELEMENT AND IT LANDS IN A 145px
   * COLUMN, where "Uh oh! There was an error while loading." wraps to about
   * one character per line. Measured, signed in, in a real browser: 47 rows at
   * 1 416px each against 109px for the ones GitHub served itself — 60 000px of
   * vertical error message, which reads as blank because at that width there
   * is nothing legible in it. It is invisible signed OUT, where the fragments
   * load, which is exactly how it survived being looked for twice.
   *
   * So the fragment is dropped on the way in. We know it cannot work; keeping
   * it means keeping the error. The cost is a missing green line on merged
   * rows — which is all the reader ever had there — and the alternative is 47
   * more authenticated requests for a decoration nobody asked us to fetch.
   *
   * Every OTHER lazy fragment in a merged row is stranded for the same reason,
   * so this is written against the element and not against the sparkline. */
  S.dropStrandedFragments = function dropStrandedFragments(row) {
    row.querySelectorAll("include-fragment, poll-include-fragment")
       .forEach((f) => f.remove());
    return row;
  };

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
      S.rowsOf(ul).forEach((li) => {
        const row = document.importNode(li, true);
        S.dropStrandedFragments(row);
        out.push(row);
      });
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
