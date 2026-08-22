/* SHELVES — vocab.js
 *
 * THE TAG SYSTEM, SEEN AS A SYSTEM.
 *
 * Everywhere else in this extension a topic is an input: something to bucket a
 * row by. Here the topics ARE the subject. GitHub will show you one repo's
 * topics, and it will show you every repo carrying one topic, but there is no
 * page anywhere — GitHub's or anyone else's — that shows you your own labelling
 * vocabulary as a whole. So nobody has ever seen that `ai`, `ai-project` and
 * `aiproject` are three spellings of one idea, that eleven topics are used
 * exactly once and therefore group nothing, or that the topic on 38 of 41
 * tagged repos carries no information at all. That invisibility is precisely
 * why a tag vocabulary rots: every individual decision looked fine.
 *
 * This file is pure analysis plus the panel that draws it. It reads the topics
 * the ladder already resolved — no request, no storage, nothing new fetched —
 * and it writes nothing anywhere. Acting on what it says is still the owner's
 * job on GitHub, because principle I means we do not edit topics.
 *
 * WHAT IS CERTAIN AND WHAT IS A GUESS ARE DRAWN DIFFERENTLY, and that is the
 * whole ethic of the panel. `ai-project` and `aiproject` are the same letters:
 * calling them one idea is arithmetic. `ai` and `ai-project` merely LOOK
 * related, and merging them would be this file inventing a fact. So the first
 * is reported as a family and the second as a suspicion, and neither is ever
 * applied to anything.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  /* ---- the comparisons -------------------------------------------------- */

  /** Every separator GitHub allows, gone: `AI_Project` and `ai-project` are
   *  the same string with different punctuation, and that is not a judgement. */
  const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "");

  /** The topic split into its words, which is the only way to ask whether one
   *  topic is a WORD inside another rather than a substring of it — `go` is a
   *  substring of `google` and a word inside neither. */
  const parts = (t) => String(t).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  /** `tools` → `tool`. Guarded at four letters (`cs`, `js`, `aws` keep their
   *  s) and at a double s (`css` is not a plural of `cs`). */
  function stem(k) {
    return k.length > 4 && /[^s]s$/.test(k) ? k.slice(0, -1) : k;
  }

  /** One insertion, deletion or substitution apart. Early-exits on the second
   *  edit, so it is a scan and not a Levenshtein matrix — the panel compares
   *  every topic with every other one and n is however many the owner has. */
  function within1(a, b) {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la > lb) i++;
      else if (lb > la) j++;
      else { i++; j++; }
    }
    return edits + (la - i) + (lb - j) <= 1;
  }

  /** [narrow, wide] when one topic is a single word appearing whole inside the
   *  other, else null. `ai` / `ai-project` yes; `go` / `google` no. */
  function inside(x, y) {
    const px = parts(x), py = parts(y);
    if (px.length === 1 && py.length > 1 && py.indexOf(px[0]) !== -1) return [x, y];
    if (py.length === 1 && px.length > 1 && px.indexOf(py[0]) !== -1) return [y, x];
    return null;
  }

  /* ---- the reading ------------------------------------------------------ */

  /**
   * @param {string[][]} topicsPerRepo  parallel to the rows, as the ladder left it
   * @param {string[]}   names          parallel too; only used to name repos back
   * @returns {object} the vocabulary — counts, families, suspicions, and the
   *          two shapes of topic that cannot do a shelf's job.
   */
  S.vocabulary = function vocabulary(topicsPerRepo, names) {
    const rows = Array.isArray(topicsPerRepo) ? topicsPerRepo : [];
    const nm = names || [];

    const byTopic = new Map();          // topic -> Set of row indices
    let tagged = 0;
    rows.forEach((list, i) => {
      const ts = Array.isArray(list) ? list : [];
      if (ts.length) tagged++;
      ts.forEach((raw) => {
        const t = String(raw || "").toLowerCase().trim();
        if (!t) return;
        if (!byTopic.has(t)) byTopic.set(t, new Set());
        byTopic.get(t).add(i);
      });
    });

    const terms = [...byTopic.entries()]
      .map(([topic, set]) => ({
        topic,
        count: set.size,
        repos: [...set].map((i) => nm[i] || String(i)),
      }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));

    /* A FAMILY IS ARITHMETIC, NOT A GUESS: same letters, same order, once
     * punctuation and a plural are set aside. Counting the repos as a UNION
     * and not a sum is the number that matters — three spellings on the same
     * nine repos is nine repos, and reporting 14 would make a labelling
     * problem look like a bigger collection. */
    const fam = new Map();
    terms.forEach((t) => {
      const key = stem(norm(t.topic));
      if (!key) return;
      if (!fam.has(key)) fam.set(key, { key, spellings: [], repos: new Set() });
      const f = fam.get(key);
      f.spellings.push({ topic: t.topic, count: t.count });
      byTopic.get(t.topic).forEach((i) => f.repos.add(i));
    });

    const families = [...fam.values()]
      .filter((f) => f.spellings.length > 1)
      .map((f) => ({ key: f.key, spellings: f.spellings, count: f.repos.size }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

    /* SUSPICIONS ARE COMPARED FAMILY TO FAMILY, one representative each, so a
     * family of three spellings raises one suspicion against its neighbour and
     * not nine. The representative is the most-used spelling, because that is
     * the one the owner would keep. */
    const reps = [...fam.values()].map((f) => ({
      key: f.key,
      topic: f.spellings[0].topic,      // spellings arrive count-descending
    }));
    const near = [];
    for (let i = 0; i < reps.length; i++) {
      for (let j = i + 1; j < reps.length; j++) {
        const a = reps[i], b = reps[j];
        if (a.key.length >= 5 && b.key.length >= 5 && within1(a.key, b.key)) {
          near.push({ a: a.topic, b: b.topic, kind: "typo", why: "one character apart" });
          continue;
        }
        const pair = inside(a.topic, b.topic);
        if (pair) {
          near.push({
            a: pair[0], b: pair[1], kind: "narrower",
            why: "'" + pair[0] + "' is a whole word inside '" + pair[1] + "'",
          });
        }
      }
    }

    /* A TOPIC ON ALMOST EVERYTHING IS NOT A LABEL, IT IS A HEADER. It cannot
     * separate anything from anything, so as a shelf it reproduces the flat
     * list it was supposed to replace. The floors are there because 2 of 3 is
     * a small collection, not a blanket. */
    const blanket = terms
      .filter((t) => tagged >= 4 && t.count >= 3 && t.count / tagged >= 0.6)
      .map((t) => ({ topic: t.topic, count: t.count, share: t.count / tagged }));

    /* The opposite failure: a topic on exactly one repo names that repo. It is
     * a description, and it will make a shelf of one. */
    const singletons = terms.filter((t) => t.count === 1).map((t) => t.topic);

    return {
      repos: rows.length,
      tagged,
      untagged: rows.length - tagged,
      terms,
      families,
      near,
      blanket,
      singletons,
    };
  };

  /** How many things the panel would tell you, for the button's badge. The
   *  singleton list is ONE finding however long it is — twelve topics used
   *  once is one habit, and badging it as twelve would drown the families. */
  S.vocabIssues = function vocabIssues(v) {
    if (!v) return 0;
    return v.families.length + v.near.length + v.blanket.length +
           (v.singletons.length > 1 ? 1 : 0);
  };

  /* ---- the panel -------------------------------------------------------- */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /**
   * THE PANEL'S FURNITURE, SHARED. The vocabulary reads the topics and the
   * audit (audit.js) reads the repositories; they are two questions about one
   * collection and belong under one press, so they are two SECTIONS of one
   * panel rather than two buttons in a toolbar that already wraps. The kit is
   * what keeps them looking like one thing: a finding is drawn identically
   * whichever section made it, and neither file owns the panel.
   *
   * @param {object} opts  identity: Map(label -> mark) so a topic that is
   *                       already a shelf wears that shelf's own mark;
   *                       onPick(topic): filter by text;
   *                       onRepos(names, label): filter to an explicit set.
   *                       Neither section knows what a filter is.
   */
  S.panelKit = function panelKit(opts) {
    const o = opts || {};
    const id = o.identity || new Map();

    /* A TOPIC IS A BUTTON, and pressing it filters the page to the repos that
     * carry it. Reading that a label is broken is half of it; the other half is
     * seeing which twelve repos are wearing it, which is one click away and was
     * previously a search nobody could express. */
    function term(topic, count) {
      const b = el("button", "sh-term");
      b.type = "button";
      const mark = id.get(topic);
      if (mark) {
        b.dataset.shelf = "1";
        b.title = "'" + topic + "' is one of your shelves — " + count + " repos";
        S.paintMark(b, mark);
        b.append(el("span", "sh-term-g", mark.glyph));
      } else {
        b.title = "show the " + count + " repos tagged '" + topic + "'";
      }
      b.append(el("span", "sh-term-n", topic));
      if (count != null) b.append(el("span", "sh-term-c", String(count)));
      b.addEventListener("click", () => o.onPick && o.onPick(topic));
      return b;
    }

    /* THE AUDIT'S BUTTON CANNOT BE THE TOPIC'S. "the 12 repos with no
     * description" is not a substring anyone can type, so it addresses rows by
     * NAME instead of by text — which is why applyFilter grew a second mode
     * rather than this pretending a query exists. */
    function pick(word, names, title, says) {
      const b = el("button", "sh-term");
      b.type = "button";
      b.dataset.pick = "1";
      b.title = title || ("show these " + names.length);
      b.append(el("span", "sh-term-n", word));
      b.append(el("span", "sh-term-c", String(names.length)));
      /* THE WORD ON THE BUTTON IS NOT THE NAME OF THE SET. The button says
       * SHOW because that is what pressing it does; the bar afterwards has to
       * say "2 no README of 5", because by then the button is off screen and
       * "2 show of 5" is not a sentence. Passing one string for both jobs read
       * fine in the code and was nonsense on the page. */
      b.addEventListener("click", () => o.onRepos && o.onRepos(names, says || word));
      return b;
    }

    function finding(kind, label, body) {
      const f = el("div", "sh-v-find");
      f.dataset.kind = kind;
      f.append(el("span", "sh-v-tag", label));
      const rest = el("span", "sh-v-body");
      body.forEach((n) => rest.append(typeof n === "string" ? document.createTextNode(n) : n));
      f.append(rest);
      return f;
    }

    return { el, term, pick, finding };
  };

  /**
   * @param {object} v    what S.vocabulary() returned
   * @param {object} kit  from S.panelKit()
   * @returns {Node[]}    the TOPICS half of the panel
   */
  S.vocabSection = function vocabSection(v, kit) {
    const { term, finding } = kit;
    const out = [];

    out.push(el("div", "sh-v-label", "topics"));
    out.push(el("div", "sh-v-sub",
      v.tagged + " of " + v.repos + " repos tagged · " + v.terms.length + " topics"));

    const found = el("div", "sh-v-finds");

    v.families.forEach((f) => {
      const bits = [];
      f.spellings.forEach((sp, i) => {
        if (i) bits.push(" ");
        bits.push(term(sp.topic, sp.count));
      });
      bits.push(" — " + f.spellings.length + " spellings of one idea, across " +
                f.count + (f.count === 1 ? " repo" : " repos"));
      found.append(finding("family", "one idea", bits));
    });

    v.near.forEach((n) => {
      found.append(finding(n.kind, n.kind === "typo" ? "typo?" : "narrower",
        [term(n.a), " ", term(n.b), " — " + n.why]));
    });

    v.blanket.forEach((b) => {
      found.append(finding("blanket", "blanket",
        [term(b.topic, b.count),
         " — on " + b.count + " of " + v.tagged + " tagged repos, so it separates almost nothing"]));
    });

    if (v.singletons.length > 1) {
      const bits = [];
      v.singletons.slice(0, 14).forEach((t, i) => {
        if (i) bits.push(" ");
        bits.push(term(t, 1));
      });
      if (v.singletons.length > 14) bits.push(" +" + (v.singletons.length - 14) + " more");
      bits.push(" — used once each: they describe a repo rather than group one");
      found.append(finding("once", v.singletons.length + " used once", bits));
    }

    if (found.childNodes.length) {
      out.push(found);
    } else if (v.terms.length) {
      out.push(el("div", "sh-v-clean",
        "No duplicate spellings, no blanket labels, nothing used only once. " +
        "This vocabulary is doing its job."));
    }

    if (v.terms.length) {
      /* Photographed: without this the full topic list butts straight up
         against the last finding and reads as part of it — one more row of
         evidence for a claim nobody made. */
      out.push(el("div", "sh-v-mini", "every topic"));
      const all = el("div", "sh-v-all");
      v.terms.forEach((t) => all.append(term(t.topic, t.count)));
      out.push(all);
    } else {
      out.push(el("div", "sh-v-clean",
        "No topics at all yet — nothing here has a vocabulary to show. " +
        "Topics are added on a repo's own page, under About."));
    }

    return out;
  };
})(globalThis.Shelves);
