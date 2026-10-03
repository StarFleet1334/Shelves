/* SHELVES — tests/lifecycle-e2e.js
 *
 *   node tests/lifecycle-e2e.js
 *
 * A REAL BROWSER, BECAUSE THE CLAIM IS ABOUT A REAL BROWSER. topics.js says a
 * cold rung-4 pass writes as it goes — every ten reads, on visibilitychange to
 * hidden, on `freeze`, on `pagehide`, and after every single read once hidden
 * — so the records a reader paid for survive the tab dying. jsdom can fire
 * those events, but it cannot say whether a chrome.storage write ISSUED from
 * inside them actually lands before the renderer freezes or goes away. Only a
 * browser can, so this drives one: Edge headless, the unpacked extension, and
 * a fake github.com served through CDP.
 *
 * EDGE, NOT CHROME. Chrome-branded builds ignore --load-extension now; the
 * content script silently never starts and every case "fails" for a reason
 * that has nothing to do with the code under test.
 *
 * GITHUB IS NEVER TOUCHED. Every request to github.com and api.github.com is
 * answered by `Fetch.requestPaused` on the target that made it (pages AND the
 * service worker, auto-attached as they appear). And as a backstop the
 * browser is started with every hostname resolving to nothing, so a request
 * the interception somehow missed fails loudly instead of reaching GitHub
 * with this profile.
 *
 * THE USER'S BROWSER IS NEVER TOUCHED EITHER. A fresh --user-data-dir in the
 * scratchpad, and the only process killed is the one this script started.
 *
 * Storage is read from the extension's own service worker — the content
 * script's isolated world is not reachable over CDP, and the SW is the same
 * chrome.storage.local the content script wrote to, so it is the honest
 * witness anyway.
 */
"use strict";

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const http = require("http");

/* WS FROM tests/node_modules IF IT IS THERE, NODE'S OWN IF NOT. Both speak
 * the same four calls this file uses, so neither is a new dependency. */
let WS;
try { WS = require("ws"); } catch (e) { WS = globalThis.WebSocket; }

const { profilePage, repoPage } = require("./world");

const EXT = path.resolve(__dirname, "..", "extension");
const EDGE = process.env.SHELVES_EDGE ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SCRATCH = process.env.SHELVES_SCRATCH ||
  "C:\\Users\\User\\AppData\\Local\\Temp\\claude\\C--Users-User-Desktop-secret-aether\\" +
  "c5176e3e-93e3-40e3-81f8-5544ab8ac867\\scratchpad";

const OWNER = "octo";
const N_REPOS = 40;
const DELAY = 300;                 // ms each repo page is held before it is answered
const PROFILE_URL = `https://github.com/${OWNER}?tab=repositories`;
const names = Array.from({ length: N_REPOS }, (_, i) => "r" + String(i + 1).padStart(2, "0"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/* ---- the fake GitHub --------------------------------------------------- */

/* FORTY PRIVATE REPOS AND NOT ONE CHIP. Rung 1 answers nothing, the API
 * answers `[]` (it cannot see private repos without a token), so all forty
 * fall through to rung 4 — the pass under test. Signed in as the owner, or
 * isMine() would narrow the ladder to the free rungs and never scrape. */
const PROFILE_HTML = profilePage(OWNER, names.map((n) => ({ name: n })), null, OWNER, "in");
const repoHtml = (n) => repoPage({ topics: ["lifecycle", "t-" + n], description: "repo " + n,
                                   viewer: OWNER, signedInNoMeta: false }, OWNER, n);

/* ---- a minimal flat-session CDP client --------------------------------- */

function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    let id = 0;
    const pending = new Map();
    const listeners = [];
    const onMsg = (raw) => {
      const m = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(new Error(p.method + ": " + m.error.message)) : p.resolve(m.result);
      } else if (m.method) {
        listeners.forEach((fn) => { try { fn(m); } catch (e) { log("listener threw", e); } });
      }
    };
    const client = {
      /* EVERY CALL HAS A TIMEOUT. A frozen page answers nothing, and a
       * harness that awaits it forever reports a hang instead of a result. */
      send(method, params, sessionId, timeout) {
        const mid = ++id;
        const msg = { id: mid, method, params: params || {} };
        if (sessionId) msg.sessionId = sessionId;
        return new Promise((res, rej) => {
          const t = setTimeout(() => {
            pending.delete(mid);
            rej(new Error(method + ": timed out"));
          }, timeout || 15000);
          pending.set(mid, {
            method,
            resolve: (v) => { clearTimeout(t); res(v); },
            reject: (e) => { clearTimeout(t); rej(e); },
          });
          ws.send(JSON.stringify(msg));
        });
      },
      on(fn) { listeners.push(fn); },
      close() { try { ws.close(); } catch (e) { /* already gone */ } },
    };
    if (ws.on) {
      ws.on("open", () => resolve(client));
      ws.on("message", onMsg);
      ws.on("error", reject);
    } else {
      ws.onopen = () => resolve(client);
      ws.onmessage = (e) => onMsg(e.data);
      ws.onerror = reject;
    }
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

async function waitFor(fn, timeout, label) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(100);
  }
  throw new Error("timed out waiting for " + label + (last instanceof Error ? " (" + last.message + ")" : ""));
}

