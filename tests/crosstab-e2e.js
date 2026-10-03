/* SHELVES — tests/crosstab-e2e.js
 *
 *   node tests/crosstab-e2e.js            fixed tree AND the unfixed HEAD copy
 *   node tests/crosstab-e2e.js --fixed    the working tree only
 *
 * THE BUG IS BETWEEN TWO TABS, SO THE TEST NEEDS TWO TABS. The background
 * top-up (warm.js, any github.com page that is not the profile tab) and a cold
 * profile pass (topics.js) both did a whole-object read-modify-write of
 * chrome.storage.local `repoFacts`. Whichever wrote last erased the other's
 * records. jsdom has one window and one fake storage; it cannot say whether
 * `navigator.locks` in a content script's isolated world is the SAME lock in
 * another tab, nor whether two real renderers interleave their writes the way
 * the bug says. So this drives real Edge, exactly as lifecycle-e2e.js does —
 * the CDP client, the routing table and the kill discipline are copied from
 * there (that file runs on require, so it cannot be imported).
 *
 * AND IT RUNS THE RACE AGAINST THE OLD CODE TOO. A race test that passes on
 * the fixed tree proves nothing until it is seen to FAIL on the tree without
 * the fix. `git archive HEAD extension` (HEAD = before the fix) is unpacked
 * into the scratchpad and loaded into a second, separate Edge.
 *
 * GITHUB IS NEVER TOUCHED: every github.com / api.github.com request is
 * answered by Fetch.requestPaused, and the host resolver maps every name to
 * nothing as a backstop. THE USER'S BROWSER IS NEVER TOUCHED: a fresh
 * --user-data-dir per run, and the only process tree killed is the one this
 * script spawned.
 *
 * Exit: 0 pass, 1 a case failed, 2 the harness itself broke.
 */
"use strict";

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const http = require("http");

let WS;
try { WS = require("ws"); } catch (e) { WS = globalThis.WebSocket; }

const { profilePage, repoPage } = require("./world");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const EDGE = process.env.SHELVES_EDGE ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SCRATCH = process.env.SHELVES_SCRATCH ||
  "C:\\Users\\User\\AppData\\Local\\Temp\\claude\\C--Users-User-Desktop-secret-aether\\" +
  "c5176e3e-93e3-40e3-81f8-5544ab8ac867\\scratchpad";
const TAR = "C:\\Windows\\System32\\tar.exe";

const OWNER = "octo";
const N_MINE = 30;                 // A's private repos, none cached: a cold pass
const N_STALE = 15;                // B's stale records, NOT on the profile
const DELAY_A = 250;               // ms each profile-pass repo page is held
const DELAY_W = 20;                // the top-up's pages are answered fast
const PROFILE_URL = `https://github.com/${OWNER}?tab=repositories`;
const B_URL = `https://github.com/${OWNER}/w00`;
const rNames = Array.from({ length: N_MINE }, (_, i) => "r" + String(i).padStart(2, "0"));
const wNames = Array.from({ length: N_STALE }, (_, i) => "w" + String(i).padStart(2, "0"));
const DAY = 86400000;

const FIXED_ONLY = process.argv.includes("--fixed");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/* SIGNED IN AS THE OWNER, OR NEITHER SIDE RUNS. isMine() narrows a stranger's
 * profile to the free rungs (no rung 4), and warm.js stands down signed out. */
const PROFILE_HTML = profilePage(OWNER, rNames.map((n) => ({ name: n })), null, OWNER, "in");
const repoHtml = (n) => repoPage({ topics: ["crosstab", "t-" + n], description: "repo " + n,
                                   viewer: OWNER, signedInNoMeta: false }, OWNER, n);

