/* SHELVES — options.js
 *
 * EVERY WRITE GOES THROUGH src/store.js, AND EVERY OUTCOME IS READ. This
 * header used to say the page "cannot use src/store.js, which is a content
 * script" — stale since options.html started loading store.js for the
 * backup — and the page talked to chrome.storage directly, with `flash("Saved")`
 * in the callback and not one read of chrome.runtime.lastError. So a write
 * Chrome REFUSED said "Saved", and the refusals are not exotic:
 *
 *   QUOTA_BYTES_PER_ITEM  8,192 bytes, and the whole shelf list is ONE item
 *   MAX_WRITE_OPERATIONS  120 a minute, against a page that binds Ctrl+S
 *
 * Both lost the only thing on this page the reader types by hand, silently,
 * and the next page load showed the old list as if it had never been edited.
 * Now `Shelves.write` hands back the lastError message, the shelf list is
 * measured before it is sent, a failure stays on screen until the next action
 * replaces it, and the editor keeps what was typed so nothing is lost.
 *
 * The split is unchanged: settings in sync, the token in local (P.II).
 */
"use strict";

const S = globalThis.Shelves;

const DEFAULTS = {
  groups: [],
  otherLabel: "Ungrouped",
  startCollapsed: false,
  cacheDays: 7,
  prewarm: false,
  warmBatch: 6,
  concurrency: 6,
  fetchAllPages: true,
  maxPages: 10,
};

const $ = (id) => document.getElementById(id);
let groups = [];

/* ---- the ordered shelf editor ----------------------------------------- */

function drawGroups() {
  const host = $("groups");
  host.textContent = "";

  if (!groups.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.style.margin = "0 0 8px";
    p.textContent = "No shelves yet — topics will be grouped automatically.";
    host.appendChild(p);
    return;
  }

  groups.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "row";

    const input = document.createElement("input");
    input.type = "text";
    input.value = name;
    input.addEventListener("input", () => {
      groups[i] = input.value;
    });

    const up = document.createElement("button");
    up.className = "icon";
    up.textContent = "↑";
    up.title = "Move up";
    up.disabled = i === 0;
    up.addEventListener("click", () => {
      [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]];
      drawGroups();
    });

    const down = document.createElement("button");
    down.className = "icon";
    down.textContent = "↓";
    down.title = "Move down";
    down.disabled = i === groups.length - 1;
    down.addEventListener("click", () => {
      [groups[i + 1], groups[i]] = [groups[i], groups[i + 1]];
      drawGroups();
    });

    const del = document.createElement("button");
    del.className = "icon";
    del.textContent = "✕";
    del.title = "Remove";
    del.addEventListener("click", () => {
      groups.splice(i, 1);
      drawGroups();
    });

    row.append(input, up, down, del);
    host.appendChild(row);
  });
}

function addGroup() {
  const field = $("newGroup");
  const value = field.value.trim();
  if (!value) return;
  // Order is the user's; only exact duplicates are refused.
  if (groups.some((g) => g.toLowerCase() === value.toLowerCase())) {
    field.value = "";
    return;
  }
  groups.push(value);
  field.value = "";
  drawGroups();
  field.focus();
}

/* ---- what the status line says ------------------------------------------ */

/* A SUCCESS FADES; A FAILURE DOES NOT. "Saved" is confirmation of something
 * the reader expected and can go after two seconds. "Not saved" is news that
 * their edit exists only on this screen, and a message that vanished while
 * they were looking at the GitHub tab would be the old silent failure with
 * extra steps — so it stays until the next save or clear replaces it. */
let shown = 0;
function status(msg, state) {
  const el = $("saved");
  const mine = ++shown;
  el.textContent = msg;
  el.setAttribute("data-state", state);
  if (state === "ok") {
    setTimeout(() => {
      if (shown === mine) el.textContent = "";
    }, 2000);
  }
}
const flash = (msg) => status(msg, "ok");
const fail = (msg) => status(msg, "error");

const commas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/* THE SYNC ITEM OVER THE PER-ITEM QUOTA, if any. Every key is measured —
 * it is cheap — but only `groups` can realistically grow past 8,192 bytes, so
 * when Chrome reports a per-item refusal this page cannot reproduce, the shelf
 * list is still the one named. */
