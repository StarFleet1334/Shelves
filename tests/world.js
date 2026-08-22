/* SHELVES — tests/world.js
 *
 * Builds a fake GitHub in memory: a jsdom page, a chrome.* stub, and the REAL
 * service worker running in a vm context so message passing is exercised end
 * to end rather than reimplemented in the test.
 *
 * The lesson that made this file careful: when a test fails, suspect the
 * harness first. Two of the prototype's "failures" were a stub regex matching
 * `per_page=100` as `page=100`. Fixtures here are therefore deliberately dumb.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

const EXT = path.join(__dirname, "..", "extension");
const CONTENT = ["src/store.js", "src/dom.js", "src/facts.js", "src/topics.js",
                 "src/vocab.js", "src/audit.js", "src/view.js", "src/mark.js",
                 "src/warm.js", "src/main.js"];

/* ---- fixtures ---------------------------------------------------------- */

function chip(topic) {
  return `<a class="topic-tag topic-tag-link" href="/topics/${topic}">${topic}</a>`;
}

/* SHAPED LIKE THE REAL ROW, not merely like enough. GitHub's <li> is a flex
 * row holding a wide text column and a narrow Star column, and the heading is
 * nested two levels inside the first. A flatter fake let a real bug through:
 * the note margin is meant to land IN the text column, and with no column to
 * find, the harness could not tell right placement from wrong. */
function row(owner, name, topics) {
  const chips = (topics || []).map(chip).join("");
  return (
    `<li class="col-12 d-flex flex-justify-between">` +
    `<div class="col-10 d-inline-block">` +
    `<div class="d-inline-block mb-1">` +
    `<h3><a itemprop="name codeRepository" href="/${owner}/${name}">${name}</a></h3>` +
    `</div>` +
    (chips ? `<div class="topics">${chips}</div>` : "") +
    `</div>` +
    `<div class="col-2 d-inline-block text-right"><button class="btn">Star</button></div>` +
    `</li>`
  );
}

/** The profile Repositories tab. `next` renders a pagination link. */
function profilePage(owner, repos, next) {
  const items = repos.map((r) => row(owner, r.name, r.chips)).join("");
  return `<!doctype html><html><body>
    <div id="user-repositories-list">
      <ul class="repo-list" data-filterable-for="your-repos-filter">${items}</ul>
      <div class="paginate-container">${
        next ? `<a rel="next" href="${next}">Next</a>` : ""
      }</div>
    </div>
  </body></html>`;
}

/** A repo's own page. Topics live in the sidebar (charter §7) — and so does
 *  everything else facts.js harvests, which is the point of idea 1. Shaped
 *  after the real page's STABLE parts: the <meta> description GitHub gives
 *  search engines, the counters' title attributes, the language link's
 *  `?l=` shape, <relative-time datetime>. Deliberately dumb, per this file's
 *  own rule about suspecting the harness first.
 *
 *  Accepts a repo object; an array is still read as bare topics so an older
 *  caller keeps working. */
function repoPage(repo, owner, name) {
  const r = Array.isArray(repo) ? { topics: repo } : (repo || {});
  const topics = r.topics || [];
  const full = (owner || "octo") + "/" + (name || r.name || "repo");
  const desc = r.description || "";
  const metaDesc = desc
    ? `${desc}. Contribute to ${full} development by creating an account on GitHub.`
    : "";
  /* `broken` is GitHub having moved on: the description meta gone and the
     About panel no longer called `.Layout-sidebar`. Deliberately NOT a page
     with nothing on it — the topics are still there, still findable through
     the whole-document fallback, so the parse still returns something that
     LOOKS right. That is the failure the canary exists for; a page that came
     back empty would have been obvious without one. */
  const sideClass = r.sidebarClass || (r.broken ? "AboutPanel" : "Layout-sidebar");
  return `<!doctype html><html><head>
    ${metaDesc && !r.broken ? `<meta name="description" content="${metaDesc}">` : ""}
  </head><body>
    <div class="${sideClass}">
      ${r.noAbout ? "" : "<h2>About</h2>"}
      ${topics.map(chip).join("")}
      ${r.homepage ? `<a href="${r.homepage}">${r.homepage}</a>` : ""}
      ${r.license ? `<a href="/${full}/blob/HEAD/LICENSE">${r.license} license</a>` : ""}
      ${r.language ? `<a href="/${full}/search?l=${encodeURIComponent(r.language)}">${r.language}</a>` : ""}
      <h2>Releases</h2>
      <h2>Languages</h2>
    </div>
    ${r.stars != null ? `<a id="repo-stars-counter-star" href="/${full}/stargazers" title="${r.stars}">${r.stars}</a>` : ""}
    ${r.forks != null ? `<a id="repo-network-counter" href="/${full}/forks" title="${r.forks}">${r.forks}</a>` : ""}
    ${r.updated ? `<relative-time datetime="${r.updated}">then</relative-time>` : ""}
    ${r.archived ? `<div class="flash">This repository has been archived by the owner. It is now read-only.</div>` : ""}
    ${r.readme ? `<article class="markdown-body"><p>${r.readme}</p></article>` : ""}
    <div class="readme"><a href="/topics/decoy">decoy link outside the sidebar</a></div>
  </body></html>`;
}