/* ---- CDP plumbing, copied from lifecycle-e2e.js ------------------------- */

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
      send(method, params, sessionId, timeout) {
        const mid = ++id;
        const msg = { id: mid, method, params: params || {} };
        if (sessionId) msg.sessionId = sessionId;
        return new Promise((res, rej) => {
          const t = setTimeout(() => { pending.delete(mid); rej(new Error(method + ": timed out")); }, timeout || 15000);
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
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
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

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  log((pass ? "  PASS " : "  FAIL ") + name + " — " + detail);
}

/* ---- the unfixed copy --------------------------------------------------- */

/* HEAD IS THE TREE WITHOUT THE FIX, and the copy is checked to be so: a
 * "control" that silently loaded the fixed code would make the bite test
 * meaningless in the reassuring direction. */
function unfixedCopy() {
  let n = 1;
  while (fs.existsSync(path.join(SCRATCH, "unfixed-" + n))) n++;
  const dir = path.join(SCRATCH, "unfixed-" + n);
  fs.mkdirSync(dir, { recursive: true });
  const tarFile = path.join(dir, "head.tar");
  execFileSync("git", ["archive", "--format=tar", "-o", tarFile, "HEAD", "extension"],
               { cwd: ROOT, stdio: "ignore", windowsHide: true });
  execFileSync(TAR, ["-xf", tarFile, "-C", dir], { stdio: "ignore", windowsHide: true });
  const ext = path.join(dir, "extension");
  const store = fs.readFileSync(path.join(ext, "src", "store.js"), "utf8");
  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, windowsHide: true }).toString().trim();
  if (/atomically|putNow/.test(store)) throw new Error("HEAD copy already carries the fix — no control to bite against");
  return { ext, head };
}

/* ---- one browser, one extension tree ------------------------------------ */

