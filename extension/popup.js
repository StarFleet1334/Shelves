/* SHELVES — popup.js
 *
 * THE TOOLBAR BUTTON IS A STATUS INSTRUMENT, NOT A SETTINGS FORM. It used to
 * open options.html, so the one question the button is pressed to answer — is
 * this working, and what did it group? — was answerable only from the page you
 * had to already be standing on (the `paintNote2` line in src/view.js). This
 * surface says the same sentence from anywhere, and puts the form behind a link.
 *
 * It reads local storage and renders. No network request, no write, and NO new
 * permission: `chrome.tabs.query` is enough because MV3 hands back `url` only
 * for a tab the extension already has host permission for — github.com, which
 * manifest.json has had since v1 — and redacts it everywhere else. A missing
 * `url` is therefore the signal "not on GitHub", not an error (P.II).
 *
 * Every number here is either measured or absent. A field the record does not
 * carry means the row is not drawn — never a zero this surface cannot vouch
 * for (P.IV).
 */
"use strict";

(function () {
  const S = globalThis.Shelves;

  /* ---- the URL parse, mirrored from src/dom.js -------------------------- */
  /* It is a COPY and it has to be. `S.isRepoTab` / `S.owner` / `isRepoPage`
   * live in dom.js, which is a content-script module: it reads the live
   * `document` and `location`, registers against GitHub's markup, and in a
   * popup both of those are the popup's own chrome-extension:// page. Loading
   * it here would answer about this document, not the tab's. So the dozen lines
   * below reproduce only the URL rules — one path segment plus
   * `?tab=repositories`, lowercased owner, and GitHub's own reserved path names
   * denied — and nothing else. If the deny list changes in dom.js, change it
   * here too; the cost of drift is one wrong line in this panel. */
  const RESERVED = new Set([
    "about", "account", "apps", "blog", "business", "codespaces", "collections",
    "contact", "customer-stories", "dashboard", "enterprise", "events",
    "explore", "features", "gist", "issues", "join", "login", "logout",
    "marketplace", "new", "notifications", "orgs", "pricing", "pulls",
    "readme", "search", "security", "sessions", "settings", "site", "sponsors",
    "stars", "topics", "trending", "users", "watching", "welcome",
  ]);

  function readUrl(raw) {
    const out = { github: false, owner: "", repoTab: false, repo: "", name: "" };
    let u;
    try {
      u = new URL(String(raw || ""));
    } catch (e) {
      return out;                       // no url at all: a non-GitHub tab
    }
    if (u.protocol !== "https:" || u.hostname !== "github.com") return out;
    out.github = true;
    const parts = u.pathname.split("/").filter(Boolean);
    const owner = (parts[0] || "").toLowerCase();
    if (!owner || RESERVED.has(owner)) return out;
    out.owner = owner;
    out.repoTab = parts.length === 1 && u.searchParams.get("tab") === "repositories";
    /* THE SECOND SEGMENT IS THE REPOSITORY, and it is the key `shelfmap` is
     * already keyed by (`on: {"owner/repo": label}`), so a repo page can be
     * answered about ITSELF rather than answered about somewhere else. Deeper
     * paths — /issues/4, /blob/main/x — are still that repository, which is why
     * only the first two segments are read. */
    if (parts.length >= 2) {
      out.name = parts[1];
      out.repo = owner + "/" + parts[1].toLowerCase();
    }
    return out;
  }

  /* ---- drawing ---------------------------------------------------------- */

  const byId = (id) => document.getElementById(id);
  let rowN = 0;

  function chip(text, tone) {
    const c = byId("chip");
    const t = byId("chipText");
    if (!c || !t) return;
    c.className = "chip" + (tone ? " " + tone : "");
    t.textContent = text;
  }

  function lede(text, now) {
    const box = byId("lede");
    if (!box || !text) return;
    const p = document.createElement("p");
    p.className = now ? "lede now" : "lede";
    p.textContent = text;
    box.appendChild(p);
  }

  /* ---- the drawn half --------------------------------------------------- */
  /* IDENTITY IS RESOLVED, NEVER STORED — and `src/identity.js` is why this
   * surface may resolve it at all. `S.identity` is a pure hash of the shelf's
   * name over the WHOLE label set (collisions walk, so a subset answers
   * differently), which is what makes the colour here the same colour the page
   * and the About-sidebar chip wear, with nothing persisted to drift. */
  function marksFor(st, otherLabel) {
    if (!S.identity || !st || !Array.isArray(st.order)) return null;
    try {
      return S.identity(st.order, otherLabel);
    } catch (e) {
      return null;                      // no colour is survivable; a wrong one is not
    }
  }

  function paint(node, m) {
    if (!m || m.hue == null) { node.classList.add("plain"); return; }
    node.style.setProperty("--sh-hue", String(m.hue));
    node.style.setProperty("--sh-sat", m.sat + "%");
    node.style.setProperty("--sh-lit", m.lit + "%");
  }

  /** The chip `mark.js` prepends to a repository's About sidebar, same shape. */
  function mark(label, count, m) {
    const box = byId("mark");
    if (!box || !label) return;
    const chipEl = document.createElement("span");
    chipEl.className = "mark";
    paint(chipEl, m);
    if (m && m.glyph) {
      const g = document.createElement("span");
      g.className = "g";
      g.setAttribute("aria-hidden", "true");
      g.textContent = m.glyph;
      chipEl.appendChild(g);
    }
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = label;
    chipEl.appendChild(n);
    if (count !== null && count !== undefined) {
      const c = document.createElement("span");
      c.className = "c";
      c.textContent = String(count);
      chipEl.appendChild(c);
    }
    box.appendChild(chipEl);
  }

  /** The shelves, as shelves: glyph, name, a bar at its true share, the count.
   *  Capped, because a popup is not the page — the tail is reported, not drawn. */
  function strip(st, otherLabel, cap) {
    const box = byId("strip");
    if (!box || !st || !Array.isArray(st.order) || !st.order.length) return;
    const m = marksFor(st, otherLabel);
    const counts = st.counts || {};
    const top = Math.max.apply(null, st.order.map((l) => num(counts[l]) || 0).concat([1]));
    const shown = st.order.slice(0, cap);
    /* A LABELLED RULE, because without one the strip reads as a stray list
     * hanging off the bottom of the panel — three words with numbers beside
     * them, in a surface whose every other block says what it is. */
    const head = document.createElement("div");
    head.className = "sep";
    head.textContent = st.standDown ? "their shelves" : "your shelves";
    box.appendChild(head);
    const wrap = document.createElement("div");
    wrap.className = "strip";
    shown.forEach((label) => {
      const n = num(counts[label]);
      const r = document.createElement("div");
      r.className = "shelf";
      const mk = m ? m.get(label) : null;
      paint(r, mk);
      const g = document.createElement("span");
      g.className = "g";
      g.setAttribute("aria-hidden", "true");
      g.textContent = (mk && mk.glyph) || "·";
      const nm = document.createElement("span");
      nm.className = "n";
      nm.textContent = label;
      const bar = document.createElement("span");
      bar.className = "bar";
      const fill = document.createElement("i");
      fill.style.width = Math.round(((n || 0) / top) * 100) + "%";
      bar.appendChild(fill);
      const c = document.createElement("span");
      c.className = "c";
      c.textContent = n === null ? "" : String(n);
      /* One row, one sentence, for a reader who cannot see any of the above. */
      r.setAttribute("role", "listitem");
      r.setAttribute("aria-label", label + ", " + (n === null ? "unknown" : n) +
                     (n === 1 ? " repository" : " repositories"));
      [g, nm, bar, c].forEach((x) => r.appendChild(x));
      wrap.appendChild(r);
    });
    if (st.order.length > shown.length) {
      const more = document.createElement("div");
      more.className = "more";
      more.textContent = "+ " + (st.order.length - shown.length) + " more";
      wrap.appendChild(more);
    }
    wrap.setAttribute("role", "list");
    box.appendChild(wrap);
  }

  /** Pages read, pages not — the one thing the truncation sentence is bad at. */
  function ladder(st) {
    const box = byId("flags");
    if (!box || !st.truncated || st.pagesRead === null) return null;
    const read = st.pagesRead + 1;                 // page one, plus what was fetched
    const lost = st.unread === null ? 3 : Math.min(12, Math.ceil(st.unread / 30));
    if (read > 40) return null;                   // past that it is a texture, not a count
    const l = document.createElement("div");
    l.className = "ladder";
    l.setAttribute("role", "img");
    l.setAttribute("aria-label", read + " pages of the list read, " +
      (st.unread === null ? "an unknown number" : "about " + lost) + " not read");
    for (let i = 0; i < read; i++) l.appendChild(document.createElement("i"));
    for (let i = 0; i < lost; i++) {
      const x = document.createElement("i");
      x.className = "lost";
      l.appendChild(x);
    }
    return l;
  }

  /** A labelled rule over whatever follows, so a demoted block says what it is
   *  instead of relying on the reader having read the sentence above it. */
  function sep(label) {
    const box = byId("lede");
    if (!box) return;
    const d = document.createElement("div");
    d.className = "sep";
    d.textContent = label;
    box.appendChild(d);
    const panel = byId("panel");
    if (panel) panel.classList.add("demoted");
  }

  /** A row is drawn only when there is a value to put in it. */
  function row(label, value) {
    const panel = byId("panel");
    if (!panel || value === null || value === undefined || value === "") return;
    const wrap = document.createElement("div");
    wrap.className = "r";
    const id = "lbl" + (++rowN);
    const dt = document.createElement("dt");
    dt.id = id;
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    if (/\d/.test(dd.textContent)) dd.className = "num";
    dd.setAttribute("aria-labelledby", id);   // explicit, over and above dl/dt/dd
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    panel.appendChild(wrap);
  }

  /** The amber block: one or more sentences, never a colour on its own. */
  function flag(lines, lead) {
    const box = byId("flags");
    const say = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
    if (!box || !say.length) return;
    const d = document.createElement("div");
    d.className = "flag";
    d.setAttribute("role", "note");
    if (lead) d.appendChild(lead);
    say.forEach((s) => {
      const p = document.createElement("p");
      p.textContent = s;
      d.appendChild(p);
    });
    box.appendChild(d);
  }

  function footer(owner) {
    const a = byId("openTab");
    if (!a) return;
    if (owner) {
      a.href = "https://github.com/" + encodeURIComponent(owner) + "?tab=repositories";
      a.textContent = "Open the Repositories tab";
    } else {
      /* No owner has ever been recorded, so there is no tab to point at. A
       * link that guessed one would be the only false statement on this
       * surface. */
      a.href = "https://github.com/";
      a.textContent = "Open GitHub";
    }
  }

  /* ---- reading the stores ----------------------------------------------- */

  const num = (v) =>
    (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : null;
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  /* store.js exposes `shelfmap.read(owner)` and no way to ask WHICH owners it
   * holds — and "the last profile Shelves grouped" is exactly that question,
   * which every off-profile state below is built on. So this reads the same
   * local key store.js writes, and nothing else does. (store.js is the other
   * agent's file this run; a verb cannot be added to it from here.) */
  function allMaps() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ shelfMap: {} }, (got) => {
          const err = chrome.runtime && chrome.runtime.lastError;
          const m = !err && got && got.shelfMap;
          resolve(m && typeof m === "object" ? m : {});
        });
      } catch (e) {
        resolve(null);                  // storage denied: a real state, state 7
      }
    });
  }

  /* THE LAST RUN IS THE LAST RUN, WHOSEVER IT WAS — AND IT SAYS WHOSE.
   *
   * This went wrong twice in opposite directions, and the second time taught
   * the rule. First it took the newest record of any kind and drew a stranger's
   * `99 repos · 3 shelves` under the words "the last profile Shelves grouped",
   * which reads as the reader's own. So it was narrowed to the reader's
   * profiles only — and that was worse: a reader who had just been looking at
   * someone else's list, on the next tab along, was shown their OWN figures
   * under a sentence claiming to report the last thing that happened. Both
   * versions were accurate about a run and wrong about which one.
   *
   * The answer is neither filter. A number read under the wrong name is fixed
   * by writing the name, not by withholding the number — the same conclusion
   * `publishMap` reached about these very records. So the newest record wins
   * whosever it is, and the caller names the owner in the sentence above the
   * rows rather than leaving "the last profile" to be assumed. */
  function latestOf(maps) {
    let best = null;
    Object.keys(maps || {}).forEach((owner) => {
      const rec = maps[owner];
      if (!rec || typeof rec !== "object") return;
      const at = num(rec.at) || 0;
      if (!best || at > best.at) best = { owner, rec, at };
    });
    return best;
  }

  /** The `status` block the profile page publishes, with every field it may
   *  not carry derived from the record itself where that is possible, and left
   *  absent where it is not. Records written before `status` existed still
   *  answer PROFILE / SHELVED / TAGGED through this. */
  function readStatus(rec, otherLabel) {
    const st = (rec && rec.status && typeof rec.status === "object") ? rec.status : {};
    const on = (rec && rec.on && typeof rec.on === "object") ? rec.on : null;
    const order = Array.isArray(rec && rec.order) ? rec.order : null;
    const counts = (rec && rec.counts && typeof rec.counts === "object") ? rec.counts : {};

    const o = {};
    o.repos = num(st.repos);
    if (o.repos === null && on) o.repos = Object.keys(on).length;
    o.total = num(st.total);            // legitimately null: the nav counter can be absent
    o.shelves = num(st.shelves);
    if (o.shelves === null && order) o.shelves = order.length;
    o.tagged = num(st.tagged);
    if (o.tagged === null && on) {
      o.tagged = Object.keys(on).filter((k) => String(on[k]) !== otherLabel).length;
    }
    /* The leftovers count is MEASURED where the record carries it, and only
     * subtracted when it does not. */
    o.other = num(counts[otherLabel]);
    if (o.other === null && o.repos !== null && o.tagged !== null && o.repos >= o.tagged) {
      o.other = o.repos - o.tagged;
    }
    o.source = str(st.source);
    o.warning = str(st.warning);
    o.health = str(st.health);
    o.unread = num(st.unread);          // null when unknown; 0 means none
    o.truncated = st.truncated === true;
    o.pagesRead = num(st.pagesRead);
    o.provisional = st.provisional === true;
    /* A stand-down is the record saying so. Nothing in a popup can read the
     * signed-in viewer (that lives in a <meta> on github.com, which this
     * surface has no way — and must buy no permission — to reach), so this is
     * believed only when written down. */
    o.standDown = st.mine === false || (rec && rec.mine === false);
    o.at = num(rec && rec.at);
    /* The shelves themselves, which nothing read until the strip wanted to
     * draw them. Carried raw so the caller can resolve identity over the whole
     * `order` at once — exactly as the page does; a subset would hand out
     * different colours. */
    o.order = order;
    o.counts = counts;
    o.on = on;
    return o;
  }

  function ago(at) {
    if (!at) return null;
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 45) return "moments ago";
    const m = Math.round(s / 60);
    if (m < 60) return plural(m, "minute", "minutes") + " ago";
    const h = Math.round(m / 60);
    if (h < 24) return plural(h, "hour", "hours") + " ago";
    return plural(Math.round(h / 24), "day", "days") + " ago";
  }

  /* ---- the panel -------------------------------------------------------- */

  function paintRows(owner, st, mine) {
    row("Profile", owner);

    if (st.repos !== null) {
      /* No fake denominator. `total` is knowable only from GitHub's own nav
       * counter with no filter applied, so "330 of 400" is drawn when it was
       * read and "330 repos" when it was not. */
      let v = (st.total !== null && st.total > st.repos)
        ? st.repos + " of " + st.total + " repos"
        : plural(st.repos, "repo", "repos");
      if (st.shelves !== null) v += " · " + plural(st.shelves, "shelf", "shelves");
      row("Shelved", v);
    } else if (st.shelves !== null) {
      row("Shelved", plural(st.shelves, "shelf", "shelves"));
    }

    if (st.tagged !== null) {
      let v = String(st.tagged);
      if (st.other !== null && st.other > 0) v += " · " + st.other + " in " + mine.otherLabel;
      row("Tagged", v);
    }

    row("Answered by", st.source || null);
    row("Your data", mine.yours);
    row("Last run", mine.lastRun);
  }

  function paintFlags(st, maxPages) {
    /* ONE CATEGORY, ONE SHAPE — the truncation, a rejected token and the
     * canary are all "something upstream is not what we assumed". */
    const unreadKnown = st.unread !== null && st.unread > 0;
    if (unreadKnown || (st.unread === null && st.truncated)) {
      const first = unreadKnown
        ? (st.unread === 1
            ? "1 repository is on a page this extension did not read."
            : st.unread + " repositories are on pages this extension did not read.")
        : "Some repositories are on pages this extension did not read.";
      const half = [];
      if (maxPages !== null) {
        /* maxPages + 1, AND THE OFF-BY-ONE IS THE WHOLE POINT. `maxPages` is
         * how many pages are FETCHED; the reader is already standing on page
         * one, so the list the extension actually reads is one longer. Printing
         * the raw setting beside "open page 12" invited a reader to do the
         * arithmetic and get 11 — two numbers that cannot both be right, in the
         * one sentence on this surface whose job is to say how far it got. The
         * setting is still named, so the options page stays findable. */
        half.push("Shelves reads at most " + plural(maxPages + 1, "page", "pages") +
                  " of the list (page one plus the maxPages setting).");
      }
      if (st.pagesRead !== null) {
        half.push("Open page " + (st.pagesRead + 1) + " directly to shelve the rest.");
      }
      flag([first, half.join(" ")], ladder(st));
    }
    if (st.warning) flag(st.warning);
    if (st.health) flag(st.health);
    if (st.provisional) {
      flag("These numbers are from the first pass only — the page had not finished resolving.");
    }
  }

  function yoursLine(owner, notes, overrides, pins) {
    const mine = (obj) =>
      Object.keys(obj || {}).filter((k) => k.indexOf(owner + "/") === 0).length;
    const parts = [];
    const n = mine(notes), m = mine(overrides), p = mine(pins);
    if (n) parts.push(plural(n, "note", "notes"));
    if (m) parts.push(m + " moved");
    if (p) parts.push(p + " pinned");
    return parts.length ? parts.join(" · ") : null;   // nothing to say, no row
  }

  /* ---- the seven states ------------------------------------------------- */

  async function run() {
    /* 7. No Shelves global — store.js did not load. Said in one sentence, with
     *    a working Settings link, because a popup that throws renders blank and
     *    blank is the worst possible answer from a surface whose job is to say
     *    whether things are working. */
    if (!S || !S.shelfmap || !S.load) {
      chip("cannot read storage", "warn");
      lede("Shelves cannot reach its own storage, so it has nothing to report. " +
           "Reloading the extension usually fixes it.");
      footer("");
      return;
    }

    let url = "";
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      url = (tabs && tabs[0] && tabs[0].url) || "";
    } catch (e) {
      url = "";                 // treated exactly like a redacted url: not on GitHub
    }
    const here = readUrl(url);

    let settings = null, maps = null, notes = {}, overrides = {}, pins = {};
    try {
      settings = await S.load();
    } catch (e) { settings = null; }
    try {
      maps = await allMaps();
    } catch (e) { maps = null; }
    try {
      notes = await S.notes.read();
      overrides = await S.overrides.read();
      pins = await S.pins.read();
    } catch (e) { notes = notes || {}; overrides = overrides || {}; pins = pins || {}; }

    if (maps === null) {
      chip("cannot read storage", "warn");
      lede("Shelves could not read this browser's extension storage, so it has " +
           "nothing to report.");
      footer("");
      return;
    }

    const otherLabel = str(settings && settings.otherLabel) || "Ungrouped";
    const maxPages = num(settings && settings.maxPages);
    const own = (owner) => (maps[owner] && typeof maps[owner] === "object") ? maps[owner] : null;

    /* On the Repositories tab, the record for THIS owner is the whole answer.
     * `shelfmap.read` is the canonical reader, so it is the one used. */
    if (here.repoTab) {
      let rec = null;
      try {
        rec = await S.shelfmap.read(here.owner);
      } catch (e) {
        rec = own(here.owner);
      }
      const st = readStatus(rec, otherLabel);

      /* 3. SOMEONE ELSE'S PROFILE — REPORTED, NOT REFUSED.
       *
       * The earlier version said "Shelves left it alone" and drew two rows.
       * That was wrong about the page: a stranger's tab IS shelved. P.XIV
       * narrows which RUNGS may run there — no token, no session scraping, no
       * cache write, "a narrowing rather than a refusal" in topics.js's own
       * words — and the free ones still group the list in front of the reader.
       * A panel that reports nothing about a page visibly covered in shelves is
       * the instrument disagreeing with its own subject.
       *
       * So it gets the same rows, with two differences that are the whole
       * point: the heading says whose profile it is, and the `warning` the
       * ladder itself wrote (`free rungs only, N unread`) is carried through —
       * because the figures ARE thinner here, and the number without the
       * sentence explaining why is the half that misleads. */
      if (rec && st.standDown) {
        chip("not your profile", null);
        lede("Grouped from what this page gives away for free — the topic chips "
             + "GitHub renders and the public API. Shelves spends no token and "
             + "no session on someone else's repositories, so anything needing "
             + "those is unread here.", true);
        paintRows(here.owner, st, {
          otherLabel,
          yours: yoursLine(here.owner, notes, overrides, pins),
          lastRun: null,                // it is now; a timestamp would say less
        });
        strip(st, otherLabel, 7);
        paintFlags(st, maxPages);
        footer(here.owner);
        return;
      }

      /* 1. The full panel. */
      if (rec) {
        chip("active on this tab", "ok");
        paintRows(here.owner, st, {
          otherLabel,
          yours: yoursLine(here.owner, notes, overrides, pins),
          lastRun: null,                // it is now; a timestamp would say less
        });
        strip(st, otherLabel, 7);
        paintFlags(st, maxPages);
        footer(here.owner);
        return;
      }

      /* 2. The right tab, nothing shelved. No zeros — it has no measurement to
       *    report, only the likely reason. */
      chip("not shelved yet", "warn");
      lede("Shelves has not grouped " + here.owner + " yet. It shelves a profile " +
           "when the page loads, so reloading this tab is usually all it needs.");
      if (Object.keys(maps).length) {
        lede("If this profile is not yours, that is deliberate: Shelves stands " +
             "down on other people's repositories.");
      }
      footer(here.owner);
      return;
    }

    /* 4, 5 and 6 are all "not on a Repositories tab", and the honest thing to
     * show is the last run — clearly marked as the last run. */
    const last = latestOf(maps);
    const st = last ? readStatus(last.rec, otherLabel) : null;

    /* ── ON A REPOSITORY PAGE, ANSWER ABOUT THAT REPOSITORY ────────────────
     * This surface used to draw the last run here at full confidence under one
     * muted line of caveat, and it was read exactly as the caveat said not to:
     * on a stranger's repository the reader saw their OWN counts and took them
     * for this page. The caveat was not too quiet to fix with a louder caveat —
     * it was answering a question nobody had asked. The question a reader has
     * on `github.com/torvalds/linux` is about linux, and `shelfmap` already
     * holds that answer, keyed `owner/repo`, because `mark.js` draws its chip
     * from it. So it is answered here first, and the last run is demoted to
     * what it actually is: a readout about somewhere else. */
    if (here.repo) {
      const rec = own(here.owner);
      const mineHere = !(rec && rec.status && rec.status.mine === false);
      const label = rec && rec.on && typeof rec.on === "object"
        ? str(rec.on[here.repo]) : "";
      /* WHOSE LIST IT IS CHANGES THE SENTENCE, NOT WHETHER THERE IS ONE. A
       * stranger's profile is shelved too, so `on` answers for their
       * repositories exactly as it does for the reader's — it is just not
       * "your" shelf, and saying so is one possessive, not a refusal. */
      if (!rec) {
        chip("not grouped yet", null);
        lede("Shelves has not grouped " + here.owner + "'s repositories, so it " +
             "cannot say where " + here.name + " sits. Open their Repositories " +
             "tab once and it will.", true);
      } else if (label) {
        /* THE SHELF, DRAWN AS THE SHELF. A sentence naming a label asks the
         * reader to match a word against a page they are not looking at; the
         * chip is the same glyph in the same hue that `mark.js` has already
         * put in this repository's About sidebar and that the shelf header
         * wears on the list — one recognition instead of three readings. */
        const recSt = readStatus(rec, otherLabel);
        const mk = marksFor(recSt, otherLabel);
        mark(label, num((recSt.counts || {})[label]), mk ? mk.get(label) : null);
        chip("on a shelf", "ok");
        lede(mineHere
          ? here.name + " is on your " + label + " shelf."
          : here.name + " is on the " + label + " shelf of " + here.owner +
            "'s list.", true);
      } else {
        chip("not on a shelf", null);
        lede(mineHere
          ? here.name + " is not on any of your shelves — it may carry no topic, " +
            "or sit past the last page Shelves read."
          : here.name + " is not on a shelf in " + here.owner + "'s list.", true);
      }
      /* THE ANSWER ABOVE STANDS ALONE WHEN THERE IS NO RUN OF YOUR OWN. A
       * reader who has only ever passed through other people's profiles still
       * gets told where this repository sits; appending "nothing shelved yet"
       * to a sentence that just answered the question would read as a failure
       * where there was none. */
      if (last) {
        sep(st.standDown ? "last run · " + last.owner + "'s list" : "last run · elsewhere");
        paintRows(last.owner, st, {
          otherLabel,
          yours: yoursLine(last.owner, notes, overrides, pins),
          lastRun: ago(st.at),
        });
        strip(st, otherLabel, 5);
        /* NO FLAGS HERE. A truncation or a rejected token is a fact about the
         * profile tab, and raising it in amber beside a page it is not about is
         * the same mistake in a louder colour. The reader meets it where it
         * applies: on that tab, and in the toolbar line. */
      }
      footer(last ? last.owner : "");
      return;
    }

    /* 6. Nothing has ever been shelved, by anyone. */
    if (!last) {
      chip("nothing shelved yet", null);
      lede("Shelves has not grouped anything yet. Open your own Repositories tab " +
           "on github.com and it groups the list as the page loads.");
      footer("");
      return;
    }

    /* 5. Not on GitHub at all vs 4. somewhere else on GitHub entirely.
     *
     * WHOSE LIST IT WAS IS PART OF THE SENTENCE, not left to the rows. "The
     * last profile Shelves grouped" is read as "mine" by anyone who has only
     * ever had one — so when it was someone else's, the owner goes in the line
     * itself, where it is read before the numbers rather than after them. */
    chip(here.github ? "last run · not this tab" : "not on GitHub", null);
    lede(st.standDown
      ? "Not a Repositories tab. The last list Shelves grouped was " + last.owner +
        "'s — not yours, and not what is on screen now."
      : "Not a Repositories tab, so this is the last profile Shelves grouped — " +
        "not what is on screen now.", true);
    paintRows(last.owner, st, {
      otherLabel,
      yours: yoursLine(last.owner, notes, overrides, pins),
      lastRun: ago(st.at),
    });
    strip(st, otherLabel, 7);
    paintFlags(st, maxPages);
    footer(last.owner);
  }

  /* Settings is a link to the options page and nothing more — it is no longer
   * the point of this surface. `openOptionsPage` is the only way to reach it
   * without a hard-coded URL. */
  const set = byId("settings");
  if (set) {
    set.addEventListener("click", () => {
      try {
        chrome.runtime.openOptionsPage();
      } catch (e) {
        /* nothing to do and nothing to say: the panel above is still correct */
      }
    });
  }

  /* NOTHING FROM run() MAY REACH THE TOP LEVEL. A rejection here would leave
   * the popup showing `checking…` forever, which is a surface about whether
   * things work claiming it does not know. */
  Promise.resolve()
    .then(run)
    .catch(() => {
      chip("cannot read storage", "warn");
      lede("Shelves could not read its own records, so it has nothing to report.");
      footer("");
    });
})();