/* ---- the chrome.* stub ------------------------------------------------- */

function makeChrome(store, onMessage) {
  const area = (name) => ({
    get(defaults, cb) {
      const out = { ...defaults };
      for (const k of Object.keys(defaults)) {
        if (store[name] && k in store[name]) out[k] = store[name][k];
      }
      setTimeout(() => cb(out), 0);
    },
    set(obj, cb) {
      store[name] = { ...(store[name] || {}), ...obj };
      setTimeout(() => cb && cb(), 0);
    },
  });

  return {
    runtime: {
      lastError: null,
      sendMessage(msg, cb) {
        onMessage(msg, (reply) => setTimeout(() => cb(reply), 0));
      },
    },
    storage: {
      sync: area("sync"),
      local: area("local"),
      onChanged: { addListener() {} },
    },
  };
}

/* ---- the real service worker, in a vm --------------------------------- */

function bootWorker(fetchImpl, counters) {
  let listener = null;
  const chromeStub = {
    runtime: {
      onMessage: {
        addListener(fn) {
          listener = fn;
        },
      },
    },
  };
  const sandbox = {
    chrome: chromeStub,
    fetch: async (url, opts) => {
      counters.api++;
      counters.lastAuth = !!(opts && opts.headers && opts.headers.Authorization);
      return fetchImpl(String(url), opts);
    },
    console,
    URL,
    setTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXT, "background.js"), "utf8"), sandbox, {
    filename: "background.js",
  });
  if (!listener) throw new Error("background.js registered no message listener");

  return (msg, respond) => {
    const kept = listener(msg, null, respond);
    if (kept !== true) throw new Error("background.js must return true to keep the channel open");
  };
}

/* ---- assembling a world ------------------------------------------------ */

/**
 * @param {object} opts
 *   owner       profile being viewed
 *   at          "owner/name" to stand on a REPO PAGE instead of the profile
 *               tab; `repos` then describes what exists on this fake GitHub
 *               (what a fetch can resolve) rather than what is listed
 *   page        the repo object rendered at `at`
 *   shelfMap    seed for the map the profile page leaves behind
 *   repos       [{name, chips?, private?, topics?}] — page 1
 *   page2       [{...}] optional second page
 *   apiRepos    what the API answers with, or a number for an HTTP error
 *   settings    seed for chrome.storage.sync
 *   token       seed for chrome.storage.local
 *   cache       seed topic cache
 */
