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
   * says a missing input costs a feature, never the page.
   *
   * BUT SIGNED OUT IS NOT UNKNOWN. Logged-out browsing is a routine state, not
   * a markup change, and it read as one: no login in the meta, so every
   * profile on GitHub was "mine" — the reader's token went to `/user/repos` on
   * torvalds' tab and rung 4 cached a hundred of his repo pages for the
   * top-up to refresh forever. So silence is now split in two, and only the
   * half with no evidence either way keeps the benefit of the doubt. */
  const metaLogin = (doc, n) => {
    const m = doc.querySelector('meta[name="' + n + '"]');
    return m ? String(m.getAttribute("content") || "").trim().toLowerCase() : null;
  };

  /* WHO IS SIGNED IN, as three answers rather than two:
   *   true   a login is readable, or the page says it is signed in
   *   false  POSITIVE evidence of a signed-out page
   *   null   no evidence either way — the markup moved, decide nothing
   *
   * MEASURED on four signed-out pages (2026-10-03: a profile, a repo, an org
   * and an org's profile), all agreeing: `<meta name="user-login" content="">`
   * present and EMPTY (absent would be unknown, not out), `<body class=
   * "logged-out …">`, and `<header class="… header-logged-out">`. Any one is
   * enough. MEASURED signed in too (the same day, three pages: home, the
   * reader's own tab, a stranger's): both login metas filled, `<body class=
   * "logged-in …">`, no `header-logged-out`, and one `[data-login]` — the
   * reader's own. `logged-in` on the body is checked first and wins, so a stray
   * marker can never sign a reader out of their own profile. Not used: a
   * `/login` link (the repo page carries one outside the header, and signed-in
   * pages carry `return_to` links too) or `.HeaderMenu--logged-out` (gone). */
  S.signedIn = function signedIn(doc) {
    doc = doc || document;
    if (metaLogin(doc, "user-login") || metaLogin(doc, "octolytics-actor-login")) return true;
    const body = doc.body && doc.body.classList;
    if (body && body.contains("logged-in")) return true;
    if ((body && body.contains("logged-out")) ||
        metaLogin(doc, "user-login") === "" ||
        doc.querySelector("header.header-logged-out")) return false;
    return null;
  };

  S.viewer = function viewer(doc) {
    doc = doc || document;
    for (const n of ["user-login", "octolytics-actor-login"]) {
      const v = metaLogin(doc, n);
      if (v) return v;
    }
    /* ONLY WHEN SOMEBODY IS SIGNED IN. `[data-login]` is not the viewer's by
     * definition — avatars and hovercards on a profile carry the OWNER's and
     * the members' logins — so on a signed-out page the first one found would
     * name the owner, and that stranger's profile would be "mine" again. */
    if (S.signedIn(doc) === false) return "";
    // the header avatar carries it too, and has outlived several markup changes
    const av = doc.querySelector("[data-login]");
    const d = av && String(av.getAttribute("data-login") || "").trim().toLowerCase();
    return d || "";
  };

  S.isMine = function isMine(loc, doc) {
    const who = S.viewer(doc);
    if (who) return who === S.owner(loc);
    /* Signed out, there is no "mine": the free rungs only, no token, no
     * scraping, no cache write, no verbs that write the reader's setup. A
     * signed-in page whose login moved, and a page with no evidence at all,
     * keep today's behaviour (P.III). */
    return S.signedIn(doc) !== false;
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
   * Same-origin fetches, so the session cookie rides along for free (P.VII).
   *
   * ---- WHY THIS RETURNS A RECORD AND NOT AN ARRAY -------------------------
   * It used to return `out` alone, and the defect that made that unacceptable
   * was not in this function — it was in what the caller could then do with it.
   *
   * Every exit below except one leaves `url` holding a page nothing ever read:
   * the ceiling at `maxPages`, a non-ok response, a throw, a page whose list
   * could not be found. All four were discarded here. The caller therefore
   * could not tell "that was all of them" from "that was as many as I was
   * willing to fetch" — and it answered the question anyway, by calling
   * `hidePager()`, which sets display:none on the ONLY navigation to the pages
   * that were skipped. At 400 repositories and a ceiling of 10 that is 330
   * rows shelved, 70 unreachable by any gesture on the page, and a toolbar
   * reading `330 repos` as though it were the whole collection. One 429 on
   * page four of thirteen did the same thing with 120 rows.
   *
   * So the horizon leaves the loop with the rows. `truncated` is the single
   * fact the caller needs and it is the one the loop cannot help knowing:
   * `url` is still truthy exactly when there is more behind it. `stopped` is
   * for whoever reads a bug report rather than for the code — "cap" and
   * "http 429" fail identically on screen and want fixing differently. */
  S.fetchRestOfPages = async function fetchRestOfPages(maxPages) {
    const out = [];
    let link = nextLink(document);
    let url = link ? link.href : null;
    let n = 0;
    /* Overwritten by every exit but the healthy one, which is the exit that
     * never has to say anything: falling out of the `while` with `url` null IS
     * "end", and it is the only way `truncated` comes back false. */
    let stopped = "end";
    while (url && n < (maxPages || 10)) {
      let doc;
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) { stopped = "http " + res.status; break; }
        doc = new DOMParser().parseFromString(await res.text(), "text/html");
      } catch (e) {
        // one unreachable page costs its repos, never the render (P.III)
        stopped = "error";
        break;
      }
      const ul = S.findList(doc);
      if (!ul) { stopped = "nolist"; break; }
      S.rowsOf(ul).forEach((li) => {
        const row = document.importNode(li, true);
        S.dropStrandedFragments(row);
        out.push(row);
      });
      const nx = nextLink(doc);
      url = nx ? new URL(nx.getAttribute("href"), location.origin).href : null;
      n++;
    }
    /* The ceiling is the one exit with nothing to report for itself: no
     * request failed, the loop condition simply went false with a page still
     * in hand. Naming it here keeps the three break paths single-purpose. */
    if (url && stopped === "end") stopped = "cap";
    return { rows: out, truncated: !!url, pagesRead: n, stopped };
  };

  /* ---- HOW MANY ARE THERE REALLY, AND WHEN MAY WE SAY SO ------------------
   * The ceiling above can now announce itself, but "330 of what?" is not a
   * question this extension can answer by counting: the rows it did not fetch
   * are the rows it cannot count. GitHub renders the figure in the profile
   * nav, so it is read rather than derived.
   *
   * THE COUNTER COUNTS THE PROFILE, NOT THE LIST — AND THAT IS THE WHOLE
   * DIFFICULTY. GitHub's own Type / Language / search controls replace the
   * list wholesale and leave the nav counter alone, so on a filtered tab the
   * page genuinely holds `12 repositories` beside a counter reading `400`.
   * Printing "12 of 400" there is not an imprecision, it is a false statement
   * about a relationship that does not exist — and it is the kind of false
   * statement a reader has no way to catch, because both numbers are real.
   *
   * So a filter means null. Not a guess, not the unfiltered count, not the
   * row count doubling as a total: null, which every consumer is built to
   * render as "no claim". The trade is deliberate and it is the same one
   * P.III makes everywhere else — a missing number costs one qualifier on one
   * line, and a wrong number costs the reader their reason to believe the
   * other numbers beside it.
   *
   * `sort`, `direction` and `page` are NOT in the list and must not be: they
   * reorder and they offset, and neither changes which repositories are in
   * the collection the counter is counting. A reader who sorted by name is
   * still looking at all of them. */
  const LIST_FILTERS = ["q", "type", "language"];

  /* Ordered most specific first, exactly as `fullNameOf` is: the two ids are
   * GitHub's current spelling of the Repositories nav item and its counter,
   * and the href-shaped selectors below them are what survives the ids being
   * renamed — the one thing that cannot change while the tab works is that
   * the link to it carries `tab=repositories`. A selector that matches
   * something unparseable falls through to the next rather than returning
   * null, because a stale id matching the wrong span must not take the whole
   * answer with it. */
  const TOTAL_SELECTORS = [
    "#repositories-repo-tab-count",
    "#repositories-tab .Counter",
    '[data-tab-item="repositories"] .Counter',
    'nav a[href*="tab=repositories"] .Counter',
    'a[href*="tab=repositories"] .Counter',
  ];

  /* DELIBERATELY STRICTER THAN `count()` IN facts.js, and for a reason that
   * does not apply there: that one reads "1.2k" as 1200, which is the right
   * answer for a star count nobody compares against anything. Here the number
   * is put in a sentence beside an exact row count, so 1200 against a true
   * 1234 would be a visible lie about 34 repositories. The title attribute
   * carries the exact figure; the text is accepted only when it is exact. */
  function exactCount(raw) {
    const s = String(raw == null ? "" : raw).trim().replace(/[,\s]/g, "");
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  /** The profile's repository count, or null when we may not claim one. */
  S.repoTotal = function repoTotal(loc, doc) {
    loc = loc || location;
    doc = doc || document;
    const qs = new URLSearchParams(loc.search);
    for (const k of LIST_FILTERS) {
      const v = qs.get(k);
      if (v !== null && String(v).trim() !== "") return null;
    }
    for (const sel of TOTAL_SELECTORS) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const titled = exactCount(el.getAttribute && el.getAttribute("title"));
      if (titled !== null) return titled;
      const written = exactCount(el.textContent);
      if (written !== null) return written;
    }
    return null;
  };

  S.hidePager = function hidePager() {
    const pager = document.querySelector(".paginate-container");
    if (!pager) return;
    pager.style.display = "none";
    pager.dataset.shHid = "1";   // so `unshelve` gives back only what we took
  };

  /* ---- the page as GitHub drew it, put back -------------------------------
   * TURBO CACHES A CORPSE UNLESS WE HAND IT THE ORIGINAL. On every in-page
   * navigation Turbo snapshots the body — a deep clone, so every listener on
   * the host is gone — and Back restores that clone. The id was still there,
   * so `run()` declined to rebuild and the reader got shelves that looked
   * right and answered nothing: no find, no grip, no keys, and, if a filter
   * was on when the snapshot was taken, rows hidden by `sh-hide` beside an
   * empty find box with no control left on the page that could show them.
   *
   * So the host is taken apart again and GitHub's own list is put back where
   * it stood: the same row nodes, in the order GitHub drew them, with every
   * mark we made on them removed — because every guard in render() reads
   * those marks as "already decorated" and would keep the dead ones.
   *
   * IT WORKS ON A CLONE TOO, which is the other caller. Nothing it needs
   * lives in a closure: the list's own shell rides inside the host in a
   * <template> (cloned with it), and each page-one row carries `data-sh-i`.
   * Rows merged from pages 2..N carry no index and are dropped — they were
   * copies of another document's rows, and the pager they came from is
   * shown again. */
  const SHELL = "sh-source";

  S.keepSource = function keepSource(host, ul) {
    if (!host || !ul || host.querySelector(":scope > template." + SHELL)) return;
    const tpl = document.createElement("template");
    tpl.className = SHELL;
    const shell = ul.cloneNode(false);
    delete shell.dataset[DONE];
    tpl.content.appendChild(shell);
    host.appendChild(tpl);
  };

  S.unshelve = function unshelve(host) {
    if (!host || !host.parentNode) return null;
    const tpl = host.querySelector(":scope > template." + SHELL);
    let ul = tpl && tpl.content.firstElementChild
      ? document.importNode(tpl.content.firstElementChild, false)
      : null;
    if (!ul) {
      /* No shell to be had: the shelf lists copied the source's class, which
       * is what the finder's selectors care about. */
      ul = document.createElement("ul");
      const like = host.querySelector("ul");
      if (like) ul.className = like.className;
    }
    delete ul.dataset[DONE];

    const rows = Array.from(host.querySelectorAll("li[data-sh-i]"))
      .sort((a, b) => Number(a.dataset.shI) - Number(b.dataset.shI));

    for (const li of rows) {
      li.querySelectorAll(".sh-margin").forEach((m) => m.remove());
      li.querySelectorAll(".sh-col").forEach((c) => c.classList.remove("sh-col"));
      li.classList.remove("sh-hide");
      for (const k of Object.keys(li.dataset)) {
        if (/^sh[A-Z]/.test(k)) delete li.dataset[k];
      }
      ul.appendChild(li);
    }

    host.replaceWith(ul);
    document.querySelectorAll("#sh-status").forEach((s) => s.remove());
    document.querySelectorAll(".paginate-container[data-sh-hid]").forEach((p) => {
      p.style.display = "";
      delete p.dataset.shHid;
    });
    return ul;
  };

  /* A host is LIVE only if this script instance built it. `rebucket` is a
   * property on the element, and a clone — Turbo's snapshot — never carries
   * one. */
  S.isLiveHost = function isLiveHost(host) {
    return !!host && host.isConnected && typeof host.rebucket === "function";
  };
})(globalThis.Shelves);
