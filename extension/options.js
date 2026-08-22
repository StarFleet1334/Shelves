/* SHELVES — options.js
 *
 * The options page is its own small world: it cannot use src/store.js, which
 * is a content script. It talks to chrome.storage directly, and keeps the same
 * split — settings in sync, the token in local (P.II).
 */
"use strict";

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

/* ---- load / save ------------------------------------------------------ */

function load() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    groups = Array.isArray(s.groups) ? s.groups.slice() : [];
    $("otherLabel").value = s.otherLabel || DEFAULTS.otherLabel;
    $("startCollapsed").checked = !!s.startCollapsed;
    $("cacheDays").value = Number(s.cacheDays) || DEFAULTS.cacheDays;
    $("prewarm").checked = s.prewarm === true;   // anything else is off
    const n = $("warmBatchN");
    if (n) n.textContent = String(Number(s.warmBatch) || DEFAULTS.warmBatch);
    drawGroups();
  });
  chrome.storage.local.get({ token: "" }, (l) => {
    $("token").value = l.token || "";
  });
}

function flash(msg) {
  const el = $("saved");
  el.textContent = msg;
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = "";
  }, 2000);
}

function save() {
  const clean = groups.map((g) => g.trim()).filter(Boolean);
  const days = Math.max(1, Math.min(90, Number($("cacheDays").value) || DEFAULTS.cacheDays));

  chrome.storage.sync.set(
    {
      groups: clean,
      otherLabel: $("otherLabel").value.trim() || DEFAULTS.otherLabel,
      startCollapsed: $("startCollapsed").checked,
      cacheDays: days,
      prewarm: $("prewarm").checked,
    },
    () => {
      chrome.storage.local.set({ token: $("token").value.trim() }, () => {
        groups = clean;
        drawGroups();
        flash("Saved");
      });
    }
  );
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
  $("clear").addEventListener("click", () => {
    chrome.storage.local.set({ topicCache: {}, repoFacts: {} }, () =>
      flash("Cached repo facts cleared — your notes are untouched"));
  });

  // Ctrl/Cmd+S saves, because this doubles as a popup people close fast.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  });
});
