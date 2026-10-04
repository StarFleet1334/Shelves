/* SHELVES — tests/options-world.js
 *
 * The options page, in jsdom, against a chrome.storage that can say no.
 *
 * world.js builds a GitHub tab; this builds the OTHER page — options.html with
 * the scripts it names, in the order it names them, run during the parse the
 * way a browser runs them, so DOMContentLoaded fires on its own and the page
 * wires itself exactly once. The <script src> list is read from the HTML, not
 * retyped here, for the reason world.js reads the manifest: a second list is a
 * list that drifts.
 *
 * THE STUB IS SHAPED LIKE CHROME WHERE IT MATTERS FOR A FAILED WRITE:
 *   - callbacks are asynchronous (never inside the call that asked);
 *   - `chrome.runtime.lastError` exists ONLY while a failing callback runs and
 *     is cleared after it returns — a page that looks for it anywhere else
 *     sees nothing, as it would in Chrome;
 *   - with no callback, get/set return a Promise that REJECTS on failure;
 *   - sync enforces the real QUOTA_BYTES_PER_ITEM (8192: UTF-8 bytes of
 *     JSON.stringify(value) plus the key's length), so an oversize item fails
 *     with Chrome's own message even when nothing was injected.
 *
 * Faults: `w.sync.failNext("set", msg)`, `w.sync.failAlways("get", msg)`,
 * `w.sync.heal()`. A "set" fault also covers remove() and clear(), because
 * "the write failed" is the question and which verb wrote is the page's
 * business. `w.writes` logs every write attempt, failed or not, in order.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

/* SHELVES_EXT points the world at another copy of the extension — how a
   before/after proof runs these scenarios against `git archive HEAD`. */
const EXT = process.env.SHELVES_EXT || path.join(__dirname, "..", "extension");
const PAGE = path.join(EXT, "options.html");

const PER_ITEM = 8192;
const QUOTA_MSG = "QUOTA_BYTES_PER_ITEM quota exceeded";

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Chrome's own measure of one sync item. */
function itemBytes(key, value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8") + String(key).length;
}

function makeArea(name, seed, runtime, log, opts) {
  const data = clone(seed || {});
  const faults = { get: null, set: null };
  const area = {
    data,
    delay: 0,          // ms before a set/remove/clear callback fires
    getDelay: 0,
    failNext(op, msg) { faults[op] = { msg: String(msg), once: true }; },
    failAlways(op, msg) { faults[op] = { msg: String(msg), once: false }; },
    heal() { faults.get = null; faults.set = null; },
  };

  function fault(op) {
    const f = faults[op];
    if (!f) return null;
    if (f.once) faults[op] = null;
    return f.msg;
  }

  /* One answer, delivered the way Chrome delivers it: async, lastError set
     only for the duration of the callback, a rejection in Promise mode. */
  function answer(cb, err, value, delay) {
    const deliver = () => {
      if (cb) runtime._call(cb, err, value);
    };
    if (cb) {
      setTimeout(deliver, delay || 0);
      return undefined;
    }
    return new Promise((resolve, reject) => {
      setTimeout(() => (err ? reject(new Error(err)) : resolve(value)), delay || 0);
    });
  }

  area.api = {
    get(keys, cb) {
      if (typeof keys === "function") { cb = keys; keys = null; }
      const err = fault("get");
      let out = {};
      if (!err) {
        if (keys == null) out = clone(data);
        else if (typeof keys === "string") { if (keys in data) out[keys] = clone(data[keys]); }
        else if (Array.isArray(keys)) keys.forEach((k) => { if (k in data) out[k] = clone(data[k]); });
        else Object.keys(keys).forEach((k) => {
          out[k] = k in data ? clone(data[k]) : clone(keys[k]);
        });
      }
      return answer(cb, err, err ? undefined : out, area.getDelay);
    },
    set(obj, cb) {
      const entry = { area: name, op: "set", value: clone(obj), ok: false, error: null };
      log.push(entry);
      let err = fault("set");
      if (!err && opts.perItem) {
        const big = Object.keys(obj).find((k) => itemBytes(k, obj[k]) > opts.perItem);
        if (big) err = QUOTA_MSG;
      }
      if (!err) Object.assign(data, clone(obj));
      entry.ok = !err;
      entry.error = err;
      return answer(cb, err, undefined, area.delay);
    },
    remove(keys, cb) {
      const list = Array.isArray(keys) ? keys : [keys];
      const err = fault("set");
      log.push({ area: name, op: "remove", value: list.slice(), ok: !err, error: err });
      if (!err) list.forEach((k) => delete data[k]);
      return answer(cb, err, undefined, area.delay);
    },
    clear(cb) {
      const err = fault("set");
      log.push({ area: name, op: "clear", value: null, ok: !err, error: err });
      if (!err) Object.keys(data).forEach((k) => delete data[k]);
      return answer(cb, err, undefined, area.delay);
    },
  };
  return area;
}

