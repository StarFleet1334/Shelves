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
  /* ---- SUGGESTED SHELVES ---------------------------------------------- */
  /* THE FIRST DAY IS THE HARDEST DAY AND IT IS THE ONE NOBODY BUILT FOR.
   * A reader who has never tagged a repo gets one shelf called Ungrouped
   * holding all of them — measured on a real profile, 68 of 77. The audit
   * already tells them so; it has never been able to offer them anything to
   * press about it.
   *
   * Everything this needs is already computed. `vocabulary()` gives every
   * topic with its repo count; `facts` carries a language per repo; the names
   * are on the rows. What was missing was the one write to `settings.groups`.
   *
   * THREE KINDS, AND THEY ARE NOT INTERCHANGEABLE:
   *
   *   topic     a real tag that is not yet a shelf. The strongest kind: the
   *             shelving engine already matches topics, so accepting one is
   *             pure configuration and nothing else has to happen.
   *   prefix    a shared leading word in the NAMES — WireMock-Api,
   *             WireMock-Data, WireMock-Demo. The only kind that works on an
   *             account with no topics at all, which is the account this whole
   *             section exists for.
   *   language  a language several repos share. Named in "deliberately not
   *             doing" as forbidden AS A PERMANENT AXIS and explicitly allowed
   *             as a one-time suggestion that becomes an ordinary shelf. That
   *             distinction is the whole reason this returns a shelf name and
   *             not a filter.
   *
   * A prefix or a language shelf matches no topic, so accepting one has to
   * write OVERRIDES for the repos it named as well as the shelf itself —
   * which is why `repos` is carried on every suggestion and not just a count.
   * A topic suggestion carries them too, and the caller simply does not need
   * them. One shape, one accept path.
   */
  const STOP = /^(the|a|my|new|test|demo|app|project|repo|old|tmp|temp|main|src|www)$/i;

  /* NAMES ARRIVE LOWERCASED. `fullNameOf` lowercases, and so does the API
   * body, so `GymCRM-System` reaches this file as `gymcrm-system` and every
   * camel boundary the first version leaned on is already gone. Grouping has
   * to work on the characters that survive.
   *
   * So: sort the bare names and walk them, keeping a run together while the
   * prefix they ALL share is still at least three characters. Sorting is what
   * makes one pass enough — names sharing a prefix are adjacent. The label is
   * that shared prefix, which is why `wiremock-api|-data|-demo` becomes
   * `wiremock` and not `wire`, and why `gym`, `gym-project`, `gymapplication`
   * and `gymcrm-system` become one `gym` rather than three singletons. */
  const MIN_PREFIX = 3;

  const bareOf = (n) => String(n || "").split("/").pop().toLowerCase();

  function common(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    /* Never end on half a surrogate pair: `common` walks UTF-16 code units, so
     * two names agreeing up to an emoji and differing inside it would yield a
     * lone surrogate as the shelf's NAME. `safeRepo` makes that unreachable
     * from GitHub today, which is a reason to spend one line on it rather than
     * a reason to leave a function that can return broken text. */
    if (i > 0 && i < a.length) {
      const c = a.charCodeAt(i - 1);
      if (c >= 0xd800 && c <= 0xdbff) i--;
    }
    return a.slice(0, i);
  }

  /** @returns {Array<{label, repos: string[]}>} */
  function prefixRuns(names) {
    const rows = names
      .map((n) => ({ full: n, bare: bareOf(n) }))
      .filter((r) => r.bare)
      .sort((a, b) => a.bare.localeCompare(b.bare));
    const runs = [];
    let run = null;
    for (const r of rows) {
      if (run) {
        const pre = common(run.pre, r.bare);
        if (pre.length >= MIN_PREFIX) {
          run.pre = pre;
          run.repos.push(r.full);
          continue;
        }
        runs.push(run);
      }
      run = { pre: r.bare, repos: [r.full] };
    }
    if (run) runs.push(run);
    return runs
      .map((x) => ({ label: x.pre.replace(/[-_.\s]+$/, ""), repos: x.repos }))
      .filter((x) => x.label.length >= MIN_PREFIX && !STOP.test(x.label));
  }

  /**
   * @returns {Array<{kind, label, count, repos: string[], why: string}>}
   *          ranked, capped, and empty when there is nothing worth offering.
   */
  /**
   * @param {Set<string>=} placed  repos already on a real shelf — by topic, by
   *        a configured group, or because the reader put them there by hand.
   *
   * A REPO THAT ALREADY HAS A SHELF IS NOT EVIDENCE FOR ANOTHER ONE, and
   * counting it is not a rounding error, it is a promise the shelf cannot
   * keep: an override outranks every topic, so a repo pinned to `wiremock`
   * will never land on a `Java` shelf however many times it is counted
   * towards one. Measured on the live page — accepting `wiremock` left the
   * next suggestion reading `add Java (26)` for 23 repos it could get.
   *
   * It also settles a subtler case for free. With no groups configured every
   * topic is ALREADY an auto-derived shelf, so offering to add one describes
   * a shelf the reader is looking at. Excluding placed repos drops those
   * offers to zero without a rule of their own.
   */
  S.suggestions = function suggestions(vdata, facts, names, settings, placed) {
    const out = [];
    const nm = (names || []).map((n) => String(n || "").toLowerCase());
    const total = nm.filter(Boolean).length;
    const groups = ((settings || {}).groups || []).map((g) => g.toLowerCase());
    const isShelf = (label) => groups.indexOf(String(label).toLowerCase()) !== -1;
    const done = placed || new Set();

    /* A SHELF THAT HOLDS HALF THE COLLECTION IS UNGROUPED WEARING A HAT.
     * `vocabulary()` already names that shape as a "blanket label" and treats
     * it as a finding; offering to build one would be the panel recommending
     * the very thing it complains about. On the profile this was measured
     * against, Java is 37 of 77 — a Java shelf is not a shelf. */
    /* A SHELF HOLDING THE WHOLE COLLECTION IS A BLANKET AT ANY SIZE. The
     * `total >= 6` floor exists so a 7-repo account is not refused a 4-repo
     * shelf, and it switched the rule off exactly where the collection is
     * smallest: five repos all in Go offered `add Go (5)`, which is the flat
     * list with a name on it. The floor now applies only to the "more than
     * half" half; covering EVERYTHING is always a blanket. */
    const blanket = (n) => n >= total || (total >= 6 && n > total / 2);

    /* A repo already answered by a suggestion is not evidence for the next
     * one. Without this the same repos argue for a topic, then a prefix, then
     * a language, and the reader is offered three shelves for one set. */
    const spoken = new Set(done);

    (vdata.terms || []).forEach((t) => {
      if (isShelf(t.topic)) return;
      const repos = t.repos.map((r) => String(r).toLowerCase())
                           .filter((r) => !spoken.has(r));
      if (repos.length < 2 || blanket(repos.length)) return;
      out.push({
        kind: "topic", label: t.topic, count: repos.length, repos,
        why: "a topic " + repos.length + " repos already carry",
      });
      repos.forEach((r) => spoken.add(r));
    });

    prefixRuns(nm.filter((n) => n && !spoken.has(n))).forEach((run) => {
      if (run.repos.length < 3 || isShelf(run.label) || blanket(run.repos.length)) return;
      out.push({
        kind: "prefix", label: run.label, count: run.repos.length, repos: run.repos,
        why: run.repos.length + " repos whose names start with it",
      });
      run.repos.forEach((r) => spoken.add(r));
    });

    const byLang = new Map();
    (facts || []).forEach((f, i) => {
      const l = f && f.language;
      const n = nm[i];
      if (!l || !n || spoken.has(n)) return;
      if (!byLang.has(l)) byLang.set(l, []);
      byLang.get(l).push(n);
    });
    [...byLang.entries()].forEach(([l, repos]) => {
      if (repos.length < 3 || isShelf(l) || blanket(repos.length)) return;
      out.push({
        kind: "language", label: l, count: repos.length, repos,
        why: repos.length + " repos written in it",
      });
    });

    /* Ranked by reach, and CAPPED — a suggestion list longer than the shelves
     * it offers to build is a second dump. Ten is also roughly where the
     * palette stops having a spare hue (identity(), view.js), so it is where
     * more offers stop being more legible. */
    return out
      .sort((a, b) => b.count - a.count ||
                      a.kind.localeCompare(b.kind) ||
                      a.label.localeCompare(b.label))
      .slice(0, 10);
  };

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
      words: parts(f.spellings[0].topic),
    }));

    /* ── IT USED TO COMPARE EVERY PAIR, AND IT RAN ON EVERY RENDER ──────────
     * `vocabulary()` is called unconditionally to compute the toolbar badge,
     * whether or not anyone opens the panel — so this loop was on the critical
     * path of drawing the page. Measured, blocking the main thread: 330 ms at
     * 1 000 distinct topics, 1.3 s at 2 000, 5.2 s at 4 000, and 25 s on a
     * synthetic 600-repo account. That is not a slow panel, it is a frozen tab,
     * and the accounts it freezes are exactly the ones this extension is for.
     *
     * The fix is two indexes rather than a cap, because a cap would have
     * silently dropped findings on precisely the collections that need them.
     * Neither question actually requires comparing every pair:
     *
     *   NARROWER — only a single-word topic can be a word inside a multi-word
     *     one, so index the multi-word topics BY THEIR WORDS and look each
     *     single one up. O(total words) instead of O(k²), and `parts()` is now
     *     computed once per topic rather than twice per pair.
     *
     *   TYPO — two strings are within one edit iff their deletion
     *     neighbourhoods intersect (delete the inserted char, or the differing
     *     char from both). So index every key alongside its one-character
     *     deletions and only compare inside a shared bucket. `within1` still
     *     confirms each candidate, because a shared variant proves distance
     *     ≤ 2, not ≤ 1.
     *
     * The bucket cap is the one place a limit is right: a bucket of 400 keys
     * means four hundred topics one character apart, which is a naming scheme
     * (`v1`, `v2`, `v3`…) and not four hundred typos. Reporting it would be
     * noise, and comparing it would be the quadratic back again. */
    const near = [];
    const seenPair = new Set();
    const add = (o) => {
      /* A separator that cannot occur in a topic — GitHub topics are
         * [a-z0-9-] — written as an ESCAPE and not as the character
         * itself. A literal NUL in a source file makes git and grep
         * call it binary and gives packaging tools something to choke
         * on, for no behavioural difference whatsoever. */
      /* A separator that cannot occur in a topic (GitHub topics are
       * [a-z0-9-]) — written as an ESCAPE, not as the character itself.
       * A literal NUL in source makes git and grep call the file binary
       * and gives packaging tools something to choke on, for exactly no
       * behavioural difference. */
      const k = o.a < o.b ? o.a + "\u0000" + o.b : o.b + "\u0000" + o.a;
      if (seenPair.has(k)) return;
      seenPair.add(k);
      near.push(o);
    };
    const bucket = (map, key, rep) => {
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(rep);
    };

    // narrower: a word index over the multi-word topics
    const byWord = new Map();
    reps.forEach((r) => {
      if (r.words.length > 1) r.words.forEach((w) => bucket(byWord, w, r));
    });
    reps.forEach((r) => {
      if (r.words.length !== 1) return;
      (byWord.get(r.words[0]) || []).forEach((m) => {
        if (m === r) return;
        add({
          a: r.topic, b: m.topic, kind: "narrower",
          why: "'" + r.topic + "' is a whole word inside '" + m.topic + "'",
        });
      });
    });

    // typo: a deletion-neighbourhood index over the keys
    const BUCKET_MAX = 24;
    const byVariant = new Map();
    reps.forEach((r) => {
      if (r.key.length < 5) return;
      bucket(byVariant, r.key, r);
      for (let i = 0; i < r.key.length; i++) {
        bucket(byVariant, r.key.slice(0, i) + r.key.slice(i + 1), r);
      }
    });
    byVariant.forEach((list) => {
      if (list.length < 2 || list.length > BUCKET_MAX) return;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i] === list[j]) continue;
          if (!within1(list[i].key, list[j].key)) continue;
          add({
            a: list[i].topic, b: list[j].topic,
            kind: "typo", why: "one character apart",
          });
        }
      }
    });

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

    /* FIXING THE ARITHMETIC EXPOSED THE OTHER HALF. With the quadratic gone,
     * a 9 000-topic collection resolves in 45 ms — and hands back 7 741
     * suspicions, which is 7 741 buttons with 7 741 listeners in a panel no
     * human reads. An unbounded computation and an unbounded DOM are the same
     * bug wearing different clothes.
     *
     * So the LISTS are capped and the caps are STATED. A silent truncation
     * would read as "these are all your problems", which is the one thing this
     * panel exists not to do. */
    const NEAR_MAX = 40;
    const TERMS_MAX = 200;
    return {
      repos: rows.length,
      tagged,
      untagged: rows.length - tagged,
      terms: terms.slice(0, TERMS_MAX),
      termsMore: Math.max(0, terms.length - TERMS_MAX),
      termCount: terms.length,
      families,
      near: near.slice(0, NEAR_MAX),
      nearMore: Math.max(0, near.length - NEAR_MAX),
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
      v.tagged + " of " + v.repos + " repos tagged · " +
      (v.termCount == null ? v.terms.length : v.termCount) + " topics"));

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

    if (v.nearMore) {
      found.append(finding("more", "+" + v.nearMore + " more",
        ["suspicions not shown — this vocabulary has more near-misses than a " +
         "list can usefully hold, which is itself the finding"]));
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
      out.push(el("div", "sh-v-mini",
        v.termsMore ? "top " + v.terms.length + " topics of " + v.termCount
                    : "every topic"));
      const all = el("div", "sh-v-all");
      v.terms.forEach((t) => all.append(term(t.topic, t.count)));
      if (v.termsMore) all.append(el("span", "sh-v-more", "+" + v.termsMore + " more"));
      out.push(all);
    } else {
      out.push(el("div", "sh-v-clean",
        "No topics at all yet — nothing here has a vocabulary to show. " +
        "Topics are added on a repo's own page, under About."));
    }

    return out;
  };
})(globalThis.Shelves);
