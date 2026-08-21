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

async function fetchRepos({ user, token }) {
  const out = [];
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
      // 401/403 here is almost always an expired token; the content script
      // turns that status into a visible warning rather than silence (P.IV).
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
      out.push({
        full_name: String(r.full_name || "").toLowerCase(),
        topics: Array.isArray(r.topics) ? r.topics.map(String) : [],
        private: !!r.private,
      });
    }
    if (rows.length < PER_PAGE) break; // short page means last page
  }

  return { ok: true, status: 200, repos: out };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "repos") return false;
  fetchRepos(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, status: 0, error: String(e), repos: [] }));
  return true; // keep the channel open for the async reply
});
