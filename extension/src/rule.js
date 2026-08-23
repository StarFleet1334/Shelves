/* SHELVES — rule.js
 *
 * A SHELF THAT IS A QUESTION RATHER THAN A WORD.
 *
 * Every shelf until now was one topic string, matched literally. That is the
 * right default and it is the whole answer for a well-tagged collection — but
 * it cannot express the shelf people actually describe out loud: *the Python
 * ones I still work on*, *everything I forked and never touched*, *the archived
 * ones I keep meaning to delete*. Those are three fields and a date, and the
 * records to answer them are already on the page: `facts.js` harvests ten
 * fields from the one request the ladder was making anyway.
 *
 *     Python AI = topic:ai lang:python fork:false archived:false pushed:<90d
 *
 * PARSED ONCE, APPLIED TO THE ROWS ALREADY HERE. No request, no index, no
 * second axis — a rule shelf is an ordinary shelf whose membership test is
 * richer, and it sits in `settings.groups` beside the topic shelves so there is
 * one list, one order, and nothing to migrate.
 *
 * THREE RULES OF ITS OWN:
 *
 *   A TERM NOBODY CAN JUDGE EXCLUDES THE REPO, AND SAYS SO. `fork:false`
 *   against a record from rung 1 is not false — it is unknown, and answering
 *   an unknown as `false` is how a rule quietly builds the wrong shelf. The
 *   repo stays in the leftovers shelf, which the charter already names as the
 *   safe failure, and the count of repos that could not be judged is handed
 *   back so the header can state it.
 *
 *   A TERM NOBODY CAN PARSE IS NAMED, NOT DROPPED. `lang:python topc:ai` is a
 *   typo, and a rule that silently ignores a third of itself is worse than one
 *   that refuses: the reader would be looking at a shelf whose contents they
 *   cannot explain. `parse()` hands back `bad`, and the toolbar prints it.
 *
 *   IT IS ALL `AND`. No `or`, no parentheses, no precedence to learn or to get
 *   wrong. Two ideas are two shelves, which is the model the rest of this
 *   extension already has.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  /* `Name = expression`. The separator is `=` and not `:` because every term
   * inside the expression already uses `:`, and a label is allowed to contain
   * one. */
  const SPLIT = /^([^=]+?)\s*=\s*(.+)$/;

  /** Is this group entry a rule, or the plain topic string shelves began with? */
  S.isRule = function isRule(entry) {
    return SPLIT.test(String(entry || ""));
  };

  const UNITS = { d: 1, w: 7, m: 30, y: 365 };

  /* Every field a term may name, and what it is. `where` is the fact key;
   * `kind` decides how the value is read and compared. `text` fields match on
   * substring, which is what a reader means by `name:wire`. */
  const FIELDS = {
    topic: { where: "topics", kind: "list" },
    topics: { where: "topics", kind: "list" },
    /* EXACT, NOT SUBSTRING — measured, and it is not a nicety: `lang:java`
     * matched 26 Java repos AND 2 JavaScript ones, so a Java shelf quietly
     * held 28. The same trap is waiting in `lang:c` (C, C++, C#, CSS,
     * Clojure) and `lang:type` (TypeScript). A language is a name from a
     * closed list, and naming one means naming it. */
    lang: { where: "language", kind: "exact" },
    language: { where: "language", kind: "exact" },
    license: { where: "license", kind: "exact" },
    /* The repo's own name, not `owner/name` — `name:star` matched all 54 rows
     * on an account called StarFleet1334, because the owner is in every one
     * of them. */
    name: { where: "name", kind: "tail" },
    desc: { where: "description", kind: "text" },
    description: { where: "description", kind: "text" },
    readme: { where: "readme", kind: "text" },
    homepage: { where: "homepage", kind: "text" },
    fork: { where: "fork", kind: "bool" },
    archived: { where: "archived", kind: "bool" },
    private: { where: "private", kind: "bool" },
    stars: { where: "stars", kind: "number" },
    forks: { where: "forks", kind: "number" },
    pushed: { where: "updated", kind: "age" },
    updated: { where: "updated", kind: "age" },
  };

  /**
   * @returns {{label, source, terms: Array, bad: string[]}}
   *          `bad` is every term that could not be read. It is never empty
   *          silently — the caller is expected to print it.
   */
  S.parseRule = function parseRule(entry) {
    const m = SPLIT.exec(String(entry || ""));
    if (!m) return null;
    const label = m[1].trim().slice(0, 60);
    const source = m[2].trim();
    const terms = [];
    const bad = [];

    source.split(/\s+/).filter(Boolean).forEach((raw) => {
      let word = raw;
      let not = false;
      if (word[0] === "-") { not = true; word = word.slice(1); }
      const at = word.indexOf(":");
      if (at === -1) {
        /* A bare word is the thing a reader types first, so it means the
         * obvious: anywhere in the name, the description or the topics. */
        if (!word) return bad.push(raw);         // a lone `-` is not a term
        /* `stars:>= 10` is one term with a space in it, and it arrives here as
         * a rejected `stars:>=` and an orphaned `10`. Searching the collection
         * for the text "10" is a silent misreading of what the reader meant —
         * the half that survives is worse than the half that was refused. */
        if (/^[\d<>=]+$/.test(word)) return bad.push(raw);
        terms.push({ kind: "any", value: word.toLowerCase(), not });
        return;
      }
      const key = word.slice(0, at).toLowerCase();
      const value = word.slice(at + 1);
      const field = FIELDS[key];
      if (!field || !value) return bad.push(raw);

      if (field.kind === "bool") {
        if (!/^(true|false|yes|no)$/i.test(value)) return bad.push(raw);
        terms.push({ kind: "bool", where: field.where, not,
                     value: /^(true|yes)$/i.test(value) });
        return;
      }
      if (field.kind === "number" || field.kind === "age") {
        const cmp = /^([<>]=?)?(\d+)([dwmy])?$/.exec(value);
        if (!cmp) return bad.push(raw);
        if (field.kind === "age" && !cmp[3]) return bad.push(raw);
        /* AN AGE WITH NO OPERATOR IS A TRAP, NOT A DEFAULT. `pushed:10d` means
         * "pushed exactly ten days ago to the millisecond", which against a
         * real `pushed_at` can never be true — it looked like it worked only
         * against a fixture whose timestamp was built as exactly that. Say so
         * rather than build a shelf that is permanently empty for a reason
         * nobody can see. */
        if (field.kind === "age" && !cmp[1]) return bad.push(raw);
        terms.push({
          kind: field.kind, where: field.where, not,
          op: cmp[1] || "=",
          value: Number(cmp[2]) * (field.kind === "age" ? UNITS[cmp[3]] : 1),
        });
        return;
      }
      terms.push({ kind: field.kind, where: field.where, not,
                   value: value.toLowerCase() });
    });

    return { label, source, terms, bad };
  };

  /** `settings.groups`, read once, as shelves rather than strings. */
  S.shelfSpecs = function shelfSpecs(settings) {
    return ((settings || {}).groups || []).map((entry) => {
      const rule = S.parseRule(entry);
      return rule
        ? { label: rule.label, kind: "rule", rule }
        : { label: entry, kind: "topic" };
    });
  };

  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

  function compare(op, got, want) {
    if (op === ">") return got > want;
    if (op === ">=") return got >= want;
    if (op === "<") return got < want;
    if (op === "<=") return got <= want;
    return got === want;
  }

  /**
   * @param {object} rule    from parseRule
   * @param {object} facts   the record, or a bare {topics}
   * @param {string[]} topics
   * @param {number=} now
   * @returns {{yes: boolean, unknown: boolean}}
   *          `unknown` means a term named a field this record's SOURCE cannot
   *          carry — which is not the same as the field being empty, and is
   *          the difference between "no forks" and "nobody asked".
   */
  S.matchRule = function matchRule(rule, facts, topics, now) {
    const f = facts || {};
    const list = topics || f.topics || [];
    const when = now || Date.now();
    let unknown = false;

    /* A RULE WITH NOTHING LEFT TO TEST MATCHES NOTHING.
     *
     * `[].every(...)` is `true`, so a rule whose every term failed to parse
     * was a UNIVERSAL match — and because the first matching shelf wins, one
     * typo anywhere in the list became a black hole that swallowed the whole
     * account. Reproduced: `Oops = topc:ai` drew one shelf holding all three
     * repos and the configured `misc` shelf vanished.
     *
     * It is the exact inversion of the charter's failure shape, which is
     * always "that repo lands in Ungrouped and the page still renders" — and
     * of this file's own docstring. An unreadable rule is named in the toolbar
     * AND holds nothing. */
    if (!(rule.terms || []).length) return { yes: false, unknown: false };

    /* EVERY TERM IS EVALUATED, none skipped. `.every()` short-circuits, so a
     * term that failed BEFORE an unjudgeable one hid the unknown entirely —
     * `lang:python topic:zzz` reported unknown and `topic:zzz lang:python` did
     * not, for the same repo and the same rule. A count that depends on the
     * order the reader happened to type is not a count. */
    let ok = true;
    (rule.terms || []).forEach((t) => {
      let hit;

      if (t.kind === "any") {
        /* THE BARE WORD OBEYS THE SAME TWO RULES AS EVERY NAMED TERM, because
         * it used to obey neither: it searched the full `owner/name`, so on an
         * account called StarFleet1334 the word `star` matched all 54 rows —
         * the scar `name:` was already fixed for — and it returned before
         * `carries` was consulted, so it answered a confident `false` about a
         * description nobody had read. */
        const bare = String(f.name || "").toLowerCase().split("/").pop();
        const canDesc = S.carries(f.via, "description");
        const hay = [bare, canDesc ? f.description || "" : "", list.join(" ")]
          .join(" ").toLowerCase();
        hit = hay.indexOf(t.value) !== -1;
        if (!hit && !canDesc) unknown = true;
        ok = ok && (t.not ? !hit : hit);
        return;
      }

      /* WHICH SOURCE ANSWERED IS PART OF THE ANSWER. `facts.js` records `via`
       * for exactly this: a field missing from an API record and a field the
       * repository does not have are different statements. */
      if (!S.carries(f.via, t.where)) {
        unknown = true;
        ok = false;
        return;
      }

      if (t.kind === "list") {
        hit = list.indexOf(t.value) !== -1;
      } else if (t.kind === "text") {
        hit = String(f[t.where] || "").toLowerCase().indexOf(t.value) !== -1;
      } else if (t.kind === "exact") {
        hit = String(f[t.where] || "").toLowerCase() === t.value;
      } else if (t.kind === "tail") {
        const bare = String(f[t.where] || "").toLowerCase().split("/").pop();
        hit = bare.indexOf(t.value) !== -1;
      } else if (t.kind === "bool") {
        hit = !!f[t.where] === t.value;
      } else if (t.kind === "number") {
        const got = num(f[t.where]);
        if (got === null) { unknown = true; ok = false; return; }
        hit = compare(t.op, got, t.value);
      } else if (t.kind === "age") {
        const got = num(f[t.where]);
        if (got === null) { unknown = true; ok = false; return; }
        /* `pushed:<90d` reads as "pushed within the last 90 days", which is the
         * plain-English sense and the reverse of the arithmetic: a SMALLER age
         * is a MORE recent push. */
        const days = (when - got) / 86400000;
        hit = compare(t.op, days, t.value);
      } else {
        ok = false;
        return;
      }
      ok = ok && (t.not ? !hit : hit);
    });

    return { yes: ok, unknown };
  };
})(globalThis.Shelves);