function makeRuntime() {
  let current;       // the lastError of the callback running now, if any
  let read = false;
  const rt = {
    unchecked: [],   // failures whose callback never looked at lastError
    thrown: [],      // exceptions the page's own callbacks threw
    _call(cb, err, value) {
      current = err ? { message: err } : undefined;
      read = false;
      try {
        cb(value);
      } catch (e) {
        /* A PAGE ERROR, NOT A HARNESS CRASH: in Chrome a throw inside a
           storage callback lands in the page's console and the page carries
           on, so here it is recorded and the run carries on too. */
        rt.thrown.push(String(e && e.message || e));
      } finally {
        if (err && !read) rt.unchecked.push(err);
        current = undefined;
      }
    },
  };
  rt.api = {
    id: "shelvestestid",
    get lastError() { read = true; return current; },
    getURL: (p) => "chrome-extension://shelvestestid/" + String(p || "").replace(/^\//, ""),
    sendMessage() {},
    onMessage: { addListener() {}, removeListener() {} },
  };
  return rt;
}

/**
 * build(opts) → world
 *   sync, local   seeds for the two areas
 *   arm(w)        runs BEFORE the page's scripts, for faults on load()
 *   perItem       sync's per-item quota (default 8192; 0 turns it off)
 */
function build(opts) {
  opts = opts || {};
  const runtime = makeRuntime();
  const writes = [];
  const perItem = opts.perItem === undefined ? PER_ITEM : opts.perItem;
  const sync = makeArea("sync", opts.sync, runtime, writes, { perItem });
  const local = makeArea("local", opts.local, runtime, writes, {});
  const listen = { addListener() {}, removeListener() {}, hasListener() { return false; } };
  const chrome = {
    runtime: runtime.api,
    storage: {
      sync: Object.assign(sync.api, { QUOTA_BYTES_PER_ITEM: PER_ITEM, onChanged: listen }),
      local: Object.assign(local.api, { onChanged: listen }),
      onChanged: listen,
    },
  };

  const w = { sync, local, writes, runtime, chrome, errors: [], said: [] };
  if (opts.arm) opts.arm(w);

  /* The page's scripts, inlined where the page puts them. */
  let html = fs.readFileSync(PAGE, "utf8");
  html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (m, src) => {
    const body = fs.readFileSync(path.join(EXT, src), "utf8");
    return "<script>" + body.replace(/<\/script/gi, "<\\/script") + "</script>";
  });

  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => w.errors.push(String(e && (e.message || e))));
  const dom = new JSDOM(html, {
    url: "chrome-extension://shelvestestid/options.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      win.chrome = chrome;
    },
  });
  w.dom = dom;
  w.win = dom.window;
  w.doc = dom.window.document;

  /* Every text #saved ever showed, so a scenario can say "never". */
  const el = w.doc.getElementById("saved");
  if (el) {
    const note = () => {
      const t = el.textContent;
      if (w.said[w.said.length - 1] !== t) w.said.push(t);
    };
    new w.win.MutationObserver(note).observe(el, {
      childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ["data-state"],
    });
  }
  return w;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The status line, as the reader sees it. */
function status(w) {
  const el = w.doc.getElementById("saved");
  return { text: (el.textContent || "").trim(), state: el.getAttribute("data-state") };
}

/** The shelves in the editor, top to bottom. */
function shelves(w) {
  return [...w.doc.querySelectorAll("#groups input[type=text]")].map((i) => i.value);
}

function click(w, sel) {
  w.doc.querySelector(sel).dispatchEvent(new w.win.MouseEvent("click", { bubbles: true }));
}

function ctrlS(w) {
  w.doc.dispatchEvent(new w.win.KeyboardEvent("keydown", {
    key: "s", ctrlKey: true, bubbles: true, cancelable: true,
  }));
}

/** Types each name into the add box and presses Add, as a reader does. */
function addShelves(w, names) {
  const field = w.doc.getElementById("newGroup");
  for (const n of names) {
    field.value = n;
    click(w, "#add");
  }
}

function setToken(w, t) { w.doc.getElementById("token").value = t; }

const syncSets = (w) => w.writes.filter((x) => x.area === "sync" && x.op === "set");
const localWrites = (w) => w.writes.filter((x) => x.area === "local");

module.exports = { build, wait, status, shelves, click, ctrlS, addShelves, setToken,
                   syncSets, localWrites, itemBytes, PER_ITEM, QUOTA_MSG };
