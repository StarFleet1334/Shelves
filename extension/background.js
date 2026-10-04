/* SHELVES — background.js (MV3 service worker)
 *
 * The ONLY caller of api.github.com. It lives here rather than in the content
 * script because host_permissions let it attach an Authorization header
 * without meeting CORS preflight or the page's CSP (P.VII).
 *
 * It reads. There is no code path in this file that issues a mutating request,
 * and the token it is handed cannot express one (P.I, P.II).
 */
"use strict";

const API = "https://api.github.com";
const PER_PAGE = 100;
const MAX_PAGES = 6; // 600 repositories; beyond that, shelves are not the problem
const LIMIT_FALLBACK_MS = 60 * 1000; // a limit that does not say when it ends
const LIMIT_KEY = "rateLimits";      // chrome.storage.session key
const STORE_WAIT_MS = 500;           // a storage read may delay a fetch, never wedge one

/* 403 IS NOT "YOUR TOKEN IS DEAD". GitHub answers a bad credential with 401;
 * 403 is what it says when a quota has run out (primary: X-RateLimit-Remaining
 * "0"; secondary: Retry-After), and 429 says the same thing more plainly. The
 * unauthenticated door gets 60 requests an hour PER IP, which one office NAT
 * spends before lunch — and this file used to read every one of those as
 * "token rejected", to a reader who had never set a token. So a failure is
 * classified here, once, from the headers GitHub actually sends:
 *
 *   429                                  rate limited
 *   403 + remaining "0" or Retry-After   rate limited
 *   403 on the ANONYMOUS door            rate limited — there is no credential
 *                                        to reject, so nothing else it can be
 *   403 on the token door, no headers    NOT a limit: the token lacks access
 *                                        (scope, SAML SSO) and saying "wait"
 *                                        would send the reader to wait forever
 *   401                                  never a limit
 *
 * resetAt prefers Retry-After (seconds or an HTTP-date), then
 * X-RateLimit-Reset (unix seconds), then admits it does not know: null.
 * Headers are read defensively — a response with no `headers` at all is a
 * response with no rate headers, not an exception. */
function header(res, name) {
  try {
    if (!res || !res.headers || typeof res.headers.get !== "function") return null;
    const v = res.headers.get(name);
    return v == null ? null : String(v).trim();
  } catch (e) {
    return null;
  }
}

function rateLimit(res, authed, now) {
  const status = res.status;
  const remaining = header(res, "x-ratelimit-remaining");
  const retry = header(res, "retry-after");
  const reset = header(res, "x-ratelimit-reset");

  let limited = false;
  if (status === 429) limited = true;
  else if (status === 403) limited = remaining === "0" || retry != null || !authed;
  if (!limited) return { limited: false, resetAt: null };

  let resetAt = null;
  if (retry != null) {
    if (/^\d+$/.test(retry)) resetAt = now + Number(retry) * 1000;
    else {
      const t = Date.parse(retry);
      if (Number.isFinite(t)) resetAt = t;
    }
  }
  if (resetAt == null && reset != null && /^\d+$/.test(reset)) resetAt = Number(reset) * 1000;
  return { limited: true, resetAt };
}

/* BACKOFF, PER DOOR. Once GitHub has said "not until 14:00", asking again at
 * 13:05 spends nothing but the reader's patience and, for a secondary limit,
 * extends the penalty. So the worker remembers, per door, until when it is
 * shut, and answers from memory with NO fetch until then. A door is "anon",
 * or "tok:" + an FNV-1a hash of the token — two tokens are two quotas, and the
 * token itself is never written anywhere by this file. An anonymous limit does
 * not shut the token door: it is a different quota on a different key.
 *
 * MV3 kills an idle worker after ~30 s, which would forget a limit that lasts
 * an hour; so the table is mirrored, best-effort, into chrome.storage.session
 * (memory-only, cleared with the browser — the right lifetime for a quota).
 * Every touch of it is guarded: a world without chrome.storage (the test vm)
 * simply backs off in memory, and a storage call that throws or never answers
 * costs at most STORE_WAIT_MS once, never the request. */
const limits = Object.create(null); // door -> { until, status, resetAt }
let limitsLoaded = null;

function doorOf(token) {
  if (!token) return "anon";
  let h = 0x811c9dc5;
  const s = String(token);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "tok:" + h.toString(16).padStart(8, "0");
}

function sessionStore() {
  try {
    if (typeof chrome === "undefined" || !chrome || !chrome.storage) return null;
    const s = chrome.storage.session;
    if (!s || typeof s.get !== "function" || typeof s.set !== "function") return null;
    return s;
  } catch (e) {
    return null;
  }
}