let edgePid = 0;
function killEdge() {
  if (!edgePid) return;
  try { execFileSync("taskkill", ["/PID", String(edgePid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
  catch (e) { /* already exited */ }
  edgePid = 0;
}

async function runBrowser(ext, label, opts) {
  let n = 1;
  while (fs.existsSync(path.join(SCRATCH, "crosstab-profile-" + n))) n++;
  const profile = path.join(SCRATCH, "crosstab-profile-" + n);
  fs.mkdirSync(profile, { recursive: true });
  const port = await freePort();
  const args = [
    "--headless=new",
    "--remote-debugging-port=" + port,
    "--load-extension=" + ext,
    "--disable-extensions-except=" + ext,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--user-data-dir=" + profile,
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "about:blank",
  ];
  log(`\n==== ${label} ====\nextension: ${ext}\nedge profile: ${profile}  port ${port}`);
  const edge = spawn(EDGE, args, { stdio: "ignore", windowsHide: true });
  edgePid = edge.pid;
  let browser;
  const out = {};

  try {
    const ver = await waitFor(() => getJson(`http://127.0.0.1:${port}/json/version`), 20000, "devtools endpoint");
    browser = await cdp(ver.webSocketDebuggerUrl);

    /* ---- routing ---------------------------------------------------- */
    const sessions = new Map();          // sessionId -> targetInfo
    const contexts = new Map();          // sessionId -> [executionContextDescription]
    let swSession = null;
    const stray = [];
    let gate = null;                     // the profile pass's repo pages
    let wLog = [];                       // the top-up's fetches, in arrival order

    const body64 = (s) => Buffer.from(s, "utf8").toString("base64");
    const fulfil = (sid, requestId, status, body, type) =>
      browser.send("Fetch.fulfillRequest", {
        requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: type },
                          { name: "Access-Control-Allow-Origin", value: "*" }],
        body: body64(body),
      }, sid).catch(() => {});

    const newGate = (budget) => ({ budget, served: [], held: [], pendingServe: 0 });
    function serve(g, req) {
      g.pendingServe++;
      setTimeout(async () => {
        await fulfil(req.sid, req.requestId, 200, repoHtml(req.name), "text/html; charset=utf-8");
        g.pendingServe--;
        g.served.push(req.name);
      }, DELAY_A);
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
          if (waitingForDebugger) await browser.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
        })();
      } else if (m.method === "Target.detachedFromTarget") {
        if (m.params.sessionId === swSession) swSession = null;
        sessions.delete(m.params.sessionId);
        contexts.delete(m.params.sessionId);
      } else if (m.method === "Runtime.executionContextCreated") {
        if (!contexts.has(m.sessionId)) contexts.set(m.sessionId, []);
        contexts.get(m.sessionId).push(m.params.context);
      } else if (m.method === "Runtime.executionContextDestroyed") {
        const l = contexts.get(m.sessionId);
        if (l) contexts.set(m.sessionId, l.filter((c) => c.id !== m.params.executionContextId));
      } else if (m.method === "Runtime.executionContextsCleared") {
        contexts.set(m.sessionId, []);
      } else if (m.method === "Fetch.requestPaused") {
        const sid = m.sessionId;
        const { requestId, request, resourceType } = m.params;
        const u = new URL(request.url);
        if (u.hostname === "api.github.com") {
          fulfil(sid, requestId, 200, "[]", "application/json; charset=utf-8");
        } else if (u.pathname === "/" + OWNER && u.searchParams.get("tab") === "repositories") {
          fulfil(sid, requestId, 200, PROFILE_HTML, "text/html; charset=utf-8");
        } else if (/^\/octo\/r\d\d$/.test(u.pathname) && gate) {
          const req = { sid, requestId, name: u.pathname.slice(6) };
          if (gate.served.length + gate.pendingServe < gate.budget) serve(gate, req);
          else gate.held.push(req);       // HELD until the case releases it
        } else if (/^\/octo\/(w\d\d|probe-\w+)$/.test(u.pathname)) {
          const name = u.pathname.slice(6);
          /* A DOCUMENT is B's own page load; a FETCH is the top-up at work.
           * Only the latter is the race, so only it is logged. */
          if (resourceType !== "Document") wLog.push({ name, t: Date.now() });
          setTimeout(() => fulfil(sid, requestId, 200, repoHtml(name), "text/html; charset=utf-8"),
                     resourceType === "Document" ? 0 : DELAY_W);
        } else {
          stray.push(request.url);
          fulfil(sid, requestId, 404, "not in this world", "text/plain");
        }
      }
    });

    await browser.send("Target.setDiscoverTargets", { discover: true });
    await browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

    const findSw = async () => {
      const { targetInfos } = await browser.send("Target.getTargets");
      return targetInfos.find((t) => t.type === "service_worker" && /^chrome-extension:\/\/.*\/background\.js$/.test(t.url));
    };
    const swInfo = await waitFor(findSw, 15000, "extension service worker");
    const extId = new URL(swInfo.url).host;
    log("browser: " + ver.Browser + "   extension id: " + extId);
    if (!swSession) {
      const { sessionId } = await browser.send("Target.attachToTarget", { targetId: swInfo.targetId, flatten: true });
      swSession = sessionId;
      await browser.send("Fetch.enable", { patterns: [{ urlPattern: "https://api.github.com/*" }] }, sessionId).catch(() => {});
    }

    async function swEval(expr) {
      const sid = await waitFor(async () => {
        if (swSession) return swSession;
        const t = await findSw();
        if (t) { const r = await browser.send("Target.attachToTarget", { targetId: t.targetId, flatten: true }); return r.sessionId; }
        return null;
      }, 10000, "service worker session");
      const r = await browser.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      if (r.exceptionDetails) throw new Error("sw eval: " + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
      return r.result.value;
    }
    /* THE STORE AS [key, at] PAIRS. `at` is what tells a refreshed record
     * from the stale one it replaced — presence alone would call a reverted
     * refresh a survivor. */
    const facts = () => swEval(
      "chrome.storage.local.get('repoFacts').then(r => { const f = r.repoFacts || {}; " +
      "return Object.keys(f).map(k => [k, (f[k] && f[k].at) || 0]); })");

    async function pageEval(sid, expr, contextId, timeout) {
      const p = { expression: expr, returnByValue: true, awaitPromise: true };
      if (contextId) p.contextId = contextId;
      const r = await browser.send("Runtime.evaluate", p, sid, timeout || 8000);
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
      return r.result.value;
    }

    async function openTab(url, newWindow) {
      const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", newWindow: !!newWindow });
      const sid = await waitFor(() => {
        for (const [s, t] of sessions) if (t.targetId === targetId) return s;
        return null;
      }, 5000, "page session");
      await browser.send("Page.enable", {}, sid);
      await browser.send("Target.activateTarget", { targetId }).catch(() => {});
      await browser.send("Page.navigate", { url }, sid);
      return { targetId, sid };
    }
    const closeQuiet = (targetId) => browser.send("Target.closeTarget", { targetId }).catch(() => {});

    /* ── CASE 1 — LOCKS EXIST WHERE IT MATTERS ─────────────────────────── *
     * The lock is only a fix if the CONTENT SCRIPT can see navigator.locks
     * and if two tabs' content scripts share one lock namespace. Both are
     * asked in the extension's own isolated world: CDP reports it as an
     * execution context with auxData.type "isolated" and the extension's
     * origin, and Runtime.evaluate takes its contextId like any other. */
    if (opts.locks) {
      log("\ncase 1: navigator.locks in the content script's isolated world, shared across tabs");
      const A = await openTab(`https://github.com/${OWNER}/probe-a`);
      const B = await openTab(`https://github.com/${OWNER}/probe-b`, true);
      for (const t of [A, B]) await browser.send("Runtime.enable", {}, t.sid);
      const ctxOf = (t, kind) => waitFor(() => {
        const l = contexts.get(t.sid) || [];
        return kind === "isolated"
          ? l.find((c) => c.auxData && c.auxData.type === "isolated" && String(c.origin).startsWith("chrome-extension://" + extId))
          : l.find((c) => c.auxData && c.auxData.isDefault && /^https:\/\/github\.com/.test(c.origin));
      }, 10000, kind + " context");
      const [aIso, bIso, aMain] = [await ctxOf(A, "isolated"), await ctxOf(B, "isolated"), await ctxOf(A, "main")];
      const probe = "JSON.stringify({ locks: typeof navigator.locks?.request, shelves: typeof globalThis.Shelves?.cache?.read, " +
                    "origin: location.origin, vis: document.visibilityState })";
      const aSees = JSON.parse(await pageEval(A.sid, probe, aIso.id));
      const bSees = JSON.parse(await pageEval(B.sid, probe, bIso.id));
      const mainSees = JSON.parse(await pageEval(A.sid, probe, aMain.id));
      record("1a LOCKS in isolated world", aSees.locks === "function" && bSees.locks === "function" && aSees.shelves === "function",
        `context "${aIso.name}" (${aIso.origin}); isolated A: locks.request=${aSees.locks}, Shelves.cache=${aSees.shelves}, ` +
        `origin ${aSees.origin}; isolated B: locks.request=${bSees.locks}; main world for contrast: Shelves.cache=${mainSees.shelves}`);

      /* ONE TAB HOLDS, THE OTHER WAITS. The hold is issued and not awaited
       * (the evaluate returns once the request is queued), then B times its
       * own request for the same name. A different name is the control: it
       * must NOT wait, or the 1.5 s would be measuring something else. */
      const HOLD = 1500;
      const hold = (sid, ctx, name) => pageEval(sid,
        `navigator.locks.request(${JSON.stringify(name)}, () => new Promise(r => setTimeout(r, ${HOLD}))); true`, ctx.id);
      const timeIt = (sid, ctx, name) => pageEval(sid,
        `(async () => { const t = performance.now(); await navigator.locks.request(${JSON.stringify(name)}, () => {}); return Math.round(performance.now() - t); })()`,
        ctx.id);
      await hold(A.sid, aIso, "shelves:probe");
      const waited = await timeIt(B.sid, bIso, "shelves:probe");
      await hold(A.sid, aIso, "shelves:probe-2");
      const control = await timeIt(B.sid, bIso, "shelves:other");
      await sleep(HOLD + 200);
      /* AND THE PAGE ITSELF SHARES IT — the reason the wait is bounded. A
       * main-world script on github.com holding "shelves:repoFacts" would
       * stall every writer, which is why store.js gives up after 2 s. */
      await hold(A.sid, aMain, "shelves:probe-3");
      const fromMain = await timeIt(B.sid, bIso, "shelves:probe-3");
      record("1b LOCK SHARED across tabs", waited >= HOLD - 400 && control < 300,
        `tab A (isolated) held "shelves:probe" ${HOLD} ms; tab B (isolated, other window) waited ${waited} ms for it ` +
        `(expect ~${HOLD}); control, a different name: ${control} ms (expect ~0); ` +
        `A held from the MAIN world, B (isolated) waited ${fromMain} ms — page scripts share the namespace too`);
      await closeQuiet(A.targetId);
      await closeQuiet(B.targetId);
      await sleep(500);
    }

    /* ---- the race ----------------------------------------------------- */
    const settings = await swEval("chrome.storage.sync.set({ prewarm: true, warmBatch: 20 })" +
      ".then(() => chrome.storage.sync.get(['prewarm','warmBatch']))");
    log(`\nsettings in chrome.storage.sync: ${JSON.stringify(settings)}`);

    /* STALE MEANS PAST HALF THE TTL (cacheDays 7 → 3.5 days) and young enough
     * that prune's 90-day floor keeps it: thirty days is both. */
    async function seed() {
      const stale = Date.now() - 30 * DAY;
      const f = {};
      wNames.forEach((n) => { f[`${OWNER}/${n}`] = { at: stale, topics: [], description: "stale " + n }; });
      await swEval(`chrome.storage.local.remove(['repoFacts','topicCache']).then(() => ` +
                   `chrome.storage.local.set({ repoFacts: ${JSON.stringify(f)} })).then(() => true)`);
      return stale;
    }
    const tally = (pairs, since) => {
      const m = new Map(pairs);
      const r = rNames.filter((n) => m.has(`${OWNER}/${n}`)).length;
      const w = wNames.filter((n) => m.has(`${OWNER}/${n}`)).length;
      const wNew = wNames.filter((n) => (m.get(`${OWNER}/${n}`) || 0) >= since).length;
      return { r, w, wNew };
    };
    const rStored = async () => tally(await facts(), Infinity).r;

    /* THREE SHAPES OF THE SAME RACE:
     *
     *   natural     no orchestration: A's 30 pages at 250 ms, B opened once A
     *               has 12. Reported, not required to bite — see below.
     *   A-in-B      A writes 10, B reads the store (10 r + 15 stale w), A
     *               finishes all 30 while B is still fetching, then B writes.
     *               The old warm.js wrote its 10-r copy back: A's run erased.
     *   B-in-A      A writes 10 and is held; B refreshes all 15 and writes;
     *               then A finishes. The old pass wrote its copy — read
     *               before B ran, so holding 15 STALE w — back over B's.
     *
     * `layout` says where B opens. A new WINDOW keeps A visible, so A writes
     * through the locked `put`; a new TAB hides A, so A writes every read
     * through the unlocked same-tick `putNow`. Both are real, and they are
     * different code paths, so each ordering takes one. */
    async function race(shape, layout) {
      const tag = `${shape} (B in a new ${layout})`;
      log(`\n  race ${tag}`);
      const staleAt = await seed();
      const t0 = Date.now();
      wLog = [];
      gate = newGate(shape === "natural" ? Infinity : 10);

      const A = await openTab(PROFILE_URL);
      let B;
      const timeline = [];
      const mark = (what) => timeline.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${what}`);

      if (shape === "natural") {
        await waitFor(() => gate.served.length >= 12, 20000, "A 12 served");
        mark(`A has ${gate.served.length} pages; B opens`);
        B = await openTab(B_URL, layout === "window");
      } else {
        await waitFor(() => gate.served.length >= 10, 20000, "A 10 served");
        await waitFor(async () => (await rStored()) >= 10, 8000, "A's 10-read flush");
        mark("A flushed 10, 20 held; B opens");
        B = await openTab(B_URL, layout === "window");
      }
      await sleep(400);
      const vis = {
        A: await pageEval(A.sid, "document.visibilityState").catch(() => "?"),
        B: await pageEval(B.sid, "document.visibilityState").catch(() => "?"),
      };

      /* THE TOP-UP HAS READ THE STORE once its first fetch arrives: warm.js
       * reads, sweeps, picks the due names, then fetches. */
      await waitFor(() => wLog.length >= 1, 15000, "B's first top-up fetch");
      mark(`B's top-up started (store already read); A served ${gate.served.length}`);

      if (shape === "A-in-B") {
        release(gate, N_MINE);
        await waitFor(() => gate.served.length >= N_MINE, 20000, "A all served");
        await waitFor(async () => (await rStored()) >= N_MINE, 8000, "A's final write").catch(() => {});
        mark(`A served all ${N_MINE} and wrote; B has fetched ${wLog.length} of ${N_STALE}`);
        await waitFor(() => wLog.length >= N_STALE, 30000, "B all fetched");
        mark("B fetched all; its write follows the last 900 ms gap");
        await sleep(2500);
      } else if (shape === "B-in-A") {
        await waitFor(() => wLog.length >= N_STALE, 30000, "B all fetched");
        await waitFor(async () => tally(await facts(), t0).wNew >= N_STALE, 8000, "B's write").catch(() => {});
        mark(`B wrote ${tally(await facts(), t0).wNew} fresh w; A still held at ${gate.served.length}`);
        release(gate, N_MINE);
        await waitFor(() => gate.served.length >= N_MINE, 20000, "A all served");
        mark(`A served all ${N_MINE}`);
        await sleep(2500);
      } else {
        await waitFor(() => gate.served.length >= N_MINE, 20000, "A all served");
        mark(`A served all ${N_MINE}; B has fetched ${wLog.length}`);
        await waitFor(() => wLog.length >= N_STALE, 30000, "B all fetched");
        await sleep(2500);
      }
      mark("settled");
      const end = tally(await facts(), t0);
      const stillStale = tally(await facts(), staleAt).w - end.wNew;
      log("    " + timeline.join("\n    "));
      log(`    visibility after B opened: A=${vis.A}, B=${vis.B}; top-up fetched ${wLog.length}`);
      await closeQuiet(B.targetId);
      await closeQuiet(A.targetId);
      await sleep(600);
      gate = null;
      return { tag, ...end, stillStale, fetched: wLog.length, vis };
    }

    out.races = [];
    for (const [shape, layout] of [["natural", "tab"], ["A-in-B", "window"], ["B-in-A", "tab"]]) {
      out.races.push({ shape, layout, ...(await race(shape, layout)) });
    }
    if (stray.length) log("stray github requests answered 404: " + [...new Set(stray)].join(", "));
  } finally {
    if (browser) browser.close();
    killEdge();
  }
  return out;
}

