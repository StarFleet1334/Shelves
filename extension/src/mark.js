/* SHELVES — mark.js
 *
 * THE MAP FOLLOWS THE REPO.
 *
 * Until now this extension lived on exactly one page. You built a map of
 * seventy-six repositories, clicked one, and the map was gone — the shelf it
 * belongs to, the colour you had learned to recognise it by, and the private
 * note you wrote about it all stayed behind on a tab you had navigated away
 * from. The note in particular was invisible in the one place it is most
 * obviously about.
 *
 * So a repo's own page gets a chip: the shelf's glyph, the shelf's name in the
 * shelf's colour, a link back to the shelves, and the note if there is one —
 * editable in place, because the moment you remember something about a repo is
 * the moment you are looking at it.
 *
 * ── WHY THIS NEEDS THE SHELF MAP AND CANNOT JUST WORK IT OUT ──────────────
 * The shelf is easy: `bucketFor()` over the topics in this page's own sidebar,
 * free, no request. The COLOUR is not. `identity()` resolves palette
 * collisions across every label at once, so the hue for "rag" depends on which
 * other shelves exist — which this page cannot see. A page that guessed would
 * produce a chip that disagrees with the shelves, and a mark that disagrees is
 * worse than no mark, because the whole promise of the colour is that it means
 * one thing.
 *
 * So the profile page writes the label set down (store.js `shelfmap`) and this
 * page reads it. With no map, the chip still names the shelf and simply wears
 * no colour — degrade, never fail (P.III). With `settings.groups` configured
 * the label set is already known from settings alone and the map is not needed.
 *
 * NOTHING HERE FETCHES. Every input is either on the page already or in local
 * storage; this route costs zero requests, which is what makes it safe to run
 * on a page the reader opened to do something else entirely.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  const CHIP_ID = "shelves-mark";

  /* WHERE THE CHIP GOES, in the order we would rather have it.
   *
   * The About sidebar first, and not because it is convenient: the topics live
   * there, and the shelf IS the consequence of the topics. Putting the answer
   * next to its own input is the only placement that explains itself without a
   * word of copy.
   *
   * The header is the fallback because it is always present even when the
   * sidebar is not (an empty repo has no About panel at all). And if neither
   * is found we render nothing — a chip in the wrong place on someone's repo
   * page is worse than no chip, and this is a page the reader did not open for
   * us. */
  /* MEASURED, on a real logged-in repo page, after it shipped wrong: neither
   * `.Layout-sidebar` nor `[data-testid="repository-sidebar"]` matched, the
   * header fallback did not fire either, and the chip simply never appeared —
   * on a page whose About panel was plainly right there on screen. A class
   * name is the half of GitHub's markup that churns (charter, measurement 6),
   * and this file had staked the whole feature on two of them.
   *
   * So the class is now only a FAST PATH, and the real finder is structural:
   * climb from the "About" heading until an ancestor also holds one of the
   * sidebar's other landmarks. Headings and href shapes are what this codebase
   * already trusts everywhere else, for exactly this reason.
   *
   * Two bounds on the climb, because an unbounded one ends at <body> and would
   * put the chip above the entire page:
   *   - never an ancestor containing the repo's own <h1>; that is the header
   *     column, so the climb has left the sidebar.
   *   - if layout reports a width at all, a column is not most of the window.
   *     Gated on `> 0` so a harness with no layout engine is not fenced out. */
  /* ONE FINDER, AND IT LIVES IN facts.js. This file grew the structural climb
   * first and kept it private; facts.js then needed the identical thing for
   * the identical reason, and two copies of "where is the About panel" is two
   * answers waiting to disagree — which is the precise failure the chip exists
   * to prevent. The climb, its two bounds and the measurements behind it now
   * sit beside the parse that leans on it hardest. */
  const sidebarOf = (doc) => S.sidebarOf(doc);

  function berth(doc) {
    const named = doc.querySelector(
      '.Layout-sidebar, [data-testid="repository-sidebar"]'
    );
    if (named) return { node: named, how: "prepend", via: "class" };

    const found = sidebarOf(doc);
    if (found) return { node: found, how: "prepend", via: "about-heading" };

    /* Last resort: under the repo's title. Present even on an empty repo,
     * which has no About panel at all — and `role="heading"` because GitHub
     * has not always used a real <h1> for it. */
    const head =
      doc.querySelector("h1") ||
      doc.querySelector('[role="heading"][aria-level="1"]');
    if (head && head.parentElement) return { node: head, how: "after", via: "title" };
    return null;
  }

  /** The label set the identity has to be resolved over. */
  async function labelsFor(owner, settings) {
    if (settings.groups.length) {
      return { order: settings.groups.concat(settings.otherLabel), counts: null };
    }
    /* Auto-grouping derives its labels from every repo's topics, which this
     * page has no way to see — so without the map there is genuinely no answer,
     * and the chip says the shelf without claiming a colour. */
    const map = await S.shelfmap.read(owner);
    if (map && Array.isArray(map.order) && map.order.length) {
      return { order: map.order, counts: map.counts || null };
    }
    return null;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  S.buildMark = function buildMark(opts) {
    const { owner, label, mark, count, note, name, handlers } = opts;

    const box = el("div", "sh-mark");
    box.id = CHIP_ID;

    const chip = el("a", "sh-mark-chip");
    chip.href = "/" + owner + "?tab=repositories";
    chip.title = count == null
      ? "This repo is on your '" + label + "' shelf — back to the shelves"
      : "This repo is on your '" + label + "' shelf, with " + (count - 1) +
        " others — back to the shelves";
    /* THE COLOUR IS CONDITIONAL; THE GLYPH IS NOT. Photographed at 296px, the
     * leftovers chip came out with no mark at all — `paintMark` returns false
     * for the plain shelf (it has no hue by design) and the glyph was inside
     * that branch, so `Ungrouped` wore its dot on the shelf and nothing on the
     * chip. Two drawings of one thing that disagree is exactly what the whole
     * identity system exists to prevent. Only an UNKNOWN shelf — no map, so no
     * honest answer — is left bare. */
    if (!S.paintMark(chip, mark)) chip.classList.add("sh-plain");
    if (mark) {
      const g = el("span", "sh-mark-g", mark.glyph);
      g.setAttribute("aria-hidden", "true");
      chip.append(g);
    }
    chip.append(el("span", "sh-mark-n", label));
    if (count != null) chip.append(el("span", "sh-mark-c", String(count)));
    box.append(chip);

    /* The note is the reason this is worth more than a breadcrumb. It is the
     * one piece of text about this repository that exists nowhere on GitHub,
     * and it was previously only visible on a list you had navigated away
     * from. Same marker, same editor as the row (view.js owns both), so a note
     * written here and a note written there cannot behave differently. */
    box.append(S.noteMarker(name, note, handlers));
    return box;
  };

  /**
   * Idempotent by construction, like run(): GitHub's turbo navigation fires
   * repeatedly and the observer wakes on every mutation, so the guard is that
   * an existing chip means there is nothing to do.
   */
  S.markRepoPage = async function markRepoPage() {
    if (!S.isRepoPage()) return false;
    /* THE CHIP IS ABOUT THE READER'S OWN SHELVES. On somebody else's
     * repository it would answer a question nobody asked — "which of YOUR
     * shelves would this land on" — by reading your settings and your cache on
     * a page that has nothing to do with either. */
    if (!S.isMine()) return false;
    if (document.getElementById(CHIP_ID)) return false;

    const name = S.pageRepo();
    if (!name) return false;

    /* IT SAYS WHY IT DREW NOTHING. Rendering nothing is the correct answer when
     * there is nowhere safe to put a chip — but silence made "GitHub renamed
     * the sidebar", "the extension is a stale build" and "this is not a repo
     * page" indistinguishable from each other, and settling that took a round
     * trip through a human pasting DOM into a console. Principle IV is about
     * saying which rung answered; this is the same debt on the other route. */
    const spot = berth(document);
    if (!spot) {
      console.debug(
        "[shelves] no place for the mark on " + name +
        " — no About sidebar and no title to sit under. If this page plainly " +
        "has an About panel, its markup has moved: mark.js is the only file " +
        "that needs looking at."
      );
      return false;
    }
    if (spot.via !== "class") {
      console.debug("[shelves] mark placed via the " + spot.via + " fallback — " +
                    "GitHub's sidebar class no longer matches");
    }

    const settings = await S.load();
    const owner = S.owner();

    /* The topics are ON THIS PAGE, in the sidebar, scoped exactly as facts.js
     * scopes them — so a README full of /topics/ links cannot lie about which
     * shelf this repo is on. Free, and more current than the cache. */
    const side = S.sidebarOf(document);
    /* NO `|| document`. This line kept the dead class pair three functions
     * below a working structural finder, with the whole page behind it — so
     * the chip whose entire rationale is "a mark that disagrees with the
     * shelves is worse than no mark" could name a shelf derived from the
     * README's /topics/ links. Measured the day it was fixed: the pair matched
     * 0 of 6 real repo pages and 0 of 50 on a live run. With no sidebar there
     * are no topics here, and the cache below answers instead. */
    let topics = side ? S.topicsIn(side) : [];
    if (!topics.length) {
      const cached = (await S.cache.read())[name];
      if (cached && Array.isArray(cached.topics)) topics = cached.topics;
    }

    const label = S.bucketFor(topics, settings);
    const known = await labelsFor(owner, settings);
    const marks = known
      ? S.identity(known.order, settings.otherLabel)
      : new Map();
    const notes = await S.notes.read();

    // Another pass may have won while we were awaiting storage (P.VI).
    if (document.getElementById(CHIP_ID)) return false;

    const box = S.buildMark({
      owner,
      label,
      name,
      mark: marks.get(label),
      count: known && known.counts ? known.counts[label] : null,
      note: notes[name] || "",
      handlers: {
        note: async (n, text) => {
          const { notes: after } = await S.notes.set(n, text);
          const wrap = box.querySelector(".sh-margin");
          if (wrap) S.paintNote(wrap, after[n] || "");
        },
      },
    });

    if (spot.how === "prepend") spot.node.insertBefore(box, spot.node.firstChild);
    else spot.node.insertAdjacentElement("afterend", box);
    return true;
  };
})(globalThis.Shelves);