/* ---- the run ----------------------------------------------------------- */

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  log((pass ? "  PASS " : "  FAIL ") + name + " — " + detail);
}

async function main() {
  let n = 1;
  while (fs.existsSync(path.join(SCRATCH, "edge-profile-" + n))) n++;
  const profile = path.join(SCRATCH, "edge-profile-" + n);
  fs.mkdirSync(profile, { recursive: true });
  const port = await freePort();

  const args = [
    "--headless=new",
    "--remote-debugging-port=" + port,
    "--load-extension=" + EXT,
    "--disable-extensions-except=" + EXT,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--user-data-dir=" + profile,
    /* THE BACKSTOP. Interception answers before DNS is ever consulted, so
     * this changes nothing for a request we catch — and turns one we did not
     * catch into an error instead of a visit to the real GitHub. */
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "about:blank",
  ];
  log("edge profile: " + profile + "  port " + port);
  const edge = spawn(EDGE, args, { stdio: "ignore", windowsHide: true });
  edgePid = edge.pid;
  let browser;

  try {
    const ver = await waitFor(() => getJson(`http://127.0.0.1:${port}/json/version`), 20000, "devtools endpoint");
    browser = await cdp(ver.webSocketDebuggerUrl);
    log("browser: " + ver.Browser);

    /* ---- routing: one table for every attached target ---------------- */
    const sessions = new Map();          // sessionId -> targetInfo
    let swSession = null;
    const stray = [];
    const api = { hits: 0 };
    let gate = null;                     // the current case's repo-page policy

    const body64 = (s) => Buffer.from(s, "utf8").toString("base64");
    const fulfil = (sid, requestId, status, body, type) =>
      browser.send("Fetch.fulfillRequest", {
        requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: type },
                          { name: "Access-Control-Allow-Origin", value: "*" }],
        body: body64(body),
      }, sid).catch(() => { /* the target died with the request — that is a case, not an error */ });

    function newGate(budget) {
      return { budget, served: [], held: [], arrivals: 0, pendingServe: 0 };
    }
    function serve(g, req) {
      g.pendingServe++;
      setTimeout(async () => {
        await fulfil(req.sid, req.requestId, 200, repoHtml(req.name), "text/html; charset=utf-8");
        g.pendingServe--;
        g.served.push(req.name);
      }, DELAY);
    }
    function release(g, k) {
      g.budget += k;
      while (g.held.length && g.served.length + g.pendingServe < g.budget) serve(g, g.held.shift());
    }

    browser.on((m) => {
      if (m.method === "Target.attachedToTarget") {
        const { sessionId, targetInfo, waitingForDebugger } = m.params;
        sessions.set(sessionId, targetInfo);
        const ours = targetInfo.type === "page" ||
          (targetInfo.type === "service_worker" && /\/background\.js$/.test(targetInfo.url));
        (async () => {
          if (ours) {
            await browser.send("Fetch.enable", { patterns: [
              { urlPattern: "https://github.com/*" },
              { urlPattern: "https://api.github.com/*" },
            ] }, sessionId).catch((e) => log("Fetch.enable failed on " + targetInfo.type, e.message));
            if (targetInfo.type === "service_worker") swSession = sessionId;
          }
          if (waitingForDebugger) {
            await browser.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
          }
        })();
      } else if (m.method === "Target.detachedFromTarget") {
        if (m.params.sessionId === swSession) swSession = null;
        sessions.delete(m.params.sessionId);
      } else if (m.method === "Fetch.requestPaused") {
        const sid = m.sessionId;
        const { requestId, request } = m.params;
        const u = new URL(request.url);
        if (u.hostname === "api.github.com") {
          api.hits++;
          fulfil(sid, requestId, 200, "[]", "application/json; charset=utf-8");
        } else if (u.pathname === "/" + OWNER && u.searchParams.get("tab") === "repositories") {
          fulfil(sid, requestId, 200, PROFILE_HTML, "text/html; charset=utf-8");
        } else if (/^\/octo\/r\d\d$/.test(u.pathname) && gate) {
          const req = { sid, requestId, name: u.pathname.slice(1) };
          gate.arrivals++;
          if (gate.served.length + gate.pendingServe < gate.budget) serve(gate, req);
          else gate.held.push(req);   // HELD: never answered unless released
        } else {
          stray.push(request.url);
          fulfil(sid, requestId, 404, "not in this world", "text/plain");
        }
      }
    });

    await browser.send("Target.setDiscoverTargets", { discover: true });
    await browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

    /* THE WORKER MAY HAVE STARTED BEFORE WE CONNECTED; auto-attach covers new
     * targets, so attach to an existing one by hand. */
    const findSw = async () => {
      const { targetInfos } = await browser.send("Target.getTargets");
      return targetInfos.find((t) => t.type === "service_worker" && /^chrome-extension:\/\/.*\/background\.js$/.test(t.url));
    };
    const swInfo = await waitFor(findSw, 15000, "extension service worker");
    const extId = new URL(swInfo.url).host;
    log("extension id: " + extId);
    if (!swSession) {
      const { sessionId } = await browser.send("Target.attachToTarget", { targetId: swInfo.targetId, flatten: true });
      swSession = sessionId;
      await browser.send("Fetch.enable", { patterns: [{ urlPattern: "https://api.github.com/*" }] }, sessionId).catch(() => {});
    }

    async function swEval(expr) {
      const sid = await waitFor(async () => {
        if (swSession) return swSession;
        const t = await findSw();            // the worker idled out: wake and re-attach
        if (t) { const r = await browser.send("Target.attachToTarget", { targetId: t.targetId, flatten: true }); return r.sessionId; }
        return null;
      }, 10000, "service worker session");
      const r = await browser.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      if (r.exceptionDetails) throw new Error("sw eval: " + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
      return r.result.value;
    }
    const stored = () => swEval("chrome.storage.local.get('repoFacts').then(r => Object.keys(r.repoFacts || {}).sort())");
    const clearStore = () => swEval("chrome.storage.local.remove(['repoFacts','topicCache']).then(() => true)");

    async function pageEval(sid, expr, timeout) {
      const r = await browser.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sid, timeout || 5000);
      return r.result.value;
    }

    /* EVERY CASE GETS A FRESH TAB, a cleared store, and a recorder in the
     * page's main world. The recorder cannot see the content script's
     * handlers, but the EVENTS are the document's, so it does see which
     * lifecycle events actually fired. */
    async function openTab(budget) {
      await clearStore();
      gate = newGate(budget);
      const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
      const sid = await waitFor(() => {
        for (const [s, t] of sessions) if (t.targetId === targetId) return s;
        return null;
      }, 5000, "page session");
      await browser.send("Page.enable", {}, sid);
      await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `
        window.__lc = [];
        ["visibilitychange","freeze","resume"].forEach(t => document.addEventListener(t,
          () => window.__lc.push(t + ":" + document.visibilityState), true));
        ["pagehide","pageshow"].forEach(t => window.addEventListener(t, () => window.__lc.push(t), true));
      ` }, sid);
      await browser.send("Page.navigate", { url: PROFILE_URL }, sid);
      return { targetId, sid };
    }

    const servedAtLeast = (k) => waitFor(() => gate.served.length >= k, 20000, k + " repo pages served");
    /* A SERVED PAGE IS NOT YET A READ RECORD: the content script still has to
     * read the body and parse it. Half a second is generous for one parse. */
    const PARSE = 600;

    /* THE HIDE. Headless has no window to minimise for a person, so each way
     * of hiding a tab is tried in turn and the one that genuinely made
     * document.visibilityState === "hidden" is named in the report. */
    async function hide(tab) {
      const tried = [];
      const isHidden = async () => (await pageEval(tab.sid, "document.visibilityState")) === "hidden";

      // 1. another tab in front of it, activated
      const front = await browser.send("Target.createTarget", { url: "about:blank" });
      await browser.send("Target.activateTarget", { targetId: front.targetId }).catch(() => {});
      try { await waitFor(isHidden, 2000, "hidden"); return { how: "new tab created + Target.activateTarget", front: front.targetId, tried }; }
      catch (e) { tried.push("new tab in front: still visible"); }

      // 2. minimise the tab's window
      try {
        const { windowId } = await browser.send("Browser.getWindowForTarget", { targetId: tab.targetId });
        await browser.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
        await waitFor(isHidden, 2000, "hidden");
        return { how: "Browser.setWindowBounds minimized", front: front.targetId, tried };
      } catch (e) { tried.push("minimise window: " + e.message); }

      // 3. a new window in front
      try {
        const w = await browser.send("Target.createTarget", { url: "about:blank", newWindow: true });
        await browser.send("Target.activateTarget", { targetId: w.targetId });
        await waitFor(isHidden, 2000, "hidden");
        return { how: "new window + activateTarget", front: w.targetId, tried };
      } catch (e) { tried.push("new window: " + e.message); }

      return { how: null, front: front.targetId, tried };
    }
    const closeQuiet = (targetId) => browser.send("Target.closeTarget", { targetId }).catch(() => {});

    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const want = (served) => served.map((s) => s.toLowerCase()).sort();

    /* ── CASE 1 — BASELINE, THE PERIODIC FLUSH ──────────────────────────── */
    log("\ncase 1: periodic flush (15 reads, tab open)");
    {
      const tab = await openTab(15);
      await servedAtLeast(15);
      await sleep(PARSE);
      const vis = await pageEval(tab.sid, "document.visibilityState");
      const got = await waitFor(async () => { const s = await stored(); return s.length >= 10 && s; }, 5000, ">=10 stored").catch(() => null) || await stored();
      const extra = got.filter((k) => !want(gate.served).includes(k));
      record("1 BASELINE periodic", got.length >= 10 && !extra.length,
        `visibility=${vis}, served ${gate.served.length}, held ${gate.held.length}, stored ${got.length} (expect >=10, a multiple-of-10 flush); ` +
        `api hits so far ${api.hits}`);
      await closeQuiet(tab.targetId);
      await sleep(500);
    }

    /* ── CASE 2 — A REAL CLOSE, BELOW THE FLUSH LINE ────────────────────── */
    log("\ncase 2: close the tab with 6 reads unsaved");
    {
      const tab = await openTab(6);
      await servedAtLeast(6);
      await sleep(PARSE);
      const vis = await pageEval(tab.sid, "document.visibilityState");
      const before = await stored();
      const lc = await pageEval(tab.sid, "window.__lc.join(',')");
      await browser.send("Target.closeTarget", { targetId: tab.targetId });
      const got = await waitFor(async () => { const s = await stored(); return s.length >= 6 && s; }, 5000, "6 stored").catch(() => null) || await stored();
      record("2 CLOSE (pagehide)", before.length === 0 && same(got, want(gate.served)),
        `visibility=${vis}, before close stored ${before.length} (expect 0 — below FLUSH_EVERY), ` +
        `after Target.closeTarget stored ${got.length} of ${gate.served.length} read (expect 6); lifecycle before close: [${lc}]`);
      await sleep(300);
    }

    /* ── CASE 3 — HIDDEN, THEN PER-READ, THEN FROZEN ───────────────────── */
    log("\ncase 3: hide with 4 unsaved, 3 more while hidden, then freeze");
    let hideHow = null;
    {
      const tab = await openTab(4);
      await servedAtLeast(4);
      await sleep(PARSE);
      const before = await stored();
      const h = await hide(tab);
      hideHow = h;
      const vis = await pageEval(tab.sid, "document.visibilityState");
      log("    hidden by: " + (h.how || "NOTHING") + (h.tried.length ? "  (tried: " + h.tried.join("; ") + ")" : ""));
      if (vis !== "hidden") {
        record("3a HIDDEN flush", false, "could not make the tab hidden headless: " + h.tried.join("; "));
      } else {
        const atHide = await waitFor(async () => { const s = await stored(); return s.length >= 4 && s; }, 5000, "4 stored").catch(() => null) || await stored();
        record("3a HIDDEN flush (visibilitychange)", before.length === 0 && atHide.length === 4,
          `before hide stored ${before.length} (expect 0), after hide stored ${atHide.length} (expect 4)`);

        /* ONE AT A TIME, so "per read" is measured and not inferred: each
         * release must move the store by exactly one before the next. */
        const steps = [];
        for (let i = 1; i <= 3; i++) {
          release(gate, 1);
          await servedAtLeast(4 + i);
          const s = await waitFor(async () => { const s = await stored(); return s.length >= 4 + i && s; }, 5000, (4 + i) + " stored").catch(() => null) || await stored();
          steps.push(s.length);
        }
        record("3b PER-READ while hidden", same(steps, [5, 6, 7]),
          `stored after each hidden read: [${steps.join(", ")}] (expect [5, 6, 7])`);

        let froze = "ok";
        try { await browser.send("Page.setWebLifecycleState", { state: "frozen" }, tab.sid); }
        catch (e) { froze = e.message; }
        await sleep(500);
        const afterFreeze = await stored();
        await browser.send("Page.setWebLifecycleState", { state: "active" }, tab.sid).catch(() => {});
        await sleep(200);
        const lc = await pageEval(tab.sid, "window.__lc.join(',')").catch((e) => "unreadable: " + e.message);
        record("3c FROZEN keeps them", froze === "ok" && afterFreeze.length === 7 && same(afterFreeze, want(gate.served)),
          `Page.setWebLifecycleState frozen: ${froze}; stored after freeze ${afterFreeze.length} (expect 7); lifecycle seen: [${lc}]`);
      }
      await closeQuiet(tab.targetId);
      if (h.front) await closeQuiet(h.front);
      await sleep(500);
    }

    /* ── CASE 3d — FREEZE ALONE, ON A VISIBLE PAGE ──────────────────────── *
     * Hidden always precedes frozen in a real browser, so by the time freeze
     * fires the visibilitychange write has already taken everything. This
     * asks whether the `freeze` handler ALONE would have saved them — if the
     * browser will freeze a visible page at all. */
    log("\ncase 3d: freeze a VISIBLE tab with 4 unsaved (can freeze be isolated?)");
    {
      const tab = await openTab(4);
      await servedAtLeast(4);
      await sleep(PARSE);
      const before = await stored();
      let froze = "ok";
      try { await browser.send("Page.setWebLifecycleState", { state: "frozen" }, tab.sid); }
      catch (e) { froze = e.message; }
      await sleep(500);
      const after = await stored();
      await browser.send("Page.setWebLifecycleState", { state: "active" }, tab.sid).catch(() => {});
      await sleep(200);
      const lc = await pageEval(tab.sid, "window.__lc.join(',')").catch((e) => "unreadable: " + e.message);
      if (froze !== "ok") {
        record("3d FREEZE alone (visible)", true, `not testable: the browser refused to freeze a visible page (${froze}) — n/a, not a failure`);
      } else {
        /* SAID PLAINLY IF IT WAS NOT ALONE. Chromium hides a page before it
         * freezes it even when asked over CDP, so visibilitychange may have
         * made this write and `freeze` found nothing left to do. The records
         * still landed — but that is case 3a again, not proof of the freeze
         * handler, and the line says which it was. */
        const isolated = !/visibilitychange:hidden/.test(lc);
        record("3d FREEZE (visible start)", before.length === 0 && after.length === 4,
          `before freeze stored ${before.length} (expect 0), after freeze stored ${after.length} (expect 4); lifecycle seen: [${lc}] — ` +
          (isolated ? "freeze handler ALONE made this write"
                    : "NOT isolated: Chromium fired visibilitychange:hidden before freeze, so the hidden handler may have written first"));
      }
      await closeQuiet(tab.targetId);
      await sleep(500);
    }

    /* ── CASE 4 — A REAL DISCARD ───────────────────────────────────────── *
     * chrome.tabs.discard needs no "tabs" permission; the host permission on
     * github.com is what lets the worker see the tab's url to find it. */
    log("\ncase 4: 3 reads visible, hide, 2 reads hidden, then chrome.tabs.discard");
    {
      const tab = await openTab(3);
      await servedAtLeast(3);
      await sleep(PARSE);
      const before = await stored();
      const h = await hide(tab);
      const vis = await pageEval(tab.sid, "document.visibilityState");
      release(gate, 2);
      await servedAtLeast(5);
      await sleep(PARSE);
      const preDiscard = await stored();
      const tabs = await swEval(`chrome.tabs.query({}).then(ts => ts.map(t => ({id:t.id, url:t.url||'', active:t.active, discarded:t.discarded})))`);
      const mine = tabs.filter((t) => t.url.startsWith("https://github.com/" + OWNER));
      let discard = "no github tab found in chrome.tabs.query";
      if (mine.length === 1) {
        discard = await swEval(`chrome.tabs.discard(${mine[0].id}).then(t => t ? 'discarded=' + t.discarded + ' newId=' + t.id : 'returned undefined', e => 'rejected: ' + e.message)`);
      }
      await sleep(800);
      const after = await stored();
      const tabsAfter = await swEval(`chrome.tabs.query({}).then(ts => ts.filter(t => (t.url||'').startsWith('https://github.com/')).map(t => t.id + ':' + (t.discarded ? 'discarded' : 'live')).join(','))`);
      const ok = /discarded=true/.test(discard);
      record("4 DISCARD", vis === "hidden" && ok && before.length === 0 && preDiscard.length === 5 && same(after, want(gate.served)),
        `hidden by ${h.how || "nothing"} (visibility=${vis}); before hide stored ${before.length} (expect 0), ` +
        `before discard stored ${preDiscard.length} (expect 5), tabs.discard: ${discard}, ` +
        `after discard stored ${after.length} of ${gate.served.length} read (expect 5); github tabs after: [${tabsAfter}]`);
      await closeQuiet(tab.targetId);
      if (h.front) await closeQuiet(h.front);
      // the discarded tab may have a new target id; close any github tab left
      const { targetInfos } = await browser.send("Target.getTargets");
      for (const t of targetInfos) if (t.type === "page" && t.url.startsWith("https://github.com/")) await closeQuiet(t.targetId);
    }

    log("\napi.github.com answered from fixtures: " + api.hits + " request(s)");
    if (stray.length) log("stray github requests answered 404: " + [...new Set(stray)].join(", "));
    log("hiding achieved by: " + (hideHow && hideHow.how || "nothing"));
  } finally {
    if (browser) browser.close();
    /* KILL WHAT WE STARTED, AND ONLY THAT. /T takes Edge's renderer and GPU
     * children with it, rooted at the one pid this script spawned. */
    killEdge();
  }
}

let edgePid = 0;
function killEdge() {
  if (!edgePid) return;
  try { execFileSync("taskkill", ["/PID", String(edgePid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
  catch (e) { /* already exited */ }
  edgePid = 0;
}
/* THE WATCHDOG KILLS EDGE TOO. process.exit skips every finally, so a hang
 * that only exited would leave a headless browser running nobody can see. */
const watchdog = setTimeout(() => { log("WATCHDOG: run exceeded 180s"); killEdge(); process.exit(2); }, 180000);
main().then(() => {
  clearTimeout(watchdog);
  const bad = results.filter((r) => !r.pass);
  log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
}, (e) => {
  clearTimeout(watchdog);
  log("\nHARNESS ERROR: " + (e && e.stack || e));
  process.exit(2);
});
