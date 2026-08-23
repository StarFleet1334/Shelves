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
  /**
   * @param {string[]} topics
   * @param {object}   settings
   * @param {string=}  override  the reader's own answer, which outranks all of it
   *
   * AN OVERRIDE OUTRANKS EVERY TOPIC, and it is checked first because that is
   * what "the reader said so" means. It is also the only branch here that can
   * shelve a repo with no topics at all, which on a real untagged account is
   * most of them.
   */
  S.bucketFor = function bucketFor(topics, settings, override) {
    const own = String(override == null ? "" : override).trim();
    if (own) {
      /* A CONFIGURED SHELF OWNS THE SPELLING OF ITS OWN NAME. An override is
       * stored verbatim, and the label it was stored with is whatever was
       * drawn at the time — so re-casing a group in the options page later
       * (`keep` -> `Keep`) would leave the pinned repos in a second shelf of
       * their own, beside the one they were put on. Matching case-insensitively
       * and returning the CONFIGURED spelling keeps one shelf one shelf,
       * without rewriting anything the reader stored. */
      const same = (settings.groups || [])
        .concat([settings.otherLabel])
        .find((g) => g && g.toLowerCase() === own.toLowerCase());
      return same || own;
    }
    if (settings.groups.length) {
      const hit = settings.groups.find((g) => topics.indexOf(g.toLowerCase()) !== -1);
      return hit || settings.otherLabel;
    }
    // No configured shelves: auto-group by the repo's first topic, alphabetical,
    // so the same repo always lands on the same shelf between loads.
    return topics.length ? topics.slice().sort()[0] : settings.otherLabel;
  };

  S.bucket = function bucket(rows, topics, settings, names, overrides) {
    const ov = overrides || {};
    const who = names || [];
    const buckets = new Map();
    rows.forEach((li, i) => {
      const key = S.bucketFor(topics[i] || [], settings, ov[who[i]]);
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
    /* A SHELF NAMED ONLY BY AN OVERRIDE IS STILL A SHELF. `order` used to be
     * built purely from `settings.groups`, so a bucket whose label nobody had
     * configured was dropped from the order while its rows sat in `buckets` —
     * and rows in a bucket nothing draws do not appear on the page at all.
     * Dragging a repo onto a shelf you had not configured would have deleted it
     * from view. Anything with rows in it gets drawn, in a stable order. */
    const seen = new Set(order);
    Array.from(buckets.keys())
      .filter((k) => k !== settings.otherLabel && !seen.has(k))
      .sort((a, b) => a.localeCompare(b))
      .forEach((k) => order.push(k));
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
    const taken = new Set();   // "hue:glyph" pairs already handed out
    const hues = new Set();
    const glyphs = new Set();
    const n = PALETTE.length;
    (labels || [])
      .filter((l) => l && l !== otherLabel)
      .slice()
      .sort()
      .forEach((label) => {
        /* ── ABOVE TWELVE SHELVES, THE WALK USED TO WRAP AND REPEAT ──────────
         * The slot was one number for both channels, so once all twelve were
         * taken the loop ran `n` times, returned to where it started, and
         * handed out a duplicate — the same hue AND the same glyph. Proved
         * with sixteen labels: three shelves on slot 11, all `▽`, all one
         * colour. Both channels failing together is the one thing the
         * two-channel design exists to prevent, and the README claimed the
         * opposite as fact.
         *
         * It is not a corner case; it is the DEFAULT mode. Auto-grouping makes
         * one shelf per distinct topic, and `suggest` turns accepting a
         * thirteenth into one click.
         *
         * So hue and glyph become a PAIR, walked independently: 12 x 12 = 144
         * distinct identities, and the walk only repeats a pair after 144
         * shelves rather than after 12. The honest cost is stated rather than
         * hidden: past twelve, ONE channel necessarily repeats — there are
         * only twelve hues — so two shelves may share a colour, and when they
         * do the glyph is what tells them apart. That is the two channels
         * degrading one at a time, which is what they were for. */
        let slot = hash(label) % n;
        let g = hash(label + "::glyph") % n;
        /* EACH CHANNEL IS EXHAUSTED BEFORE EITHER REPEATS. Walking the pair
         * space directly is enough to keep identities distinct, and it spends
         * the palette badly: twelve shelves came out wearing eight hues, so
         * colours started doubling up while four were still unused. Twelve or
         * fewer must still be twelve distinct hues AND twelve distinct glyphs,
         * exactly as before — the pair only does any work above that. */
        if (hues.size < n) for (let i = 0; i < n && hues.has(slot); i++) slot = (slot + 1) % n;
        if (glyphs.size < n) for (let i = 0; i < n && glyphs.has(g); i++) g = (g + 1) % n;
        for (let i = 0; i < n * n && taken.has(slot + ":" + g); i++) {
          g = (g + 1) % n;
          if (g === 0) slot = (slot + 1) % n;
        }
        taken.add(slot + ":" + g);
        hues.add(slot);
        glyphs.add(g);
        const [hue, sat, lit] = PALETTE[slot];
        out.set(label, { slot, hue, sat, lit, glyph: GLYPHS[g] });
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

  /* THE ROW'S TEXT IS THE TEXT COLUMN'S, NOT THE WHOLE <li>'s.
   *
   * `li.textContent` reads everything in the row including the half of it
   * nobody can see. MEASURED on a real signed-in profile: 472 characters
   * captured against 59 actually on screen — 87% of the search index was
   * GitHub's star-button machinery. The star control ships a confirmation
   * dialog, a "add this repository to a list" menu and an empty-state panel
   * as ordinary hidden DOM, so `star`, `starred` and `list` each matched
   * 77 OF 77 ROWS, and `sorry` matched 30. A find box that answers "all of
   * them" to a word the reader can see nowhere on the page is worse than no
   * find box: it is not obviously broken, it is just quietly useless.
   *
   * It is invisible signed OUT, where there are no star buttons at all —
   * the same reason two rounds of measurement missed the row-height bug.
   *
   * The fix costs nothing because the answer was already here: `column()`
   * finds the row's text column to place a note in, and that column is
   * exactly the half of the row that is prose — name, description, topics,
   * language, updated. The star column is the other child of the flex row
   * and is simply not read. A row whose markup we do not recognise falls
   * back to the whole <li>, which is where it was before. */
  S.rowText = function rowText(li) {
    return String(column(li).textContent || "").replace(/\s+/g, " ").trim();
  };

  /** The marker on its own, with no opinion about where it goes — the profile
   *  row places it in a text column, the repo page places it in a sidebar, and
   *  neither placement should be able to change how a note is edited. */
  S.noteMarker = function noteMarker(name, note, handlers) {
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
    return wrap;
  };

  function margin(li, name, note, handlers) {
    if (li.dataset.shMargin === "1") {
      const held = li.querySelector(".sh-margin");
      if (held) paintNote(held, note);
      return;
    }
    li.dataset.shMargin = "1";
    const col = column(li);
    /* THE FALLBACK'S CSS IS SCOPED TO THE FALLBACK. `flex-wrap: wrap` and a
     * 100%-basis child are what stop an unrecognised row from being crushed —
     * but they were applied to EVERY row in the host, including the great
     * majority where the margin went safely into a text column and no wrapping
     * was ever needed. That is a change to GitHub's own flex layout made far
     * beyond where it does any good, which is precisely what principle V says
     * not to do: move the DOM, do not rebuild it, and do not restyle rows you
     * are not touching. The flag marks the rows that genuinely need it. */
    if (col === li) li.dataset.shLoose = "1";
    /* THE CLASS IS WHAT LETS AN EMPTY NOTE COST THE ROW NOTHING. A marker for
     * a repo with no note is lifted out of flow and parked in the row's own
     * bottom padding, and an absolutely-positioned child needs a positioned
     * ancestor. Marking the column we chose — rather than styling every
     * `li > div` — keeps that `position: relative` on the one element we
     * actually put something inside (the same scar as `data-sh-loose`). */
    else col.classList.add("sh-col");
    place(col, S.noteMarker(name, note, handlers));
  }

  /* ---- moving a repo by hand (the override) ------------------------------
   * TWO WAYS TO THE SAME ONE WRITE, on purpose. Dragging is the gesture the
   * roadmap asks for and the one that feels like shelving; a menu is the one
   * that works from a keyboard, that a stub DOM can drive, and that does not
   * need a steady hand on a 77-row page. They call the same handler, so there
   * is one code path to be wrong.
   *
   * THE GRIP IS THE DRAG SOURCE, NOT THE ROW. Making GitHub's <li> draggable
   * means every link inside it competes for the gesture — the browser drags
   * the anchor's href and our data never gets set. A dedicated handle also
   * says where to take hold, which a whole-row drag never does.
   *
   * The menu offers only shelves that EXIST. A move is a move; inventing a
   * shelf is what `suggest` is for, and an override naming a shelf nothing
   * draws would put the row somewhere the page cannot show it. */
  function shelfNames(host) {
    return [...host.querySelectorAll("details.sh-shelf .sh-name")]
      .map((e) => e.textContent);
  }

  /** Re-home the row and fix both counts, without a reload. The write has
   *  already happened; this is the page catching up with it. */
  S.moveRow = function moveRow(host, li, label) {
    const shelf = [...host.querySelectorAll("details.sh-shelf")]
      .find((d) => (d.querySelector(".sh-name") || {}).textContent === label);
    if (!shelf) return false;
    const from = li.closest("details.sh-shelf");
    const ul = shelf.querySelector("ul");
    if (!ul || from === shelf) return false;
    ul.appendChild(li);
    shelf.open = true;
    [from, shelf].forEach((d) => {
      if (!d) return;
      const c = d.querySelector(".sh-count");
      /* `li[data-sh-name]` and not `li`: a repo row may contain a list of its
       * own — GitHub's star menu already ships one — and counting every
       * descendant made a two-row shelf report four. Only rows we stamped are
       * repositories. */
      if (c) c.textContent = String(d.querySelectorAll("li[data-sh-name]").length);
    });
    return true;
  };

  /** Every path that closes a menu goes through here, because the menu and the
   *  shelf's lifted overflow are two things that must never disagree. */
  function closeMenus(host) {
    host.querySelectorAll(".sh-shelflist").forEach((m) => m.remove());
    host.querySelectorAll("details.sh-shelf[data-menu]").forEach((d) => {
      delete d.dataset.menu;
    });
  }

  function mover(li, name, handlers) {
    const wrap = document.createElement("span");
    wrap.className = "sh-move";

    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "sh-grip";
    grip.textContent = "⠿";
    grip.draggable = true;
    grip.title =
      "Put this repo on a shelf yourself — drag it, or press for the list. " +
      "Kept in this browser; nothing is ever written to GitHub.";
    grip.setAttribute("aria-label", "Move " + name + " to a shelf");
    wrap.append(grip);

    grip.addEventListener("dragstart", (e) => {
      try {
        e.dataTransfer.setData("text/plain", name);
        e.dataTransfer.effectAllowed = "move";
        /* The row, not the grip, is what the reader thinks they are holding. */
        if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(li, 12, 12);
      } catch (err) { /* a browser that will not carry data still opens the menu */ }
      const host = li.closest("#" + S.HOST_ID);
      if (host) host.dataset.dragging = "1";
    });
    grip.addEventListener("dragend", () => {
      const host = li.closest("#" + S.HOST_ID);
      if (host) delete host.dataset.dragging;
    });

    grip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const host = li.closest("#" + S.HOST_ID);
      if (!host) return;
      const open = wrap.querySelector(".sh-shelflist");
      /* One list at a time: two open menus on a long page is two places the
         next click could mean something. */
      closeMenus(host);
      if (open) return;
      const labels = shelfNames(host);
      /* `flat list` removes every <details>, so there is nothing to offer and
       * an empty menu is a dead affordance the reader has to close again. */
      if (!labels.length) return;
      const menu = document.createElement("span");
      menu.className = "sh-shelflist";
      const here = (li.closest("details.sh-shelf") || {}).querySelector
        ? (li.closest("details.sh-shelf").querySelector(".sh-name") || {}).textContent
        : "";
      labels.forEach((label) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sh-shelfpick";
        b.textContent = label;
        if (label === here) b.dataset.here = "1";
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          closeMenus(host);
          if (label !== here) handlers.override(name, label, li);
        });
        menu.append(b);
      });
      wrap.append(menu);
      /* ── THE SHELF CLIPS ITS OWN CHILDREN ────────────────────────────────
       * `.sh-shelf` carries `overflow: hidden` for its rounded corners, which
       * makes it a clip container — so a menu opened on a row near the bottom
       * of a shelf is CUT OFF, and the entries past the edge cannot be
       * clicked at all. Measured on the live page: the menu overhung its
       * shelf by 26px and `elementFromPoint` on the last entry returned the
       * NEXT shelf's summary. Exactly the trap that a sticky shelf header
       * walks into, for exactly the same reason.
       *
       * Lifted only while a menu is open, and only on the one shelf holding
       * it: the corner clipping every other shelf relies on is untouched, and
       * the moment the menu closes so does this. */
      const shelf = li.closest("details.sh-shelf");
      if (shelf) shelf.dataset.menu = "1";
      const first = menu.querySelector(".sh-shelfpick");
      if (first) first.focus();
    });

    return wrap;
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
  /**
   * @param {Element} host
   * @param {string}  raw    what the reader typed, or the label of a set
   * @param {?object} only   {names: Set|string[], label} — address rows BY NAME
   *                         instead of by text
   *
   * TWO WAYS TO ADDRESS A ROW, because the audit asks a question no query can
   * express. "the 12 repos with no description" is not a substring; there is
   * no text a reader could type that means it. Faking one — searching for the
   * empty string, or joining twelve names with a pipe — would put a lie in the
   * find box and break the moment a name contained the separator. So a set of
   * names is its own mode, the box goes empty and says what is being shown,
   * and the reader's next keystroke drops straight back into text search.
   */
  S.applyFilter = function applyFilter(host, raw, only) {
    const q = String(raw || "").trim().toLowerCase();
    const set = only && only.names
      ? new Set([...only.names].map((n) => String(n).toLowerCase()))
      : null;
    const active = set ? set.size > 0 : !!q;
    let shown = 0, total = 0;

    /* THE ROWS ARE FILTERED FIRST AND THE SHELVES SECOND, because in flat mode
     * there are no shelves at all — `flat list` removes every <details> and
     * pours the rows into one <ul>. Walking shelves to reach rows made the box
     * silently inert there and, worse, made it report "0 of 0" while the
     * reader typed into a list it was no longer touching. */
    host.querySelectorAll("li").forEach((li) => {
      if (li.dataset.shHay === undefined) return;   // not one of ours
      total++;
      const hit = set
        ? set.has(li.dataset.shName || "")
        : (!q || li.dataset.shHay.indexOf(q) !== -1);
      li.classList.toggle("sh-hide", !hit);
      if (hit) shown++;
    });

    host.querySelectorAll("details.sh-shelf").forEach((d) => {
      const held = [...d.querySelectorAll("li")];
      const count = held.length;
      const hits = held.filter((li) => !li.classList.contains("sh-hide")).length;

      const c = d.querySelector(".sh-count");
      if (c) c.textContent = active ? hits + " / " + count : String(count);
      /* A shelf with no match is dimmed rather than removed: the shelves are
       * the map, and a map that reshuffles under a search is harder to read
       * than one that greys out. */
      d.classList.toggle("sh-nomatch", active && hits === 0);

      /* FILTERING OPENS SHELVES, AND MUST NOT REMEMBER DOING SO. Searching
       * forces a shelf open to show its hits; without this the `toggle`
       * listener would write that to the collapse store and a cleared search
       * would leave every shelf you had closed hanging open forever. So the
       * real state is parked on the first keystroke and put back on the last.
       *
       * `active`, not `q`: a name-set filter opens shelves exactly as a typed
       * one does, and reading the typed query here would have parked the state
       * on the way in and never restored it on the way out. */
      if (active) {
        if (d.dataset.shWasOpen === undefined) d.dataset.shWasOpen = d.open ? "1" : "0";
        d.open = hits > 0;
      } else if (d.dataset.shWasOpen !== undefined) {
        d.open = d.dataset.shWasOpen === "1";
        delete d.dataset.shWasOpen;
      }
    });

    const bar = host.querySelector(".sh-found");
    if (bar) {
      bar.textContent = !active ? ""
        : (only && only.label)
          ? shown + " " + only.label + " of " + total
          : shown + " of " + total;
    }
    host.dataset.filtering = active ? "1" : "";
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
    const overrides = ctx.overrides || {};
    const { buckets, order } = S.bucket(rows, topics, settings, names, overrides);
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
      if (li.dataset.shText === undefined) li.dataset.shText = S.rowText(li);
      margin(li, name, note, handlers);
      /* The grip rides in the note margin rather than getting a place of its
       * own: that element is already in the row's text column, already
       * revealed on hover, and already measured not to change the row's
       * height. A second such affordance would be a second thing to get
       * wrong in the same 22px. */
      const held = li.querySelector(".sh-margin");
      if (held && handlers.override && ctx.mine !== false &&
          !held.querySelector(".sh-move")) {
        held.insertBefore(mover(li, name, handlers), held.firstChild);
      }
      li.dataset.shName = name;      // how the audit's findings address a row
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

    /* ── READ N MORE — the ceiling, drawn as the choice it is ───────────────
     * Rung 4 reads one page per repo, and it now stops at `scrapeMax`. This
     * button is the other half of that: the deferred repos are named, counted,
     * and one press away — so a large read is something the reader asks for
     * rather than something that happens to them.
     *
     * IT IS A BUTTON AND NOT A WARNING. Nothing went wrong; the amber sentence
     * beside it is for token rejections and rate limits, and putting a
     * deliberate limit there would teach the reader to read a choice as a
     * fault. It exists only when there is something to read, so a normal run
     * never carries it. */
    const more = ctx.deferred > 0
      ? button("read " + ctx.deferred + " more",
               ctx.deferred + " repositories were left unread to keep this page " +
               "load small. Reading them costs one request each, and they are " +
               "remembered afterwards.")
      : null;

    /* ONE BUTTON FOR TWO QUESTIONS, because they are two questions about one
     * collection — what is wrong with the labels (vocab.js) and what is
     * missing from the repositories (audit.js) — and nobody wakes up wanting
     * only one of them. A second button would also have to go somewhere, and
     * this bar already wraps at 1200px.
     *
     * IT IS BADGED BEFORE IT IS OPENED. A panel nobody opens tells nobody
     * anything, and the premise of both halves is that these problems are
     * invisible; so the count rides on the CLOSED button and the reader learns
     * there are six things to look at without deciding to look. */
    const vocab = button("audit",
      "Your collection, read back to you: duplicate topic spellings, blanket " +
      "labels, and the repos missing a description, a README or a licence.");
    const vdata = S.vocabulary(topics, names);
    const adata = S.audit(facts, names, topics);
    const issues = S.vocabIssues(vdata) + S.auditIssues(adata);
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
    /* THE CANARY GOES WHERE THE OTHER BAD NEWS GOES. It is the same kind of
     * statement as "token rejected (401)" — something upstream is not what we
     * assumed — and giving it its own banner would teach the reader to look in
     * two places for one class of problem. It is drawn louder than a warning
     * when it is grave, because a moved sidebar means every shelf on the page
     * is wrong, and that is not a footnote. */
    if (ctx.health) {
      const h = document.createElement("span");
      h.className = "sh-warn sh-canary";
      h.textContent = ctx.health;
      note.append(" · ", h);
    }

    bar.append(expand, collapse, flat, rescan);
    if (more) bar.append(more);
    bar.append(vocab, find, found, note);
    host.appendChild(bar);

    /* ---- SUGGESTED SHELVES -----------------------------------------------
     * The first run for someone who has never tagged a repo produces the page
     * they already had: one shelf, called Ungrouped, holding all of them. The
     * audit has always been able to SAY that; this is the first thing in the
     * product that hands them something to press about it.
     *
     * It sits above the shelves and below the toolbar because it is about the
     * shelves that do not exist yet — and it goes away entirely once there is
     * nothing left to offer, rather than becoming a permanent rail. */
    /* Already answered: on a real shelf by topic, by a configured group, or
     * because the reader put it there. `bucketFor` is the one authority on
     * that question and it is the same call the shelving used. */
    const placed = new Set(
      names.filter((n, i) =>
        n && S.bucketFor(topics[i] || [], settings, overrides[n]) !== settings.otherLabel)
        .map((n) => n.toLowerCase())
    );
    const sugs = (handlers.addShelf && ctx.mine !== false)
      ? S.suggestions(vdata, facts, names, settings, placed) : [];
    if (sugs.length) {
      const strip = document.createElement("div");
      strip.className = "sh-suggest";
      const lead = document.createElement("span");
      lead.className = "sh-sug-lead";
      lead.textContent = settings.groups.length ? "also worth a shelf" : "start here";
      strip.append(lead);
      sugs.forEach((sug) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sh-sug";
        b.dataset.kind = sug.kind;
        b.append(document.createTextNode("add "));
        const strong = document.createElement("b");
        strong.textContent = sug.label;
        b.append(strong, document.createTextNode(" (" + sug.count + ")"));
        b.title = sug.why +
          (sug.kind === "topic"
            ? " — matched by topic, exactly like a shelf you type in options"
            : " — these " + sug.count + " repos are pinned to it in this browser, " +
              "because a name or a language is not a topic GitHub can match");
        b.addEventListener("click", async () => {
          const was = b.textContent;
          b.disabled = true;
          b.textContent = "adding " + sug.label + "…";
          /* THE SHELVES ALREADY ON SCREEN GO WITH IT. From a cold start these
           * are auto-derived — `settings.groups` is empty and every shelf here
           * came from a topic. Writing one group flips the page into
           * configured mode, where a repo that matches no group is leftovers:
           * accepting one suggestion would silently DELETE every shelf the
           * reader could already see. Measured on the live page — accepting
           * `wiremock` took the `config` shelf with it. */
          const res = await handlers.addShelf(
            sug, order.filter((l) => l !== settings.otherLabel));
          /* A successful accept RELOADS (the storage listener sees `groups`),
           * so reaching this line at all means the write was refused. Put the
           * button back and say so, rather than leaving "adding…" forever on
           * a page that will never change. */
          if (!res || !res.ok) {
            b.disabled = false;
            b.textContent = was;
            b.title = "that could not be saved — your browser refused the " +
                      "write. Try again in a moment.";
          }
        });
        strip.append(b);
      });
      host.appendChild(strip);
    }

    /* Built once and toggled, not rebuilt: the panel holds the reader's place
     * in a long topic list, and re-creating it on every press would scroll
     * them back to the top of their own vocabulary. */
    /* Untagged is a fact about the TOPICS, not about the leftovers shelf: a
     * repo the reader has pinned by hand is off that shelf and still untagged,
     * and it is still worth tagging. */
    const untagged = names.filter((n, i) => n && !(topics[i] || []).length);

    const marks = S.identity(order, settings.otherLabel);
    let panel = null;
    vocab.addEventListener("click", () => {
      if (panel) {
        panel.hidden = !panel.hidden;
        if (panel.hidden) delete vocab.dataset.on;
        else vocab.dataset.on = "1";
        return;
      }
      const kit = S.panelKit({
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
        /* An audit finding cannot be a query, so it addresses rows by name.
         * The box is emptied rather than filled with something unreadable —
         * and the next keystroke drops straight back into text search, which
         * is the only behaviour that does not need explaining. */
        onRepos: (names_, label) => {
          find.value = "";
          S.applyFilter(host, "", { names: names_, label });
        },
      });
      panel = document.createElement("div");
      panel.className = "sh-vocab";
      const head = document.createElement("div");
      head.className = "sh-v-head";
      const title = document.createElement("span");
      title.className = "sh-v-title";
      title.textContent = "audit";
      const sum = document.createElement("span");
      sum.className = "sh-v-sum";
      sum.textContent = rows.length + " repos · nothing here was fetched for this";
      head.append(title, sum);
      panel.append(head);
      S.vocabSection(vdata, kit).forEach((n) => panel.append(n));
      S.auditSection(adata, kit).forEach((n) => panel.append(n));
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

      /* ---- THE WORKBENCH -------------------------------------------------
       * Ungrouped is where the extension currently gives up, and on an
       * untagged account it is the whole page. The one thing that would fix it
       * for good is topics on GitHub — which P.I forbids us to write, and
       * which is a two-click job the reader can do in a second IF they are
       * standing on the repo.
       *
       * So the funnel is the walk: press it and the next untagged repo opens
       * in its own tab. ONE AT A TIME, never a fan of thirty tabs — this is
       * a task you leave and come back to, and the count on the button is
       * where you left off. */
      if (label === settings.otherLabel && untagged.length &&
          handlers.walk && ctx.mine !== false) {
        const bench = document.createElement("button");
        bench.type = "button";
        bench.className = "sh-bench";
        /* Wrapped the same way `walk` wraps it, or the label and the tab
         * disagree the moment the untagged list shrinks under a stale
         * bookmark — which is exactly what tagging a repo does. */
        const done = () => S.bench.at(owner) % untagged.length;
        const paint = () => {
          bench.textContent = done()
            ? "tag them · " + (done() + 1) + " of " + untagged.length
            : untagged.length + " untagged · tag them";
        };
        paint();
        bench.title =
          "Opens the next untagged repository in a new tab. Add its topics in " +
          "the About panel and they show up here — SHELVES never writes to GitHub.";
        bench.addEventListener("click", (e) => {
          /* Inside a <summary>: without both of these the shelf also toggles,
             so the reader loses their place every time they tag a repo. */
          e.preventDefault();
          e.stopPropagation();
          handlers.walk(untagged, owner);
          paint();
        });
        sum.append(bench);
      }

      d.appendChild(sum);

      const ul = document.createElement("ul");
      ul.className = sourceUl.className;
      ul.dataset[S.DONE] = "1"; // guard two: the finder must never take this back
      list.forEach((li) => ul.appendChild(li));
      d.appendChild(ul);

      /* THE WHOLE SHELF IS THE TARGET, not just its summary. A closed shelf is
       * a one-line strip and a 4px miss drops the row on the page instead;
       * an open one is most of the screen and its rows are the obvious place
       * to aim. `dragover` must preventDefault or the drop never fires — the
       * default is "this is not a drop zone". */
      if (handlers.override && ctx.mine !== false) {
        d.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          d.dataset.over = "1";
        });
        d.addEventListener("dragleave", (e) => {
          if (!d.contains(e.relatedTarget)) delete d.dataset.over;
        });
        d.addEventListener("drop", (e) => {
          e.preventDefault();
          delete d.dataset.over;
          let who = "";
          try { who = e.dataTransfer.getData("text/plain"); } catch (err) { who = ""; }
          /* Matched by walking the rows rather than by building a selector.
           * `CSS.escape` is the obvious way and it is not available
           * everywhere a harness might run this — which is how the headline
           * gesture ended up with no test at all: the listener threw
           * `ReferenceError` before it could do anything, and a lost drop
           * looks exactly like a drop that missed. */
          const li = who && [...host.querySelectorAll("li[data-sh-name]")]
            .find((x) => x.dataset.shName === who);
          if (li) handlers.override(who, label, li);
        });
      }

      d.addEventListener("toggle", () => {
        // a shelf the FILTER opened is not a shelf the reader opened
        if (host.dataset.filtering === "1") return;
        const state = S.collapse.read(owner);
        state[label] = d.open;
        S.collapse.write(owner, state);
      });

      host.appendChild(d);
    });

    /* WHAT THIS PAGE WORKED OUT, LEFT WHERE THE OTHER PAGES CAN READ IT.
     * A repo's own page can see its own topics but not its neighbours', and
     * both the shelf a repo lands on and — more sharply — the COLOUR that
     * shelf wears are properties of the whole collection: `identity()` resolves
     * palette collisions across every label at once. So the page that knows
     * writes it down, and the pages that cannot work it out read it rather than
     * guessing a different answer. Derived, disposable, rewritten every render.
     *
     * Fire and forget: a failed write costs the chip its colour on another
     * page and must never cost this render (P.III). */
    Promise.resolve(
      S.shelfmap.write(owner, {
        order,
        counts: Object.fromEntries(order.map((l) => [l, buckets.get(l).length])),
        names: names.filter(Boolean),
      })
    ).catch(() => {});

    expand.addEventListener("click", () =>
      host.querySelectorAll("details").forEach((d) => (d.open = true))
    );
    collapse.addEventListener("click", () =>
      host.querySelectorAll("details").forEach((d) => (d.open = false))
    );
    rescan.addEventListener("click", () => handlers.rescan());
    if (more) more.addEventListener("click", () => handlers.more());

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