function overLimit(obj) {
  const max = S.SYNC_LIMITS.QUOTA_BYTES_PER_ITEM;
  const keys = Object.keys(obj).sort((x, y) => (x === "groups" ? -1 : y === "groups" ? 1 : 0));
  for (const k of keys) {
    const bytes = S.syncBytes(k, obj[k]);
    if (bytes > max) return { key: k, bytes };
  }
  return null;
}

/* A SIZE IS ONLY PRINTED WHEN IT IS THE EXPLANATION. If Chrome refuses an item
 * our own measure puts under the limit, "too long (32 of 8,192 bytes)" would
 * contradict itself — so the sentence names the limit and stops there. */
function tooLong(obj) {
  const big = overLimit(obj);
  const limit = commas(S.SYNC_LIMITS.QUOTA_BYTES_PER_ITEM);
  if (!big) return "your shelf list is too long for Chrome sync (the limit is " + limit + " bytes)";
  const what = big.key === "groups" ? "your shelf list" : "the “" + big.key + "” setting";
  return what + " is too long for Chrome sync (" + commas(big.bytes) + " of " + limit + " bytes)";
}

/* CHROME'S MESSAGE, TRANSLATED INTO WHAT TO DO ABOUT IT. Anything not
 * recognised is passed through raw: a sentence the reader can paste into an
 * issue beats a paraphrase that guessed wrong. */
function reason(message, obj) {
  const m = String(message || "unknown error");
  if (/QUOTA_BYTES_PER_ITEM/i.test(m)) return tooLong(obj || {});
  if (/MAX_WRITE_OPERATIONS_PER_HOUR/i.test(m)) {
    return "too many saves in an hour; Chrome sync allows " +
      commas(S.SYNC_LIMITS.MAX_WRITE_OPERATIONS_PER_HOUR) + ". Try again later";
  }
  if (/MAX_WRITE_OPERATIONS/i.test(m)) {
    return "too many saves in a minute; Chrome sync allows " +
      S.SYNC_LIMITS.MAX_WRITE_OPERATIONS_PER_MINUTE + ". Try again shortly";
  }
  if (/QUOTA_BYTES\b/.test(m)) {
    return "Chrome sync is full (" + commas(S.SYNC_LIMITS.QUOTA_BYTES) +
      " bytes for this extension)";
  }
  return m;
}

/* ---- load / save ------------------------------------------------------ */

async function load() {
  const [sync, local] = await Promise.all([
    S.read("sync", DEFAULTS),
    S.read("local", { token: "" }),
  ]);
  const s = sync.value;
  groups = Array.isArray(s.groups) ? s.groups.slice() : [];
  $("otherLabel").value = s.otherLabel || DEFAULTS.otherLabel;
  $("startCollapsed").checked = !!s.startCollapsed;
  $("cacheDays").value = Number(s.cacheDays) || DEFAULTS.cacheDays;
  $("prewarm").checked = s.prewarm === true;   // anything else is off
  const n = $("warmBatchN");
  if (n) n.textContent = String(Number(s.warmBatch) || DEFAULTS.warmBatch);
  drawGroups();
  $("token").value = local.value.token || "";

  /* THE FORM STAYS USABLE, BUT IT DOES NOT PRETEND. What is on screen after a
   * failed read is the defaults, not the reader's settings, and a Save from
   * here would write those defaults over the real ones — so the page says so
   * before anyone presses it. */
  const bad = !sync.ok ? sync : !local.ok ? local : null;
  if (bad) fail("Could not read your settings — " + reason(bad.error));
}

/* ONE SAVE AT A TIME. Ctrl+S held down, or mashed, is a burst of writes
 * against a budget of 120 a minute that every later save shares; a second
 * press while the first is in flight would only spend it. */
let saving = false;

async function save() {
  if (saving) return;
  saving = true;
  try {
    await saveOnce();
  } finally {
    saving = false;
  }
}