async function main() {
  const fixed = await runBrowser(EXT, "WORKING TREE (fixed)", { locks: true });
  log("\ncase 2: the race on the fixed tree — nothing may be erased");
  for (const x of fixed.races) {
    record(`2 FIXED ${x.tag}`, x.r === N_MINE && x.wNew === N_STALE && x.fetched === N_STALE,
      `A's r records ${x.r}/${N_MINE}, B's refreshed w (new at) ${x.wNew}/${N_STALE}, ` +
      `w reverted to stale ${x.stillStale}, top-up fetched ${x.fetched}`);
  }
  if (FIXED_ONLY) return;

  const { ext, head } = unfixedCopy();
  const old = await runBrowser(ext, `HEAD ${head} (unfixed control)`, { locks: false });
  log("\ncase 3: the same race on the unfixed HEAD — the test must bite");
  for (const x of old.races) {
    const lostR = N_MINE - x.r;
    const lostW = N_STALE - x.wNew;
    const line = `A's r records ${x.r}/${N_MINE} (lost ${lostR}), B's refreshed w ${x.wNew}/${N_STALE} ` +
                 `(lost ${lostW}; ${x.stillStale} reverted to stale), top-up fetched ${x.fetched}`;
    if (x.shape === "natural") {
      /* NOT REQUIRED TO BITE, AND WHY. A's thirty pages at concurrency six
       * and 250 ms each are ~1.3 s of work; the top-up does not even read the
       * store until 3 s after B loads. Unorchestrated, the windows never
       * overlap — which is exactly why the bug survived — so this line is a
       * measurement, and the two orchestrated shapes are the proof. */
      record(`3 UNFIXED ${x.tag} [info]`, true, line);
    } else {
      const want = x.shape === "A-in-B" ? lostR > 0 : lostW > 0;
      record(`3 UNFIXED ${x.tag} bites`, want, line);
    }
  }
}

/* THE WATCHDOG KILLS EDGE TOO: process.exit skips every finally. */
const watchdog = setTimeout(() => { log("WATCHDOG: run exceeded 360s"); killEdge(); process.exit(2); }, 360000);
main().then(() => {
  clearTimeout(watchdog);
  const bad = results.filter((r) => !r.pass);
  log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
}, (e) => {
  clearTimeout(watchdog);
  killEdge();
  log("\nHARNESS ERROR: " + (e && e.stack || e));
  process.exit(2);
});
