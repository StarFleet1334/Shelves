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
  S.bucketFor = function bucketFor(topics, settings, override, facts, specs) {
    const own = String(override == null ? "" : override).trim();
    if (own) {
      /* A CONFIGURED SHELF OWNS THE SPELLING OF ITS OWN NAME. An override is
       * stored verbatim, and the label it was stored with is whatever was
       * drawn at the time — so re-casing a group in the options page later
       * (`keep` -> `Keep`) would leave the pinned repos in a second shelf of
       * their own, beside the one they were put on. Matching case-insensitively
       * and returning the CONFIGURED spelling keeps one shelf one shelf,
       * without rewriting anything the reader stored. */
      const same = (specs || S.shelfSpecs(settings))
        .map((sp) => sp.label)
        .concat([settings.otherLabel])
        .find((g) => g && g.toLowerCase() === own.toLowerCase());
      return same || own;
    }
    if (settings.groups.length) {
      /* FIRST MATCH STILL WINS, and a rule shelf is tried exactly where its
       * entry sits in the list — so the reader's order is the precedence and
       * there is nothing new to learn. `specs` is passed in when the caller
       * has already parsed them (once per render, per the roadmap); parsing
       * here is the fallback for the callers that have one repo and no list. */
      const list = specs || S.shelfSpecs(settings);
      const hit = list.find((sp) =>
        sp.kind === "rule"
          ? S.matchRule(sp.rule, facts, topics).yes
          : topics.indexOf(sp.label.toLowerCase()) !== -1);
      return hit ? hit.label : settings.otherLabel;
    }
    // No configured shelves: auto-group by the repo's first topic, alphabetical,
    // so the same repo always lands on the same shelf between loads.
    return topics.length ? topics.slice().sort()[0] : settings.otherLabel;
  };

  /* ---- THE SHELVES A ROW ALSO MATCHED ------------------------------------
   * First match wins the row, and it has to: a repo on two shelves is two
   * counts that do not add up and a page you cannot scan once. But the
   * information that rule throws away is real — `wiremock-api` is on `tooling`
   * AND would have been on `java`, and knowing that is most of what a reader
   * wants when they wonder why a shelf looks thin.
   *
   * So the losing matches are given back as chips. They are drawn, not
   * clickable-to-move: pressing one would mean "put it there", which is what
   * the grip is for and would quietly become a second way to write an
   * override. */
  S.siblingsFor = function siblingsFor(topics, settings, facts, specs, won) {
    const list = specs || S.shelfSpecs(settings);
    return list
      .filter((sp) => sp.label !== won)
      .filter((sp) =>
        sp.kind === "rule"
          ? S.matchRule(sp.rule, facts, topics).yes
          : (topics || []).indexOf(sp.label.toLowerCase()) !== -1)
      .map((sp) => sp.label);
  };

  S.bucket = function bucket(rows, topics, settings, names, overrides, facts, opts) {
    const ov = overrides || {};
    const who = names || [];
    const fs = facts || [];
    /* PARSED ONCE for the whole page, not once per row — which is the roadmap's
     * own wording and the difference between a rule shelf and a search. */
    const specs = S.shelfSpecs(settings);
    const buckets = new Map();
    /* HOW MANY REPOS A RULE COULD NOT JUDGE. A term naming a field this repo's
     * SOURCE cannot carry is not false, it is unanswered — and a shelf that
     * quietly drops those is a shelf whose contents the reader cannot explain.
     * Counted here, stated on the header. */
    const unjudged = new Map();
    const pinned = (opts && opts.pins) || {};
    rows.forEach((li, i) => {
      const key = S.bucketFor(topics[i] || [], settings, ov[who[i]], fs[i], specs);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(li);
      li.dataset.shPin = pinned[who[i]] ? "1" : "";
      /* COUNTED OVER EVERY ROW, not only the ones that reached the leftovers
       * shelf. A repo this rule could not judge may still have matched an
       * EARLIER shelf and be sitting there — and it is still a repo this rule
       * has no opinion about, which is what the number claims to say. */
      specs.forEach((sp) => {
        if (sp.kind !== "rule" || sp.label === key) return;
        if (S.matchRule(sp.rule, fs[i], topics[i] || []).unknown) {
          unjudged.set(sp.label, (unjudged.get(sp.label) || 0) + 1);
        }
      });
    });

    let order;
    if (settings.groups.length) {
      /* ONE SHELF PER LABEL. Two entries sharing a name — a topic `ai` beside
       * a rule `ai = lang:python`, or two rules truncated to the same 60
       * characters — built the same `<details>` twice, and the second build
       * re-parented the rows out of the first: a phantom empty shelf with a
       * non-zero count printed on it. Reachable without hand-editing anything,
       * because a suggestion is deduped against the whole entry string. */
      const seen = new Set();
      order = specs
        .map((sp) => sp.label)
        .filter((g) => !seen.has(g) && seen.add(g))
        /* A RULE SHELF THAT MATCHED NOTHING IS STILL DRAWN IF IT HAS SOMETHING
         * TO SAY. `an honest empty shelf with a stated count of unjudged
         * repos beats a confident wrong one` — but a shelf with no members was
         * dropped from the order, so on exactly the collection that motivated
         * the rule (scraped, no language, no dates) the page said nothing at
         * all. It is drawn empty, carrying its count. */
        .filter((g) => buckets.has(g) || unjudged.get(g));
      order.forEach((g) => { if (!buckets.has(g)) buckets.set(g, []); });
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

    /* PINNED ROWS RISE, AND NOTHING ELSE MOVES. A stable partition rather than
     * a sort: GitHub's own order inside a shelf is the reader's `Sort` setting
     * and is not ours to rearrange — the only claim being made here is "these
     * few first". */
    buckets.forEach((list, label) => {
      const up = list.filter((li) => li.dataset.shPin === "1");
      if (!up.length || up.length === list.length) return;
      /* IN THE ORDER THEY WERE PINNED, which is the order the reader watched
       * them rise in. Sorting the pinned block by GitHub's source order
       * instead meant the page rearranged itself on the next load: pin `c`
       * then `a` and the session showed `c,a` while the reload showed `a,c`.
       * The store keeps a stamp per pin for exactly this; a legacy `true`
       * sorts first, since it was pinned before any of them. */
      const at = (li) => {
        const v = pinned[li.dataset.shName];
        return typeof v === "number" ? v : 0;
      };
      up.sort((a, b) => at(a) - at(b));
      buckets.set(label, up.concat(list.filter((li) => li.dataset.shPin !== "1")));
    });

    return { buckets, order, specs, unjudged };
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

  /* ---- the shelves this row ALSO matched ---------------------------------
   * Drawn into the note margin rather than given a line of its own, for the
   * reason that element already exists: on a row with no note it is parked in
   * the 24px of padding GitHub leaves under every row, so this costs the row
   * NO HEIGHT — which is the difference between information and a redesign.
   * (Measured once already, at length: 22px per row over 77 rows is a screen
   * and a quarter of scrolling.) */
  function siblingChips(labels) {
    const wrap = document.createElement("span");
    wrap.className = "sh-sibs";
    labels.slice(0, 4).forEach((label) => {
      const chip = document.createElement("span");
      chip.className = "sh-sib";
      chip.textContent = label;
      wrap.append(chip);
    });
    if (labels.length > 4) {
      const more = document.createElement("span");
      more.className = "sh-sib sh-sib-more";
      more.textContent = "+" + (labels.length - 4);
      wrap.append(more);
    }
    wrap.title = "Also matched: " + labels.join(", ") +
      ". First match wins the row, so it is shelved once — this is where the " +
      "rest of the answer went.";
    return wrap;
  }

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

  /** Pinning moves the row to the top of the shelf it is already on; unpinning
   *  drops it back below the pinned ones. The write has happened; this is the
   *  page catching up, exactly as `moveRow` is for a move. */
  S.repin = function repin(host, li, on) {
    li.dataset.shPin = on ? "1" : "";
    const ul = li.parentElement;
    if (!ul) return false;
    if (on) {
      /* Below the rows already pinned, so pinning three in a row does not
       * silently reverse them. */
      const after = [...ul.children].filter((x) => x.dataset.shPin === "1" && x !== li);
      ul.insertBefore(li, after.length ? after[after.length - 1].nextSibling : ul.firstChild);
    } else {
      const first = [...ul.children].find((x) => x.dataset.shPin !== "1" && x !== li);
      ul.insertBefore(li, first || null);
    }
    return true;
  };

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

      /* THE TOP OF THE SHELF IS PART OF WHERE A REPO GOES, so it is offered
       * by the same control that moves it rather than getting a second
       * affordance of its own. It is the first entry because it is the one
       * that acts on the shelf the row is already on. */
      if (handlers.pin) {
        const up = document.createElement("button");
        up.type = "button";
        up.className = "sh-shelfpick sh-pinpick";
        const on = li.dataset.shPin === "1";
        up.textContent = on ? "⚑ unpin" : "⚑ pin to top";
        up.title = on
          ? "Let it sit in GitHub's own order again"
          : "Keep this one at the top of its shelf. Held in this browser.";
        up.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          closeMenus(host);
          handlers.pin(name, li);
        });
        menu.append(up);
      }
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
    /* ── KEPT ACROSS GITHUB'S OWN FILTERS ──────────────────────────────────
     * Type and Language do not navigate; they swap the rows out from under us
     * and our host with them, and the reader's query goes with it — measured:
     * `"wire"`, 3 of 54, 51 rows hidden, all of it gone half a second later.
     * The JS context survives, so the query can. Two filters the reader set
     * deliberately are two filters they meant, which is what composing them
     * means. */
    S.lastFilter = active ? { q: raw || "", only: only || null } : null;
    return { shown, total };
  };

  /**
   * Builds the whole replacement subtree. Pure construction: it does not touch
   * the live page, so main.js owns the single swap.
   */
  S.render = function render(ctx) {
    const { rows, settings, sourceUl, owner, handlers } = ctx;
    const names = ctx.names || [];
    /* MUTABLE, because the page is rendered in two passes and the second one
     * replaces exactly these. `rows` and `names` are NOT in this list and must
     * never be: `li.dataset.shName = names[i]` is index-parallel and unguarded,
     * so a second pass over a different row set would stamp every row with the
     * wrong repository — and the drop target, the override handler and the
     * audit's by-name filter all address rows by that stamp. */
    /* ONE CLOCK FOR THE WHOLE RENDER, so two shelves cannot disagree about
     * what "stale" means by a few milliseconds. */
    const now = ctx.now || Date.now();
    const lastSeen = ctx.lastSeen || 0;
    let health = ctx.health;
    let topics = ctx.topics;
    let facts = ctx.facts || [];
    let notes = ctx.notes || {};
    let overrides = ctx.overrides || {};
    let source = ctx.source;
    let warning = ctx.warning;
    let deferred = ctx.deferred;
    let pins = ctx.pins || {};
    let { buckets, order, specs, unjudged } =
      S.bucket(rows, topics, settings, names, overrides, facts, { pins });
    const open = S.collapse.read(owner);

    /* Repainted on the second pass, because which shelves a row also matched
     * is one of the things the ladder changes its mind about. */
    const paintSiblings = (li, i) => {
      const held = li.querySelector(".sh-margin");
      if (!held) return;
      const had = held.querySelector(".sh-sibs");
      if (had) had.remove();
      if (!settings.groups.length) return;   // auto-grouping has one shelf per topic
      const won = S.bucketFor(topics[i] || [], settings,
                              overrides[names[i]], facts[i], specs);
      const also = S.siblingsFor(topics[i] || [], settings, facts[i], specs, won);
      if (also.length) held.append(siblingChips(also));
    };

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
      paintSiblings(li, i);
      li.dataset.shName = name;      // how the audit's findings address a row
      li.dataset.shHay = S.haystack(li.dataset.shText, facts[i], note);
    });

    const host = document.createElement("div");
    host.id = S.HOST_ID;
    /* Read before the first paint, not applied afterwards: setting it later
       would draw the roomy page and then collapse it under the reader. */
    host.dataset.density = S.density.read(owner);

    const bar = document.createElement("div");
    bar.className = "sh-bar";

    const expand = button("expand all");
    const collapse = button("collapse all");
    const flat = button("flat list", "GitHub's plain ungrouped list");
    const rescan = button("rescan", "Forget cached facts and read them again");

    /* ---- DENSITY ---------------------------------------------------------
     * GitHub draws a repository row 109px tall — a description it may not
     * have, a topic row it may not have, and 24px of padding either side. On
     * a 77-repo account that is eight screens of scrolling to read a list,
     * and the shelves cannot help with it because the shelves are not what is
     * tall.
     *
     * Compact is a READING POSTURE and it is CSS only: nothing is removed
     * from the row, nothing is rebuilt, and every field GitHub adds next year
     * still arrives (P.V). Toggling it costs one attribute on the host. */
    const density = button("", "");
    const paintDensity = () => {
      const on = host.dataset.density === "compact";
      density.textContent = on ? "roomy" : "compact";
      density.dataset.on = on ? "1" : "";
      density.title = on
        ? "Back to GitHub's own spacing — descriptions, topics and all"
        : "One line per repository: the description, the topic chips and the " +
          "commit graph stand down so more of the list fits on a screen";
    };
    paintDensity();

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
    /* Built always and SHOWN when there is something to offer: the first pass
     * cannot know how many repos rung 4 will defer, so a button that only
     * exists if it existed at build time could never appear. */
    const more = button("", "");
    const paintMore = () => {
      more.hidden = !(deferred > 0);
      if (more.hidden) return;
      more.textContent = "read " + deferred + " more";
      more.title = deferred + " repositories were left unread to keep this page " +
        "load small. Reading them costs one request each, and they are " +
        "remembered afterwards.";
    };
    paintMore();

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
    let vdata = S.vocabulary(topics, names);
    let adata = S.audit(facts, names, topics);
    /* THE COUNT RIDES ON THE CLOSED BUTTON, and on a progressive render it is
     * a count that grows: the cache knows nothing about a repo it has never
     * read, so the first pass under-reports and must correct itself rather
     * than settle for the smaller, friendlier number. */
    const paintBadge = () => {
      const issues = S.vocabIssues(vdata) + S.auditIssues(adata);
      const had = vocab.querySelector(".sh-vbadge");
      if (had) had.remove();
      if (!issues) return;
      const badge = document.createElement("span");
      badge.className = "sh-vbadge";
      badge.textContent = String(issues);
      vocab.append(" ", badge);
    };
    paintBadge();

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
    /* ONE FUNCTION, CALLED TWICE. The source line is the sentence P.IV is
     * about, and a progressive render makes it a sentence that CHANGES — from
     * what the cache could answer to what the ladder actually climbed. Building
     * it in place means the two passes can never drift into two different
     * spellings of the same fact. */
    const paintNote2 = () => {
      note.textContent = "";
      const tagged = topics.filter((t) => t && t.length).length;
      note.append(rows.length + " repos · " + order.length + " shelves · " +
                  tagged + " tagged · via " + source);
      /* A RULE THAT CANNOT BE READ IS SAID OUT LOUD. `lang:python topc:ai` is a
       * typo, and a shelf that silently ignores a third of itself leaves the
       * reader looking at contents they cannot explain — the same class of
       * silence P.IV exists to forbid. */
      const broken = (specs || [])
        .filter((sp) => sp.kind === "rule" && sp.rule.bad.length)
        .map((sp) => sp.label + ": " + sp.rule.bad.join(" "));
      if (broken.length) {
        const b = document.createElement("span");
        b.className = "sh-warn";
        b.textContent = "unreadable in " + broken.join(" · ");
        note.append(" · ", b);
      }
      if (warning) {
        const w = document.createElement("span");
        w.className = "sh-warn";
        w.textContent = warning;
        note.append(" · ", w);
      }
      if (health) {
        const h = document.createElement("span");
        h.className = "sh-warn sh-canary";
        h.textContent = health;
        note.append(" · ", h);
      }
    };
    paintNote2();
    /* THE CANARY GOES WHERE THE OTHER BAD NEWS GOES. It is the same kind of
     * statement as "token rejected (401)" — something upstream is not what we
     * assumed — and giving it its own banner would teach the reader to look in
     * two places for one class of problem. It is drawn louder than a warning
     * when it is grave, because a moved sidebar means every shelf on the page
     * is wrong, and that is not a footnote. */

    bar.append(expand, collapse, density, flat, rescan, more, vocab, find, found, note);
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
    const paintSuggestions = () => {
      const placed = new Set(
        names.filter((n, i) =>
          n && S.bucketFor(topics[i] || [], settings, overrides[n], facts[i], specs) !==
            settings.otherLabel)
          .map((n) => n.toLowerCase())
      );
      const sugs = (handlers.addShelf && ctx.mine !== false)
        ? S.suggestions(vdata, facts, names, settings, placed) : [];
      const had = host.querySelector(".sh-suggest");
      if (had) had.remove();
      if (!sugs.length) return;
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
      /* Always directly under the toolbar, however it got here — `appendChild`
       * would put a repainted strip below the shelves. */
      bar.insertAdjacentElement("afterend", strip);
    };
    paintSuggestions();

    /* Built once and toggled, not rebuilt: the panel holds the reader's place
     * in a long topic list, and re-creating it on every press would scroll
     * them back to the top of their own vocabulary. */
    /* Untagged is a fact about the TOPICS, not about the leftovers shelf: a
     * repo the reader has pinned by hand is off that shelf and still untagged,
     * and it is still worth tagging. */
    let untagged = names.filter((n, i) => n && !(topics[i] || []).length);

    let marks = S.identity(order, settings.otherLabel);
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
          onlySet = null;
          S.applyFilter(host, topic);
          find.focus();
        },
        /* An audit finding cannot be a query, so it addresses rows by name.
         * The box is emptied rather than filled with something unreadable —
         * and the next keystroke drops straight back into text search, which
         * is the only behaviour that does not need explaining. */
        onRepos: (names_, label) => {
          find.value = "";
          onlySet = { names: names_, label };
          S.applyFilter(host, "", onlySet);
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

    /* ---- THE WORKBENCH -------------------------------------------------
     * Ungrouped is where the extension gives up, and on an untagged account it
     * is the whole page. The one thing that fixes it for good is topics on
     * GitHub — which P.I forbids us to write, and which is a two-click job the
     * reader can do in a second IF they are standing on the repo.
     *
     * So the funnel is the walk: press it and the next untagged repo opens in
     * its own tab. ONE AT A TIME, never a fan of thirty tabs — this is a task
     * you leave and come back to, and the count on the button is where you
     * left off.
     *
     * A FUNCTION because the untagged list is one of the things the second
     * pass learns: a cache-shelved page thinks half the collection is untagged
     * until the ladder says otherwise. */
    const makeBench = (label) => {
      if (label !== settings.otherLabel || !untagged.length ||
          !handlers.walk || ctx.mine === false) return null;
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
      return bench;
    };

    /* ---- WHAT A SHELF IS WORTH -------------------------------------------
     * A count is the least a shelf header could say. The records are already
     * here — `facts.js` harvests ten fields from the request the ladder was
     * making anyway — and three of them answer the questions a reader actually
     * has about a group of repositories: how much of my collection is this,
     * how much of it has gone cold, and what moved.
     *
     * `N since you were here` IS THE ONE GITHUB CANNOT SAY. It knows when
     * every repo was pushed; it has no idea when you last looked. That
     * sentence only exists in something living in your browser.
     *
     * IT SAYS NOTHING RATHER THAN ZERO. Rung 1 records carry no stars and no
     * dates, so on a page the chips answered there is no weight to show — and
     * `★ 0 · 0 stale` would be a statement about the collection when it is a
     * statement about the source. `carries()` is the same test the audit uses
     * for the same reason. */
    const STALE_DAYS = 365;
    const weighOf = (list) => {
      let stars = 0, hasStars = false, stale = 0, fresh = 0, dated = 0;
      list.forEach((li) => {
        const i = rows.indexOf(li);
        const f = i >= 0 ? facts[i] : null;
        if (!f) return;
        if (S.carries(f.via, "stars") && typeof f.stars === "number") {
          stars += f.stars;
          hasStars = true;
        }
        if (S.carries(f.via, "updated") && typeof f.updated === "number") {
          dated++;
          if ((now - f.updated) / 86400000 > STALE_DAYS) stale++;
          if (lastSeen && f.updated > lastSeen) fresh++;
        }
      });
      return { stars, hasStars, stale, fresh, dated };
    };

    const paintWeight = (d, label) => {
      const sum = d.querySelector(".sh-sum");
      if (!sum) return;
      const had = sum.querySelector(".sh-weight");
      if (had) had.remove();
      const w = weighOf(buckets.get(label) || []);
      const bits = [];
      if (w.hasStars && w.stars) bits.push("\u2605 " + w.stars);
      if (w.dated && w.stale) bits.push(w.stale + " stale");
      if (w.fresh) bits.push(w.fresh + " since you were here");
      /* The rule could not judge some repos, and they are sitting in the
       * leftovers shelf because of it. Said here, on the shelf that lost
       * them, rather than in a warning about the whole page. */
      const missed = unjudged && unjudged.get(label);
      if (missed) bits.push(missed + " unjudged");
      if (!bits.length) return;
      const el = document.createElement("span");
      el.className = "sh-weight";
      el.textContent = bits.join(" · ");
      el.title =
        (w.hasStars ? "Stars across this shelf. " : "") +
        (w.dated ? "Stale means nothing pushed in a year. " : "") +
        (w.fresh ? "Pushed since your last visit to this page. " : "") +
        (missed ? "Unjudged repositories named a field their source could " +
                  "not answer, so this rule could not decide about them." : "");
      const count = sum.querySelector(".sh-count");
      if (count) sum.insertBefore(el, count);
      else sum.append(el);
    };

    /* BUILT BY A FUNCTION so the second pass can create a shelf the cache
     * never knew about without rebuilding the page around it. */
    const buildShelf = (label, list) => {
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
      const bench = makeBench(label);
      if (bench) sum.append(bench);

      d.appendChild(sum);
      paintWeight(d, label);

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
        /* NOR A SHELF THE FIRST PASS GUESSED. Setting `open` before this
         * listener exists does not save us — `toggle` is queued as a task, so
         * a listener attached a hundred lines later still receives it. Without
         * this, a provisional shelf that the finished page then discards would
         * have written a permanent open-state key for a name nothing will ever
         * draw again, and `shelves:open:<owner>` has no eviction path. */
        if (host.dataset.provisional === "1") return;
        const state = S.collapse.read(owner);
        state[label] = d.open;
        S.collapse.write(owner, state);
      });

      return d;
    };

    order.forEach((label) => host.appendChild(buildShelf(label, buckets.get(label))));

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
    const publishMap = () => {
      /* NEVER FROM A GUESS. The first pass shelves from the cache, and a repo
       * page opened during that window reads this map to colour its chip — so
       * publishing a provisional order would have another page draw an
       * identity the finished page then disagrees with, which is the one
       * failure the map exists to prevent. */
      if (ctx.provisional) return;
      /* WHICH SHELF EACH REPO LANDED ON, not just which shelves exist.
       *
       * `names` was written here and read by NOTHING — the most sensitive
       * thing in the store, persisted for a feature that was never built. It
       * is replaced by the answer the repo page actually needs.
       *
       * The chip used to re-derive its shelf from the page it is standing on,
       * which worked while a shelf was one topic and breaks the moment a shelf
       * is a rule: at the ~160ms the mark is drawn, GitHub has not yet
       * rendered the languages bar or the timestamps — they arrive with its
       * own client-side pass — so `lang:java` was unanswerable and the chip
       * fell to Ungrouped on a repo the profile had on `Java`. Measured.
       *
       * Re-deriving was always the second-best answer. This map exists because
       * "the page that knows writes it down, and the pages that cannot work it
       * out read it rather than guessing a different answer" — and a shelf is
       * now exactly such a thing. */
      /* `on`, not `at` — `shelfmap.write` stamps its own `at` with the time
       * the map was written, and the collision silently made this a number. */
      const on = {};
      order.forEach((label) => {
        (buckets.get(label) || []).forEach((li) => {
          if (li.dataset.shName) on[li.dataset.shName] = label;
        });
      });
      Promise.resolve(
        S.shelfmap.write(owner, {
          order,
          counts: Object.fromEntries(order.map((l) => [l, buckets.get(l).length])),
          on,
        })
      ).catch(() => {});
    };
    publishMap();

    expand.addEventListener("click", () =>
      host.querySelectorAll("details").forEach((d) => (d.open = true))
    );
    collapse.addEventListener("click", () =>
      host.querySelectorAll("details").forEach((d) => (d.open = false))
    );
    rescan.addEventListener("click", () => handlers.rescan());
    density.addEventListener("click", () => {
      const next = host.dataset.density === "compact" ? "roomy" : "compact";
      host.dataset.density = next;
      S.density.write(owner, next);
      paintDensity();
    });
    more.addEventListener("click", () => handlers.more());

    /* THE AUDIT'S BY-NAME FILTER HAS NO TEXT FORM. "the 12 repos with no
     * description" is not a substring, so remembering `find.value` alone would
     * silently turn it back into "no filter" on the next repaint. Both halves
     * are kept, and they are mutually exclusive by construction. */
    let onlySet = null;
    find.addEventListener("input", () => {
      onlySet = null;
      S.applyFilter(host, find.value);
    });
    find.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        find.value = "";
        S.applyFilter(host, "");
        find.blur();
      }
    });
    /* ---- THE KEYS --------------------------------------------------------
     * `/` IS GITHUB'S OWN SHORTCUT for its search box, and it is taken here on
     * the document because the shelves have replaced the list `/` used to be
     * about. The rest join it for the same reason: the shelves ARE the
     * navigation now, and a map you can only move around with a mouse is
     * half a map on a site whose readers live on the keyboard.
     *
     *   /      the filter, focused and selected
     *   j / k  the next / previous shelf
     *   1-9    that shelf by number, opened
     *   e / c  expand / collapse every shelf
     *   Esc    clears the filter (on the box itself)
     *
     * EVERY ONE OF THEM STANDS DOWN INSIDE A FIELD — including GitHub's own,
     * including our note editor — so the only keys they ever steal are ones
     * pressed while reading. Modifiers are left alone entirely: ctrl+J is the
     * browser's, and a shortcut that eats it is a bug in someone else's app.
     *
     * `j`/`k` MOVE FOCUS, they do not merely scroll. Focus is what a screen
     * reader follows and what `Enter`/`Space` then act on, so moving it is the
     * difference between navigating the shelves and animating them. */
    host.dataset.slash = "1";
    host.dataset.keys = "1";

    const shelvesNow = () => [...host.querySelectorAll("details.sh-shelf")];
    let cursor = -1;

    const goShelf = (i, open) => {
      const list = shelvesNow();
      if (!list.length) return;
      cursor = ((i % list.length) + list.length) % list.length;
      const d = list[cursor];
      if (open) d.open = true;
      const sum = d.querySelector(".sh-sum");
      if (!sum) return;
      /* A <summary> is focusable already; the attribute is for the case where
         a future GitHub or a future us renders the header as something else. */
      if (!sum.hasAttribute("tabindex")) sum.setAttribute("tabindex", "0");
      sum.focus({ preventScroll: true });
      /* `nearest`, so a shelf already on screen does not jump the page. Guarded
       * because a headless DOM may not implement it, and a keyboard map that
       * throws is worse than one that does not scroll. */
      if (d.scrollIntoView) d.scrollIntoView({ block: "nearest" });
    };

    const keys = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!host.isConnected) return document.removeEventListener("keydown", keys);
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
          (t && t.isContentEditable)) return;

      /* TAKEN, NOT SHARED. GitHub binds `/` on `document` too, and their script
       * runs long before a content script at `document_idle` — so their
       * listener is registered first, fires first, and opens the global search
       * overlay. `preventDefault` from a later listener is far too late.
       * MEASURED, and only visible in a real browser: `/` put the caret in
       * GitHub's quick-search and left an overlay over the page. So this
       * listener is registered in the CAPTURE phase and stops the key there. */
      if (e.key === "/") {
        e.preventDefault();
        e.stopPropagation();
        find.focus();
        find.select();
        return;
      }
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        const list = shelvesNow();
        if (cursor < 0) cursor = e.key === "j" ? -1 : 0;
        goShelf(cursor + (e.key === "j" ? 1 : -1), false);
        return;
      }
      if (e.key >= "1" && e.key <= "9") {
        const n = Number(e.key) - 1;
        if (n >= shelvesNow().length) return;   // a number naming no shelf is not ours
        e.preventDefault();
        e.stopPropagation();
        goShelf(n, true);
        return;
      }
      if (e.key === "e" || e.key === "c") {
        e.preventDefault();
        e.stopPropagation();
        host.querySelectorAll("details").forEach((d) => (d.open = e.key === "e"));
      }
    };

    /* ONE LISTENER, EVEN WHEN THE PAGE RENDERS TWICE. The old handler removed
     * itself once its host was disconnected — but only on the NEXT keypress,
     * so between a progressive render's two phases two handlers were live and
     * `j` moved two shelves. The previous one is taken off here instead. */
    if (S._keys) document.removeEventListener("keydown", S._keys, true);
    S._keys = keys;
    /* Capture, for the reason above — and it is why every branch that acts
     * also calls `stopPropagation`: capturing without stopping would leave
     * GitHub's handler to run anyway. */
    document.addEventListener("keydown", keys, true);

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

    /* ══ THE SECOND PASS ═══════════════════════════════════════════════════
     * A cold run spends most of its time on rung 4 — one authenticated fetch
     * per repo — and until it finishes the reader is looking at GitHub's flat
     * list. The first pass shelves from what is already free (the page's own
     * chips, plus every cached record) so the page is usable in the first
     * frame; this is what happens when the real answer arrives.
     *
     * IT RE-BUCKETS RATHER THAN RE-RENDERING, and the difference is the whole
     * design. Building a second host and swapping it in is four lines and
     * loses: the text in the find box, the filter that text applied (the
     * `sh-hide` classes ride on the ROWS and would survive with nothing on
     * screen explaining them), `data-sh-was-open`, the open audit panel and
     * the reader's place inside it, keyboard focus, an open shelf-pick menu
     * and the `data-menu` flag that stops its shelf clipping it — and it
     * re-parents every row a second time, which is a second chance for
     * GitHub's own lazy fragments to be cut off mid-flight.
     *
     * So nothing is rebuilt that has not changed. A row moves only if its
     * shelf changed; a shelf is created only if it is new; the summary is
     * repainted in place rather than replaced, because replacing it takes the
     * focus `j`/`k` just put there.
     *
     * `rows` and `names` are pinned — see the head of this function. */
    host.rebucket = function rebucket(next) {
      topics = next.topics || topics;
      facts = next.facts || facts;
      if (next.notes) notes = next.notes;
      if (next.overrides) overrides = next.overrides;
      if (next.source != null) source = next.source;
      if (next.warning != null) warning = next.warning;
      if (next.health != null) health = next.health;
      if (next.deferred != null) deferred = next.deferred;
      delete host.dataset.provisional;
      /* AND ON THE CONTEXT, not only on the element. `publishMap()` reads
       * `ctx.provisional` to refuse publishing a guess — and `ctx` is still
       * the object phase one was called with, so clearing the attribute alone
       * left the guard armed for good. The shelf map was silently never
       * written on any page that rendered progressively, which is every page
       * with a warm cache: measured, `shelfMap` held zero owners after a full
       * settled run, and the repo-page chip therefore had nothing to read. */
      ctx.provisional = false;

      /* A menu open across a re-bucket keeps its element and loses the
       * `data-menu` flag that stops its shelf clipping it — the scar, exactly,
       * from the other side. Close it before anything moves. */
      closeMenus(host);

      const was = { q: find.value, only: onlySet,
                    on: host.dataset.filtering === "1" };

      if (next.pins) pins = next.pins;
      const rb = S.bucket(rows, topics, settings, names, overrides, facts, { pins });
      buckets = rb.buckets;
      order = rb.order;
      specs = rb.specs;
      unjudged = rb.unjudged;
      marks = S.identity(order, settings.otherLabel);
      untagged = names.filter((n, i) => n && !(topics[i] || []).length);
      vdata = S.vocabulary(topics, names);
      adata = S.audit(facts, names, topics);

      const shelfOf = (label) =>
        [...host.querySelectorAll("details.sh-shelf")].find(
          (d) => (d.querySelector(".sh-name") || {}).textContent === label);

      // 1. every shelf in the new order exists, and only rows move
      order.forEach((label) => {
        let d = shelfOf(label);
        if (!d) {
          d = buildShelf(label, []);
          host.appendChild(d);
        }
        const ul = d.querySelector("ul");
        (buckets.get(label) || []).forEach((li) => {
          /* MOVED ONLY IF IT HAS TO BE. `appendChild` on a row already in this
           * list would still detach and re-attach it — which is the expensive,
           * risky half — for no change at all. */
          if (li.parentElement !== ul) ul.appendChild(li);
        });
      });

      // 2. a shelf the finished answer does not name, and holds nothing, goes
      [...host.querySelectorAll("details.sh-shelf")].forEach((d) => {
        const label = (d.querySelector(".sh-name") || {}).textContent;
        if (order.indexOf(label) === -1 && !d.querySelector("li[data-sh-name]")) {
          d.remove();
        }
      });

      // 3. the order on screen becomes the order we computed
      order.forEach((label, i) => {
        const d = shelfOf(label);
        const at = [...host.querySelectorAll("details.sh-shelf")][i];
        if (d && at !== d) host.insertBefore(d, at || null);
      });

      // 4. each shelf's own furniture, repainted in place
      order.forEach((label) => {
        const d = shelfOf(label);
        if (!d) return;
        const mark = marks.get(label);
        d.classList.toggle("sh-plain", !paintMark(d, mark));
        const g = d.querySelector(".sh-glyph");
        if (g) g.textContent = mark ? mark.glyph : "·";
        const c = d.querySelector(".sh-count");
        if (c) c.textContent = String(d.querySelectorAll("li[data-sh-name]").length);
        const sum = d.querySelector(".sh-sum");
        const old = sum && sum.querySelector(".sh-bench");
        if (old) old.remove();
        const bench = makeBench(label);
        if (sum && bench) sum.append(bench);
        paintWeight(d, label);
      });

      // 5. what each row knows about itself
      rows.forEach((li, i) => {
        const name = names[i] || "";
        const note = notes[name] || "";
        const held = li.querySelector(".sh-margin");
        if (held) paintNote(held, note);
        paintSiblings(li, i);
        li.dataset.shHay = S.haystack(li.dataset.shText || "", facts[i], note);
      });

      // 6. the toolbar
      paintNote2();
      paintSuggestions();
      paintBadge();
      paintMore();

      /* 7. AND THE READER GETS THEIR PAGE BACK. The rows keep their `sh-hide`
       * classes through all of the above, so without this the page would show
       * a full set of counts, an empty search box, and some repositories
       * simply missing. */
      if (was.on) S.applyFilter(host, was.q, was.only);

      publishMap();
      return host;
    };

    /* GitHub's dropdowns tear the page down and hand us a new one; if the
     * reader had something typed, it is put back. A by-name filter from the
     * audit is NOT restored — it names repositories the new row set may not
     * contain, and a filter that silently means something else is worse than
     * none. */
    if (S.lastFilter && S.lastFilter.q) {
      find.value = S.lastFilter.q;
      onlySet = null;
      S.applyFilter(host, S.lastFilter.q);
    }

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
