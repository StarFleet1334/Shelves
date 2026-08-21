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
const CONTENT = ["src/store.js", "src/dom.js", "src/topics.js", "src/view.js", "src/main.js"];

/* ---- fixtures ---------------------------------------------------------- */

function chip(topic) {
  return `<a class="topic-tag topic-tag-link" href="/topics/${topic}">${topic}</a>`;
}

function row(owner, name, topics) {
  const chips = (topics || []).map(chip).join("");
  return (
    `<li class="col-12 d-flex">` +
    `<h3><a itemprop="name codeRepository" href="/${owner}/${name}">${name}</a></h3>` +
    (chips ? `<div class="topics">${chips}</div>` : "") +
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

/** A repo's own page: topics live in the sidebar. */
function repoPage(topics) {
  return `<!doctype html><html><body>
    <div class="Layout-sidebar">
      <h2>About</h2>${(topics || []).map(chip).join("")}
    </div>
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
    local: { token: opts.token || "", topicCache: opts.cache || {} },
  };
  const counters = { api: 0, lastAuth: false, pages: [], scraped: [] };

  const html = profilePage(owner, opts.repos, opts.page2 ? "/" + owner + "?tab=repositories&page=2" : "");

  const dom = new JSDOM(html, {
    url: `https://github.com/${owner}?tab=repositories`,
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
      return { ok: true, status: 200, text: async () => repoPage(hit.topics || []) };
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
    })),
    hostCount: win.document.querySelectorAll("#shelves-host").length,
    nested: !!host.querySelector("#shelves-host, .sh-shelf .sh-shelf"),
  };
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms || 700));

module.exports = { build, readShelves, settle, profilePage, repoPage };