async function saveOnce() {
  const clean = groups.map((g) => g.trim()).filter(Boolean);
  const days = Math.max(1, Math.min(90, Number($("cacheDays").value) || DEFAULTS.cacheDays));
  const settings = {
    groups: clean,
    otherLabel: $("otherLabel").value.trim() || DEFAULTS.otherLabel,
    startCollapsed: $("startCollapsed").checked,
    cacheDays: days,
    prewarm: $("prewarm").checked,
  };

  /* MEASURED BEFORE IT IS SENT. Chrome would refuse an over-long item anyway;
   * asking it costs a write from the per-minute budget to learn a number
   * this page can compute. Nothing is written, so nothing is half-written. */
  if (overLimit(settings)) {
    fail("Not saved — " + tooLong(settings));
    return;
  }

  /* ONE COHERENT OUTCOME. On a settings failure the token is not attempted
   * and the editor is NOT redrawn from `clean`: the shelves the reader typed
   * stay on screen exactly as typed, because right now that screen is the
   * only copy of them. */
  const r = await S.write("sync", settings);
  if (!r.ok) {
    fail("Not saved — " + reason(r.error, settings));
    return;
  }
  groups = clean;
  drawGroups();

  const t = await S.write("local", { token: $("token").value.trim() });
  if (!t.ok) {
    fail("Settings saved, but the token was not — " + reason(t.error));
    return;
  }
  flash("Saved");
}

/* ---- wiring ----------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  load();

  $("add").addEventListener("click", addGroup);
  $("newGroup").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addGroup();
    }
  });

  $("reveal").addEventListener("click", () => {
    const f = $("token");
    f.type = f.type === "password" ? "text" : "password";
  });

  $("save").addEventListener("click", save);

  /* The cache is what a rescan can rebuild. NOTES ARE NOT — no request
     re-derives a sentence the user typed — so this button must never take
     them with it, however tempting one call would be. */
  $("clear").addEventListener("click", async () => {
    const r = await S.write("local", { topicCache: {}, repoFacts: {} });
    if (!r.ok) return fail("Could not clear the cache — " + reason(r.error));
    flash("Cached repo facts cleared — your notes are untouched");
  });

  /* ---- the way out, and the way back in --------------------------------
   * Both halves are file I/O and nothing else: `Shelves.backup` in store.js
   * owns what a backup contains and what an incoming one is allowed to do,
   * because that is the part with a decision in it and this page has no way
   * to test itself.
   *
   * `<a download>` needs NO `downloads` permission — that permission is for
   * the `chrome.downloads` API, and an anchor from an extension page is an
   * ordinary link. Checked before building it, because a feature that costs a
   * permission is a different feature (P.II). */
  const said = (msg) => { $("backupSaid").textContent = msg; };

  $("export").addEventListener("click", async () => {
    try {
      const data = await Shelves.backup.pack();
      const counts = Shelves.backup.keys
        .map((k) => Object.keys(data[k]).length);
      if (!counts.some(Boolean)) return said("nothing written down yet");
      const blob = new Blob([JSON.stringify(data, null, 2)],
                           { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const day = new Date(data.exported).toISOString().slice(0, 10);
      a.download = "shelves-" + day + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      /* Revoked, or the blob is held for the life of the page — and this page
       * is a popup people leave open. */
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      said(counts[0] + " notes, " + counts[1] + " shelved by hand, " +
           counts[2] + " pinned");
    } catch (e) {
      said("could not write that file");
    }
  });

  $("importPick").addEventListener("click", () => $("importFile").click());

  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";                      // so the same file can be re-picked
    if (!file) return;
    /* A FILE IS THE MOST UNTRUSTED INPUT THIS EXTENSION TAKES, and the only one
     * that arrives without GitHub in front of it. Bounded before it is read:
     * a backup of a 600-repo account is tens of kilobytes. */
    if (file.size > 4 * 1024 * 1024) return said("that file is too large to be one of ours");
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      return said("that is not a Shelves export");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return said("that is not a Shelves export");
    }
    const r = await Shelves.backup.restore(parsed);
    if (!r.ok) return said("could not save what was in that file");
    said(r.added + " added, " + r.kept + " already here and left alone" +
         (r.skipped ? ", " + r.skipped + " ignored" : ""));
  });

  // Ctrl/Cmd+S saves, because this doubles as a popup people close fast.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  });
});