function build(opts) {
  const owner = opts.owner || "octo";
  const store = {
    sync: { ...(opts.settings || {}) },
    local: { token: opts.token || "", repoFacts: opts.cache || {},
             topicCache: opts.legacyCache || {},
             shelfMap: opts.shelfMap || {},
             notes: opts.notes || {} },
  };
  const counters = { api: 0, lastAuth: false, pages: [], scraped: [] };

  /* TWO ROUTES, ONE WORLD. `at` stands the browser somewhere other than the
     profile tab — a repo's own page, or anywhere else on github.com — which is
     the only way to exercise the mark and the top-up at all. The content
     scripts are the same six either way; which one acts is decided by the URL,
     which is exactly the thing under test. */
  const at = opts.at || null;                   // e.g. "octo/throttle-kit"
  const url = at
    ? `https://github.com/${at}`
    : `https://github.com/${owner}?tab=repositories`;
  const html = at
    ? repoPage(opts.page || {}, at.split("/")[0], at.split("/")[1])
    : profilePage(owner, opts.repos, opts.page2 ? "/" + owner + "?tab=repositories&page=2" : "");

  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const win = dom.window;

  // What the API returns. A number means "fail with this status".
  const apiFetch = async (url) => {
    if (typeof opts.apiRepos === "number") {
      return { ok: false, status: opts.apiRepos, json: async () => ({}) };
    }
    // Deliberately explicit: read the page number from the LAST page= only.
    const m = url.match(/[?&]page=(\d+)$/);
    const page = m ? Number(m[1]) : 1;
    const authed = url.includes("/user/repos");
    const rows = page > 1 ? [] : (opts.apiRepos || []).filter((r) => authed || !r.private);
    return {
      ok: true,
      status: 200,
      json: async () =>
        rows.map((r) => ({
          full_name: `${owner}/${r.name}`,
          topics: r.topics || [],
          private: !!r.private,
          description: r.description || null,
          language: r.language || null,
          stargazers_count: r.stars == null ? undefined : r.stars,
          forks_count: r.forks == null ? undefined : r.forks,
          license: r.license ? { spdx_id: r.license } : null,
          homepage: r.homepage || null,
          pushed_at: r.updated || null,
          archived: !!r.archived,
          fork: !!r.fork,
        })),
    };
  };

  const post = bootWorker(apiFetch, counters);
  win.chrome = makeChrome(store, (msg, respond) => post(msg, respond));

  // Same-origin fetches made by the content script: extra pages and repo pages.
  win.fetch = async (url) => {
    const u = String(url);
    if (/[?&]page=2/.test(u)) {
      counters.pages.push(u);
      return { ok: true, status: 200, text: async () => profilePage(owner, opts.page2, "") };
    }
    const name = u.replace(/^https?:\/\/github\.com/, "").replace(/^\//, "").toLowerCase();
    const all = (opts.repos || []).concat(opts.page2 || []);
    const hit = all.find((r) => `${owner}/${r.name}`.toLowerCase() === name);
    if (hit) {
      counters.scraped.push(name);
      return { ok: true, status: 200, text: async () => repoPage(hit, owner, hit.name) };
    }
    return { ok: false, status: 404, text: async () => "" };
  };

  for (const rel of CONTENT) {
    const el = win.document.createElement("script");
    el.textContent = fs.readFileSync(path.join(EXT, rel), "utf8");
    win.document.body.appendChild(el);
  }

  return { win, store, counters, dom };
}

/** Reads the rendered shelves back out of the page. */
function readShelves(win) {
  const host = win.document.getElementById("shelves-host");
  if (!host) return null;
  return {
    host,
    note: (host.querySelector(".sh-note") || {}).textContent || "",
    warn: (host.querySelector(".sh-warn") || {}).textContent || "",
    shelves: [...host.querySelectorAll("details.sh-shelf")].map((d) => ({
      label: d.querySelector(".sh-name").textContent,
      count: Number(d.querySelector(".sh-count").textContent),
      repos: [...d.querySelectorAll("li h3 a")].map((a) => a.textContent),
      glyph: (d.querySelector(".sh-glyph") || {}).textContent || "",
      /* READ OFF THE STYLE ATTRIBUTE, not off `d.style`. jsdom's CSS object
         model has not always carried custom properties, and a getter that
         quietly answers "" would turn a real palette bug into a green test. */
      hue: (String(d.getAttribute("style") || "").match(/--sh-hue:\s*(\d+)/) || [])[1] || "",
      plain: d.classList.contains("sh-plain"),
    })),
    hostCount: win.document.querySelectorAll("#shelves-host").length,
    nested: !!host.querySelector("#shelves-host, .sh-shelf .sh-shelf"),
    find: host.querySelector(".sh-find"),
    found: (host.querySelector(".sh-found") || {}).textContent || "",
    // what a reader would actually SEE, after the filter has hidden rows
    visible: [...host.querySelectorAll("details li")]
      .filter((li) => !li.classList.contains("sh-hide"))
      .map((li) => (li.querySelector("h3 a") || {}).textContent),
    notes: Object.fromEntries(
      [...host.querySelectorAll("details li")].map((li) => [
        (li.querySelector("h3 a") || {}).textContent,
        (li.querySelector(".sh-note-text") || {}).textContent || "",
      ])
    ),
    canary: (host.querySelector(".sh-canary") || {}).textContent || "",
    names: [...host.querySelectorAll("details li")].map((li) => li.dataset.shName || ""),
    hay: Object.fromEntries(
      [...host.querySelectorAll("details li")].map((li) => [
        (li.querySelector("h3 a") || {}).textContent,
        li.dataset.shHay || "",
      ])
    ),
  };
}

/** Press the toolbar's `audit` button and read both panel sections back. */
function openVocab(win) {
  const btn = [...win.document.querySelectorAll("#shelves-host .sh-btn")].find((b) =>
    /^audit/.test(b.textContent)
  );
  if (!btn) throw new Error("no audit button in the toolbar");
  const badge = btn.querySelector(".sh-vbadge");
  btn.click();
  const panel = win.document.querySelector("#shelves-host .sh-vocab");
  const read = (root) => ({
    badge: badge ? Number(badge.textContent) : 0,
    open: !!panel && !panel.hidden,
    sum: root ? (root.querySelector(".sh-v-sum") || {}).textContent || "" : "",
    sub: root ? (root.querySelector(".sh-v-sub") || {}).textContent || "" : "",
    /* A finding is its KIND and its whole sentence: the tests assert on which
       claim was made, never on where it happened to be rendered. */
    finds: root
      ? [...root.querySelectorAll(".sh-v-find")].map((f) => ({
          kind: f.dataset.kind,
          tag: (f.querySelector(".sh-v-tag") || {}).textContent || "",
          text: String(f.textContent || "").replace(/\s+/g, " ").trim(),
          terms: [...f.querySelectorAll(".sh-term .sh-term-n")].map((t) => t.textContent),
        }))
      : [],
    terms: root
      ? [...root.querySelectorAll(".sh-v-all .sh-term")].map((b) => ({
          topic: (b.querySelector(".sh-term-n") || {}).textContent || "",
          count: Number((b.querySelector(".sh-term-c") || {}).textContent || 0),
          shelf: b.dataset.shelf === "1",
        }))
      : [],
    caveat: root ? (root.querySelector(".sh-v-caveat") || {}).textContent || "" : "",
    panel,
    btn,
  });
  return read(panel);
}

/** Press an audit finding's SHOW button — the mode that addresses rows by
 *  name, because "the 12 with no description" is not a query. */
function pickGap(win, label) {
  const f = [...win.document.querySelectorAll("#shelves-host .sh-v-find")].find(
    (x) => ((x.querySelector(".sh-v-tag") || {}).textContent || "") === label
  );
  if (!f) throw new Error("no finding labelled " + label);
  const b = f.querySelector('.sh-term[data-pick="1"]');
  if (!b) throw new Error("finding " + label + " has no show button");
  b.click();
  return b;
}

/** Read the chip the repo page wears, or null. */
function readMark(win) {
  const box = win.document.getElementById("shelves-mark");
  if (!box) return null;
  const chip = box.querySelector(".sh-mark-chip");
  return {
    box,
    label: (box.querySelector(".sh-mark-n") || {}).textContent || "",
    glyph: (box.querySelector(".sh-mark-g") || {}).textContent || "",
    count: (box.querySelector(".sh-mark-c") || {}).textContent || "",
    href: chip ? chip.getAttribute("href") : "",
    plain: !!(chip && chip.classList.contains("sh-plain")),
    hue: (String(chip && chip.getAttribute("style") || "").match(/--sh-hue:\s*(\d+)/) || [])[1] || "",
    note: (box.querySelector(".sh-note-text") || {}).textContent || "",
    inSidebar: !!box.closest(".Layout-sidebar"),
    count_: win.document.querySelectorAll("#shelves-mark").length,
  };
}

/** Press a topic chip in the vocabulary panel, as a reader would. */
function pickTerm(win, topic) {
  const b = [...win.document.querySelectorAll("#shelves-host .sh-vocab .sh-term")].find(
    (x) => ((x.querySelector(".sh-term-n") || {}).textContent || "") === topic
  );
  if (!b) throw new Error("no chip for topic " + topic);
  b.click();
  return b;
}

/** Type into the toolbar's filter the way a person does. */
function type(win, text) {
  const el = win.document.querySelector("#shelves-host .sh-find");
  if (!el) throw new Error("no filter box rendered");
  el.value = text;
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
  return el;
}

/** Open one row's note editor, type, and press Enter — no shortcuts through
 *  the module's own internals, so the listeners are what is under test. */
function writeNote(win, repoName, text) {
  const li = [...win.document.querySelectorAll("#shelves-host details li")].find(
    (x) => ((x.querySelector("h3 a") || {}).textContent || "") === repoName
  );
  if (!li) throw new Error("no row for " + repoName);
  const btn = li.querySelector(".sh-note-btn");
  if (!btn) throw new Error("no note affordance on " + repoName);
  btn.click();
  const ta = li.querySelector("textarea.sh-note-edit");
  if (!ta) throw new Error("the editor did not open on " + repoName);
  ta.value = text;
  ta.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  return li;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms || 700));

module.exports = { build, readShelves, settle, type, writeNote, openVocab,
                   pickTerm, pickGap, readMark, profilePage, repoPage };