function loadLimits() {
  if (limitsLoaded) return limitsLoaded;
  limitsLoaded = (async () => {
    const s = sessionStore();
    if (!s) return;
    try {
      const got = await Promise.race([
        Promise.resolve(s.get(LIMIT_KEY)),
        new Promise((r) => setTimeout(() => r(null), STORE_WAIT_MS)),
      ]);
      const table = got && got[LIMIT_KEY];
      if (!table || typeof table !== "object") return;
      const now = Date.now();
      let stale = false;
      for (const door of Object.keys(table)) {
        const e = table[door];
        if (!e || typeof e.until !== "number" || e.until <= now) { stale = true; continue; }
        if (limits[door]) continue; // memory is never older than the store
        limits[door] = {
          until: e.until,
          status: typeof e.status === "number" ? e.status : 403,
          resetAt: typeof e.resetAt === "number" ? e.resetAt : null,
        };
      }
      if (stale) saveLimits(); // a limit that has passed is not kept on the shelf
    } catch (e) {
      /* a store that will not answer is a store we do without */
    }
  })();
  return limitsLoaded;
}

function saveLimits() {
  const s = sessionStore();
  if (!s) return;
  try {
    const p = s.set({ [LIMIT_KEY]: { ...limits } });
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    /* best-effort: memory still holds the limit for this worker's life */
  }
}

function shut(door, status, resetAt, now) {
  const until = typeof resetAt === "number" && resetAt > now ? resetAt : now + LIMIT_FALLBACK_MS;
  limits[door] = { until, status, resetAt: typeof resetAt === "number" ? resetAt : null };
  saveLimits();
}

function reopen(door) {
  if (!limits[door]) return;
  delete limits[door];
  saveLimits();
}

async function fetchRepos({ user, token }) {
  const out = [];
  const door = doorOf(token);
  await loadLimits();
  const held = limits[door];
  if (held) {
    if (held.until > Date.now()) {
      // Still shut: answer from memory and spend nothing (no fetch at all).
      return { ok: false, status: held.status, rateLimited: true, resetAt: held.resetAt, repos: [] };
    }
    reopen(door);
  }
  const base = token
    ? `${API}/user/repos?per_page=${PER_PAGE}&affiliation=owner&page=`
    : `${API}/users/${encodeURIComponent(user || "")}/repos?per_page=${PER_PAGE}&type=owner&page=`;

  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let res;
    try {
      res = await fetch(base + page, { headers });
    } catch (e) {
      // Offline. Whatever we already have is still worth returning (P.III).
      return { ok: false, status: 0, error: String(e), repos: out };
    }
    if (!res.ok) {
      /* 401 is a credential GitHub rejected; a rate limit is GitHub asking us
       * to wait, and the reply says which (rateLimited, resetAt) so the content
       * script can tell the reader the truth instead of "token rejected" (P.IV).
       * This holds on page 2+ as well: `out` keeps what earlier pages gave. */
      const now = Date.now();
      const lim = rateLimit(res, !!token, now);
      if (lim.limited) {
        shut(door, res.status, lim.resetAt, now);
        return { ok: false, status: res.status, rateLimited: true, resetAt: lim.resetAt, repos: out };
      }
      return { ok: false, status: res.status, repos: out };
    }
    let rows;
    try {
      rows = await res.json();
    } catch (e) {
      return { ok: false, status: res.status, error: "bad json", repos: out };
    }
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const r of rows) {
      /* THE BODY ALREADY CARRIES ALL OF THIS. Keeping three fields and
       * dropping the rest left a repo answered by the API knowing less about
       * itself than one scraped off its own page — for no saved bytes, since
       * the response was the same size either way. Nothing added here is a
       * second request. */
      out.push({
        full_name: String(r.full_name || "").toLowerCase(),
        topics: Array.isArray(r.topics) ? r.topics.map(String) : [],
        private: !!r.private,
        description: r.description ? String(r.description) : "",
        language: r.language ? String(r.language) : "",
        stars: typeof r.stargazers_count === "number" ? r.stargazers_count : null,
        forks: typeof r.forks_count === "number" ? r.forks_count : null,
        license: r.license && r.license.spdx_id ? String(r.license.spdx_id) : "",
        homepage: r.homepage ? String(r.homepage) : "",
        updated: r.pushed_at ? Date.parse(r.pushed_at) || null : null,
        archived: !!r.archived,
        fork: !!r.fork,
      });
    }
    if (rows.length < PER_PAGE) break; // short page means last page
  }

  reopen(door); // an answered request is the door open again
  return { ok: true, status: 200, repos: out };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "repos") return false;
  fetchRepos(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, status: 0, error: String(e), repos: [] }));
  return true; // keep the channel open for the async reply
});
