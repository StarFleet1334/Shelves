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

  /* ---- shelf identity: a colour and a glyph ------------------------------
   * Eight shelves told apart only by their text is eight reading tasks. Give
   * each one a hue and a shape and finding "the one I was in" stops being
   * reading and becomes recognising — which is most of the difference between
   * a tool you installed and one you know your way around.
   *
   * DERIVED, NEVER STORED. The identity is a hash of the shelf's own name, so
   * the same shelf is the same colour on every machine, on every load, forever,
   * with nothing persisted, nothing to migrate and nothing to lose. That is
   * principle I turned into a feature rather than obeyed as a constraint.
   *
   * TWO CHANNELS, AND ONE OF THEM IS SHAPE. A palette alone fails any reader
   * who cannot separate two of its hues; the glyph carries the SAME slot, so
   * colour and shape can never disagree and either one alone is enough.
   *
   * EVERY HUE CARRIES ITS OWN LIGHTNESS, and that is not fussiness. The first
   * version used one saturation and one lightness for all twelve, on the
   * reasoning that tuning it once was tuning it everywhere. Luminance is not a
   * function of hue at a fixed L: measured in a real browser, blue at 52% came
   * out at 3.3:1 on the dark theme while yellow at the same 52% came out at
   * 2.2:1 on the light one. There is no single lightness that serves both
   * backgrounds for every hue, and this extension deliberately has no theme
   * detection — it borrows GitHub's palette rather than guessing at one. So
   * each hue is solved instead for a common relative luminance of 0.19, which
   * is the band where BOTH sides clear. The whole palette now measures 4.32:1
   * or better against #0d1117 and 4.37:1 or better against #ffffff, with no
   * media query and nothing to detect.
   *
   * [hue, saturation%, lightness%] */
  const PALETTE = [
    [212, 48, 50], [145, 62, 33.5], [32, 84, 38], [275, 64, 59],
    [340, 82, 51], [178, 62, 32.5], [45, 70, 34], [250, 70, 64.5],
    [95, 60, 33], [310, 60, 51], [196, 80, 37], [8, 90, 48],
  ];

  /* EVERY ONE OF THESE WAS MEASURED, NOT CHOSEN. A code point the font stack
   * lacks renders as the missing-glyph box — which at 10px looks enough like a
   * hollow square marker to survive being looked at, and shipped exactly that
   * way: `□` (U+25A1) and, worse, `●` (U+25CF) are both tofu in GitHub's own
   * font stack on Windows. The probe is tests/glyph-probe.html: render the
   * candidate and U+FFFF, which is guaranteed to have no glyph anywhere, and
   * compare widths. Equal width IS the box. These twelve all render, and all
   * measure 7.9–8.6px, so no shelf name steps sideways to make room for one. */
  const GLYPHS = ["⬢", "◆", "■", "▲", "★", "▼",
                  "○", "◇", "◉", "△", "☆", "▽"];

  /** FNV-1a. Math.imul because the multiply overflows double precision, and a
   *  hash that is quietly wrong is a palette that quietly clusters. */
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  /**
   * @returns {Map<string, {slot: number, hue: ?number, glyph: string}>}
   *
   * A HASH ALONE IS NOT ENOUGH. Twelve slots and eight shelves collide better
   * than nine times in ten — birthday, not intuition — and two shelves wearing
   * one colour fails at the only job the colour has. So a taken slot walks to
   * the next free one.
   *
   * THE WALK RUNS IN ALPHABETICAL ORDER, NEVER IN DRAWING ORDER. Auto-grouping
   * sorts shelves by size, so resolving collisions in the order they are drawn
   * would repaint the map every time a repo moved between two shelves — a
   * colour that changes under you is worse than no colour. Adding a genuinely
   * new shelf can still shift one that collides with it, which is the moment
   * the map is changing anyway.
   *
   * The leftovers shelf is deliberately outside the system: it is a remainder,
   * not an idea, and a colour of its own would claim otherwise.
   */
  S.identity = function identity(labels, otherLabel) {
    const out = new Map();
    const taken = new Set();
    const n = PALETTE.length;
    (labels || [])
      .filter((l) => l && l !== otherLabel)
      .slice()
      .sort()
      .forEach((label) => {
        let slot = hash(label) % n;
        for (let i = 0; i < n && taken.has(slot); i++) slot = (slot + 1) % n;
        taken.add(slot);
        const [hue, sat, lit] = PALETTE[slot];
        out.set(label, { slot, hue, sat, lit, glyph: GLYPHS[slot] });
      });
    if ((labels || []).indexOf(otherLabel) !== -1) {
      out.set(otherLabel, { slot: -1, hue: null, sat: null, lit: null, glyph: "·" });
    }
    return out;
  };

  /** The three numbers onto an element, so the stylesheet owns every use of
   *  them and a solid rule, a tinted border and a chip outline can never drift
   *  apart into three slightly different colours. */
  function paintMark(node, mark) {
    if (!mark || mark.hue == null) return false;
    node.style.setProperty("--sh-hue", String(mark.hue));
    node.style.setProperty("--sh-sat", mark.sat + "%");
    node.style.setProperty("--sh-lit", mark.lit + "%");
    return true;
  }
  S.paintMark = paintMark;

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

    /* THE VOCABULARY IS BADGED BEFORE IT IS OPENED. A panel nobody opens tells
     * nobody anything, and the whole premise is that these problems are
     * invisible — so the button carries the count, and the reader learns there
     * are three things wrong with their labelling without deciding to look. */
    const vocab = button("vocabulary",
      "Your topics as a system: duplicate spellings, blanket labels, and the " +
      "ones used only once.");
    const vdata = S.vocabulary(topics, names);
    const issues = S.vocabIssues(vdata);
    if (issues) {
      const badge = document.createElement("span");
      badge.className = "sh-vbadge";
      badge.textContent = String(issues);
      vocab.append(" ", badge);
    }

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

    bar.append(expand, collapse, flat, rescan, vocab, find, found, note);
    host.appendChild(bar);

    /* Built once and toggled, not rebuilt: the panel holds the reader's place
     * in a long topic list, and re-creating it on every press would scroll
     * them back to the top of their own vocabulary. */
    const marks = S.identity(order, settings.otherLabel);
    let panel = null;
    vocab.addEventListener("click", () => {
      if (panel) {
        panel.hidden = !panel.hidden;
        if (panel.hidden) delete vocab.dataset.on;
        else vocab.dataset.on = "1";
        return;
      }
      panel = S.vocabPanel(vdata, {
        identity: marks,
        /* A topic press is a SEARCH, not a regrouping. The filter already
         * matches topics, so the panel needs no machinery of its own — and the
         * reader gets the answer in the shelves they were already reading
         * rather than in a second, differently-shaped list. */
        onPick: (topic) => {
          find.value = topic;
          S.applyFilter(host, topic);
          find.focus();
        },
      });
      vocab.dataset.on = "1";
      bar.insertAdjacentElement("afterend", panel);
    });

    order.forEach((label) => {
      const list = buckets.get(label);
      const d = document.createElement("details");
      d.className = "sh-shelf";
      const remembered = open[label];
      d.open = remembered === undefined ? !settings.startCollapsed : !!remembered;

      /* The hue rides on a custom property and the stylesheet does the rest, so
       * the tint, the rule and the glyph can never drift apart, and a theme
       * change costs CSS rather than a re-render. */
      const mark = marks.get(label);
      if (!paintMark(d, mark)) d.classList.add("sh-plain");

      const sum = document.createElement("summary");
      sum.className = "sh-sum";
      const glyph = document.createElement("span");
      glyph.className = "sh-glyph";
      glyph.setAttribute("aria-hidden", "true");   // the name beside it is the label
      glyph.textContent = mark ? mark.glyph : "·";
      const name = document.createElement("span");
      name.className = "sh-name";
      name.textContent = label;
      const count = document.createElement("span");
      count.className = "sh-count";
      count.textContent = String(list.length);
      sum.append(glyph, name, count);
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
