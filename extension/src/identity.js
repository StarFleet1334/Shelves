/* SHELVES — identity.js
 *
 * A shelf's colour and its glyph, and nothing else. Lifted out of view.js
 * unchanged when the toolbar popup needed it: the popup is its own document
 * and cannot load view.js, which registers against the live page — but it has
 * to draw the SAME mark the page and the repo-page chip draw, and the one
 * thing this system cannot survive is two drawings of one shelf that disagree.
 *
 * The alternatives were both worse. Writing the resolved hue into `shelfMap`
 * would make the identity stored rather than derived, which is the property
 * P.XII is built on — a colour that needs no store needs no migration and
 * cannot be lost. Re-typing the palette in popup.js would be the same twelve
 * numbers in two files, drifting apart on the first edit.
 *
 * So it is a module instead: pure, no DOM, no storage, no chrome API. It
 * loads as a content script beside view.js and as a plain <script> in the
 * popup, and `S.identity` means exactly one thing in both.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

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
})(globalThis.Shelves);
