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
