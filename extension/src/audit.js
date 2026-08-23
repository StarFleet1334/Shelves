/* SHELVES — audit.js
 *
 * WHAT IS MISSING FROM THE REPOSITORIES, as vocab.js is what is wrong with the
 * labels. Same collection, the other half of it, and the same rule: no request,
 * no storage, nothing written. Every answer here comes out of facts the ladder
 * already paid for.
 *
 * GitHub can tell you one repo has no description. It has never told anyone
 * they have twelve — and twelve is the number that changes an afternoon, while
 * one is a shrug. That is the whole feature: the collection-shaped view of a
 * question the per-repo UI can only ever answer one repo at a time.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THAT MAKES THIS HONEST: A FIELD IS ABSENT FOR TWO REASONS.
 *
 * Either the repository does not have it, or the SOURCE that answered could
 * not have carried it. api.github.com's body has no README in it at all — so
 * "no README" over API-answered records is not a finding about the reader's
 * repositories, it is a finding about the API, reported as though it were
 * their fault. On a token-holding account that is every repo they own.
 *
 * So every gap declares which field it needs, `answers()` decides whether this
 * record's source could have spoken to it, and a repo the source could not
 * answer for is not counted in the numerator OR the denominator. That is why
 * the counts read "9 of 41" and not "9 of 76": the denominator is the number
 * of repos the question could actually be asked about, which is the only
 * denominator that means anything.
 * ─────────────────────────────────────────────────────────────────────────
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  /* WHICH FIELDS EACH SOURCE CAN CARRY LIVES IN facts.js, beside the functions
   * that build the records. It was duplicated here, and a second copy of this
   * particular fact is a slow-motion bug: `rule.js` now asks the same question
   * to tell "no forks" from "nobody asked", and a table that drifts would make
   * the audit report a gap nobody could fill while a rule shelf quietly
   * excluded repos it had no opinion about. */
  const carries = (via, field) => S.carries(via, field);

  const GAPS = [
    {
      key: "untagged", label: "no topics", needs: null,
      hit: (f, t) => !t.length,
      why: "they can only ever land in the leftovers shelf",
    },
    {
      key: "nodesc", label: "no description", needs: "description",
      hit: (f) => !f.description,
      why: "nothing on the row says what they are, and nothing to search",
    },
    {
      key: "noreadme", label: "no README", needs: "readme",
      hit: (f) => !f.readme,
      why: "the first thing anyone opening the repo reads",
    },
    {
      key: "nolicense", label: "no licence", needs: "license",
      hit: (f) => !f.license,
      why: "a public repo with no licence is not legally reusable by anyone",
    },
    {
      key: "archived", label: "archived", needs: "archived",
      hit: (f) => f.archived === true,
      why: "finished work, still shelved in among the live",
    },
  ];

  /**
   * @param {object[]} facts   parallel to names; may be sparse or empty
   * @param {string[]} names   "owner/name", the key rows are addressed by
   * @param {string[][]} topics parallel; authoritative whatever the source was
   */
  S.audit = function audit(facts, names, topics) {
    const fs = facts || [];
    const nm = names || [];
    const ts = topics || [];

    const answers = (i, field) => {
      if (!field) return true;
      const via = (fs[i] || {}).via;
      return carries(via, field);
    };

    const gaps = [];
    GAPS.forEach((g) => {
      const hit = [];
      let of = 0;
      for (let i = 0; i < nm.length; i++) {
        if (!nm[i]) continue;
        if (!answers(i, g.needs)) continue;
        of++;
        if (g.hit(fs[i] || {}, ts[i] || [])) hit.push(nm[i]);
      }
      if (hit.length) {
        gaps.push({ key: g.key, label: g.label, why: g.why, names: hit, of });
      }
    });

    /* What could not be asked at all, said out loud rather than left as a
       silently smaller denominator. A run answered entirely by the API is a
       run where "no README" was never a question, and a panel that simply
       omitted the row would look like a clean bill of health. */
    const unaskable = [];
    ["readme", "license", "description"].forEach((field) => {
      const n = nm.filter((x, i) => x && !answers(i, field)).length;
      if (n) unaskable.push({ field, count: n });
    });

    return { repos: nm.filter(Boolean).length, gaps, unaskable };
  };

  /** One finding per gap. The unaskable note is not a finding — it is a
   *  caveat on the others, and badging it would inflate the count with
   *  something nobody can act on. */
  S.auditIssues = function auditIssues(a) {
    return a && a.gaps ? a.gaps.length : 0;
  };

  /**
   * @param {object} a    what S.audit() returned
   * @param {object} kit  from S.panelKit()
   * @returns {Node[]}    the REPOSITORIES half of the panel
   */
  S.auditSection = function auditSection(a, kit) {
    const { el, pick, finding } = kit;
    const out = [];

    out.push(el("div", "sh-v-label", "repositories"));

    if (!a.gaps.length) {
      out.push(el("div", "sh-v-clean",
        a.repos
          ? "Every repo here has topics, a description, a README and a licence. " +
            "Nothing missing."
          : "Nothing to audit yet."));
    }

    const found = el("div", "sh-v-finds");
    a.gaps.forEach((g) => {
      found.append(finding(
        g.key === "archived" ? "archived" : "gap",
        g.label,
        [
          pick("show", g.names, "filter the page to these " + g.names.length, g.label),
          " " + g.names.length + " of " + g.of + " — " + g.why,
        ]
      ));
    });
    if (found.childNodes.length) out.push(found);

    /* P.IV, applied to an audit: say what could NOT be asked. Without this a
       token-holding account reads "no README: 0" as a clean bill of health,
       when the truth is that the API body never carried a README and the
       question was never put. */
    if (a.unaskable.length) {
      out.push(el("div", "sh-v-caveat",
        "Not asked: " +
        a.unaskable
          .map((u) => u.count + " repos for " + u.field)
          .join(", ") +
        " — the source that answered for them does not carry that field. " +
        "A rescan without a token reads the pages themselves."));
    }

    return out;
  };
})(globalThis.Shelves);
