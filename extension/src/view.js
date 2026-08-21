/* SHELVES — view.js
 *
 * Bucketing and rendering. The one rule that matters here: the rows are
 * GitHub's OWN <li> elements, re-parented (P.V). Nothing is rebuilt from
 * data, so stars, language dots, "Updated 3 days ago", the Private badge and
 * every field GitHub adds next year keep working with no effort.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  /* First match wins — a repo is on exactly one shelf, always. Duplicates
   * would destroy both the counts and the ability to scan the page once
   * (charter, Boundaries). */
  S.bucketFor = function bucketFor(topics, settings) {
    if (settings.groups.length) {
      const hit = settings.groups.find((g) => topics.indexOf(g.toLowerCase()) !== -1);
      return hit || settings.otherLabel;
    }
    // No configured shelves: auto-group by the repo's first topic, alphabetical,
    // so the same repo always lands on the same shelf between loads.
    return topics.length ? topics.slice().sort()[0] : settings.otherLabel;
  };

  S.bucket = function bucket(rows, topics, settings) {
    const buckets = new Map();
    rows.forEach((li, i) => {
      const key = S.bucketFor(topics[i] || [], settings);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(li);
    });

    let order;
    if (settings.groups.length) {
      order = settings.groups.filter((g) => buckets.has(g));
    } else {
      order = Array.from(buckets.keys())
        .filter((k) => k !== settings.otherLabel)
        .sort((a, b) => buckets.get(b).length - buckets.get(a).length || a.localeCompare(b));
    }
    if (buckets.has(settings.otherLabel)) order.push(settings.otherLabel); // always last
    return { buckets, order };
  };

  function button(label, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sh-btn";
    b.textContent = label;
    if (title) b.title = title;
    return b;
  }

  /* ---- one row's private margin (idea 5) -------------------------------- */
  /* A NOTE IS ADDED TO GITHUB'S OWN <li>, which is the whole reason it can sit
   * beside a row that keeps its stars, its language dot and every field GitHub
   * adds next year (P.V). The marker is guarded by a dataset flag, because a
   * second pass re-parents the SAME element and would otherwise hang a second
   * editor off it.
   *
   * MEASURED, in a real browser, after it shipped wrong: the <li> is a flex
   * row that DOES NOT WRAP (`d-flex`, no `flex-wrap`), and it holds two
   * columns — the text on the left, the Star button on the right. A third
   * child styled `flex: 0 0 100%` therefore does not drop onto its own line;
   * it claims the full width, refuses to shrink, and both real columns
   * collapse to min-content. The description went from 599px on two lines to
   * 94px on THIRTEEN, one word per line, breaking mid-word.
   *
   * So the note goes INSIDE the text column instead — the li's own child that
   * holds the <h3> — where it is an ordinary block under the description,
   * aligned with the name, and no part of the row's flex arithmetic. */
  function column(li) {
    const h3 = li.querySelector("h3");
    if (h3) {
      let el = h3;
      while (el.parentElement && el.parentElement !== li) el = el.parentElement;
      /* `el !== h3` matters: where the heading is a direct child of the row
       * there IS no text column, and returning it would put the note inside an
       * <h3> — 20px, bold, and semantically a heading. That row falls through
       * to the li, which the fallback rules below are written for. */
      if (el !== h3 && el.parentElement === li) return el;
    }
    return li;   // markup we do not recognise: the fallback is styled to wrap
  }

  function margin(li, name, note, handlers) {
    if (li.dataset.shMargin === "1") {
      const held = li.querySelector(".sh-margin");
      if (held) paintNote(held, note);
      return;
    }
    li.dataset.shMargin = "1";

    const wrap = document.createElement("div");
    wrap.className = "sh-margin";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sh-note-btn";
    btn.title = "A private note on this repo. It never leaves this browser.";
    const body = document.createElement("span");
    body.className = "sh-note-text";
    wrap.append(btn, body);
    paintNote(wrap, note);

    btn.addEventListener("click", () => edit(wrap, name, handlers));
    body.addEventListener("click", () => edit(wrap, name, handlers));
    place(column(li), wrap);
  }

  /* UNDER THE DESCRIPTION, NOT AFTER THE ROW. A note is commentary on the repo
   * and belongs with the prose; appended last it lands beneath "Python ·
   * Updated 2 days ago", which is the row's footer and makes the note read as
   * a stray fourth line.
   *
   * The anchor is resolved to something whose parent is definitely the column,
   * because `p.parentElement.after()` inserts OUTSIDE the column whenever the
   * paragraph is a direct child of it — the note would leave the text block
   * entirely and the flex bug would come straight back. */
  function place(col, wrap) {
    const p = col.querySelector("p");
    const anchor = p && (p.parentElement === col ? p : p.parentElement);
    if (anchor && anchor.parentElement === col) anchor.insertAdjacentElement("afterend", wrap);
    else col.appendChild(wrap);
  }

  function paintNote(wrap, note) {
    const btn = wrap.querySelector(".sh-note-btn");
    const body = wrap.querySelector(".sh-note-text");
    const has = !!(note && note.trim());
    wrap.dataset.has = has ? "1" : "0";
    if (btn) btn.textContent = has ? "✎" : "✎ note";
    if (body) body.textContent = has ? note : "";
  }

  /* The editor REPLACES the marker in place rather than opening a panel: the
   * note is about this row and belongs in this row's own space. Esc cancels,
   * Enter saves, Shift+Enter is a newline — and blur saves too, because the
   * commonest way to leave a one-line field is to click somewhere else. */
  function edit(wrap, name, handlers) {
    if (wrap.querySelector("textarea")) return;
    const was = (wrap.querySelector(".sh-note-text") || {}).textContent || "";
    const ta = document.createElement("textarea");
    ta.className = "sh-note-edit";
    ta.value = was;
    ta.rows = 1;
    ta.placeholder = "a note only you can see";
    wrap.appendChild(ta);
    wrap.dataset.editing = "1";
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    let done = false;
    const close = (save) => {
      if (done) return;
      done = true;
      const text = ta.value;
      ta.remove();
      delete wrap.dataset.editing;
      if (save && text !== was) handlers.note(name, text);
      else paintNote(wrap, was);
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();     // the dossier-style Esc must not also fire
        close(false);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        close(true);
      }
    });
    ta.addEventListener("blur", () => close(true));
  }

  S.paintNote = paintNote;   // main.js repaints one row after a save

  /* ---- the filter (idea 2) ---------------------------------------------- */
  /* GitHub's own box matches NAMES. This matches everything facts.js
   * harvested — description, topics, language, licence, the README's opening
   * line — and the note above, which is the only text on the page that is
   * yours. Rows carry their haystack on themselves so a keystroke is a string
   * compare per row and not a re-derivation. */
  S.applyFilter = function applyFilter(host, raw) {
    const q = String(raw || "").trim().toLowerCase();
    let shown = 0, total = 0;

    /* THE ROWS ARE FILTERED FIRST AND THE SHELVES SECOND, because in flat mode
     * there are no shelves at all — `flat list` removes every <details> and
     * pours the rows into one <ul>. Walking shelves to reach rows made the box
     * silently inert there and, worse, made it report "0 of 0" while the
     * reader typed into a list it was no longer touching. */
    host.querySelectorAll("li").forEach((li) => {
      if (li.dataset.shHay === undefined) return;   // not one of ours
      total++;
      const hit = !q || li.dataset.shHay.indexOf(q) !== -1;
      li.classList.toggle("sh-hide", !hit);
      if (hit) shown++;
    });

    host.querySelectorAll("details.sh-shelf").forEach((d) => {
      const held = [...d.querySelectorAll("li")];
      const count = held.length;
      const hits = held.filter((li) => !li.classList.contains("sh-hide")).length;

      const c = d.querySelector(".sh-count");
      if (c) c.textContent = q ? hits + " / " + count : String(count);
      /* A shelf with no match is dimmed rather than removed: the shelves are
       * the map, and a map that reshuffles under a search is harder to read
       * than one that greys out. */
      d.classList.toggle("sh-nomatch", !!q && hits === 0);

      /* FILTERING OPENS SHELVES, AND MUST NOT REMEMBER DOING SO. Searching
       * forces a shelf open to show its hits; without this the `toggle`
       * listener would write that to the collapse store and a cleared search
       * would leave every shelf you had closed hanging open forever. So the
       * real state is parked on the first keystroke and put back on the last. */
      if (q) {
        if (d.dataset.shWasOpen === undefined) d.dataset.shWasOpen = d.open ? "1" : "0";
        d.open = hits > 0;
      } else if (d.dataset.shWasOpen !== undefined) {
        d.open = d.dataset.shWasOpen === "1";
        delete d.dataset.shWasOpen;
      }
    });

    const bar = host.querySelector(".sh-found");
    if (bar) bar.textContent = q ? shown + " of " + total : "";
    host.dataset.filtering = q ? "1" : "";
    return { shown, total };
  };

  /**
   * Builds the whole replacement subtree. Pure construction: it does not touch
   * the live page, so main.js owns the single swap.
   */
  S.render = function render(ctx) {
    const { rows, topics, settings, sourceUl, source, warning, owner, handlers } = ctx;
    const names = ctx.names || [];
    const facts = ctx.facts || [];
    const notes = ctx.notes || {};
    const { buckets, order } = S.bucket(rows, topics, settings);
    const open = S.collapse.read(owner);

    /* Every row is told what it knows about itself ONCE, here, while we still
     * have the parallel arrays. After this the row is self-describing and the
     * filter never needs to look anything up. */
    rows.forEach((li, i) => {
      const name = names[i] || "";
      const note = notes[name] || "";
      /* THE ROW'S OWN TEXT IS CAPTURED BEFORE WE ADD ANYTHING TO IT. Read
       * afterwards, `textContent` carries our own margin — so every row would
       * match the query "note", and a saved note would be counted twice. Taken
       * once, before the first margin, it stays GitHub's text forever. */
      if (li.dataset.shText === undefined) {
        li.dataset.shText = String(li.textContent || "").replace(/\s+/g, " ").trim();
      }
      margin(li, name, note, handlers);
      li.dataset.shHay = S.haystack(li.dataset.shText, facts[i], note);
    });

    const host = document.createElement("div");
    host.id = S.HOST_ID;

    const bar = document.createElement("div");
    bar.className = "sh-bar";

    const expand = button("expand all");
    const collapse = button("collapse all");
    const flat = button("flat list", "GitHub's plain ungrouped list");
    const rescan = button("rescan", "Forget cached facts and read them again");

    /* type="search" and not "text": it gets the browser's own clear button and
     * its Esc-clears behaviour for free, on every platform, correctly. */
    const find = document.createElement("input");
    find.type = "search";
    find.className = "sh-find";
    find.placeholder = "find  /";
    find.title =
      "Searches names, descriptions, topics, languages, READMEs and your own notes — " +
      "not just names, the way GitHub's box does.";
    find.setAttribute("aria-label", "Filter repositories");
    const found = document.createElement("span");
    found.className = "sh-found";

    const note = document.createElement("div");
    note.className = "sh-note";

    /* P.IV — always say which rung answered. When grouping looks wrong this
     * is the first thing anyone needs to know. */
    const tagged = topics.filter((t) => t && t.length).length;
    note.textContent =
      rows.length + " repos · " + order.length + " shelves · " +
      tagged + " tagged · via " + source;
    if (warning) {
      const w = document.createElement("span");
      w.className = "sh-warn";
      w.textContent = warning;
      note.append(" · ", w);
    }

    bar.append(expand, collapse, flat, rescan, find, found, note);
    host.appendChild(bar);

    order.forEach((label) => {
      const list = buckets.get(label);
      const d = document.createElement("details");
      d.className = "sh-shelf";
      const remembered = open[label];
      d.open = remembered === undefined ? !settings.startCollapsed : !!remembered;

      const sum = document.createElement("summary");
      sum.className = "sh-sum";
      const name = document.createElement("span");
      name.className = "sh-name";
      name.textContent = label;
      const count = document.createElement("span");
      count.className = "sh-count";
      count.textContent = String(list.length);
      sum.append(name, count);
      d.appendChild(sum);

      const ul = document.createElement("ul");
      ul.className = sourceUl.className;
      ul.dataset[S.DONE] = "1"; // guard two: the finder must never take this back
      list.forEach((li) => ul.appendChild(li));
      d.appendChild(ul);

      d.addEventListener("toggle", () => {
        // a shelf the FILTER opened is not a shelf the reader opened
        if (host.dataset.filtering === "1") return;
        const state = S.collapse.read(owner);
        state[label] = d.open;
        S.collapse.write(owner, state);
      });

      host.appendChild(d);
    });

    expand.addEventListener("click", () =>
      host.querySelectorAll("details").forEach((d) => (d.open = true))
    );
    collapse.addEventListener("click", () =>
      host.querySelectorAll("details").forEach((d) => (d.open = false))
    );
    rescan.addEventListener("click", () => handlers.rescan());

    find.addEventListener("input", () => S.applyFilter(host, find.value));
    find.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        find.value = "";
        S.applyFilter(host, "");
        find.blur();
      }
    });
    /* `/` IS GITHUB'S OWN SHORTCUT for its search box, and it is taken here on
     * the document because the shelves have replaced the list `/` used to be
     * about. It stands down inside any field — including GitHub's — so the
     * only key it ever steals is one pressed while reading the page. */
    host.dataset.slash = "1";
    const slash = (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
          (t && t.isContentEditable)) return;
      if (!host.isConnected) return document.removeEventListener("keydown", slash);
      e.preventDefault();
      find.focus();
      find.select();
    };
    document.addEventListener("keydown", slash);

    flat.addEventListener("click", () => {
      if (host.dataset.flat === "1") return handlers.reload();
      host.dataset.flat = "1";
      const one = document.createElement("ul");
      one.className = sourceUl.className;
      one.dataset[S.DONE] = "1";
      // Keeps the merged pages 2..N — flat is not "back to page one".
      host.querySelectorAll("details li").forEach((li) => one.appendChild(li));
      host.querySelectorAll("details").forEach((d) => d.remove());
      host.appendChild(one);
      flat.textContent = "shelved";
    });

    return host;
  };

  S.status = function status(text) {
    let el = document.getElementById("sh-status");
    if (!el) {
      el = document.createElement("div");
      el.id = "sh-status";
      el.className = "sh-status";
    }
    el.textContent = text;
    return el;
  };
})(globalThis.Shelves);
