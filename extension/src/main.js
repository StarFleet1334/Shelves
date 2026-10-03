/* SHELVES — main.js
 *
 * Orchestration and lifecycle. Every entry point funnels into run(), which is
 * idempotent by construction (P.VI): call it at any moment, any number of
 * times, concurrently, and the page ends up as if it had been called once.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  let busy = false;
  /* Bumped by every `turbo:before-cache` that took a host apart. A run that
   * was still in flight when it happened was building for a page that is no
   * longer there; see the `finally` in run(). */
  let unshelved = 0;

  /* READ THE REST — the scrape ceiling lifted for exactly one pass.
   *
   * It rides sessionStorage and not settings because it is NOT a setting: it
   * is a decision about this page, taken once, and it must not outlive the
   * tab or follow the reader to another machine over sync. It is cleared as
   * it is read, so a reload cannot silently repeat a 400-request pass the
   * reader authorised once. */
  const READ_ALL = "shelves:read-all";

  async function run() {
    if (busy) return;                                   // re-entrancy
    if (!S.isRepoTab()) return;                         // wrong route
    /* ALREADY SHELVED — but only if WE shelved it. A host this script did
     * not build is a Turbo snapshot restored by Back: a clone, every listener
     * gone. Returning on its id is what left the page inert, so it is taken
     * apart and the pass runs as if GitHub had just drawn the list. */
    const had = document.getElementById(S.HOST_ID);
    if (had) {
      if (S.isLiveHost(had)) return;
      S.unshelve(had);
    }
    const sourceUl = S.findList();
    if (!sourceUl) return;                              // nothing to shelve

    busy = true;
    const epoch = unshelved;
    const status = S.status("shelving…");
    let swapped = false;

    try {
      sourceUl.dataset[S.DONE] = "1";
      sourceUl.parentNode.insertBefore(status, sourceUl);

      const settings = await S.load();
      try {
        if (sessionStorage.getItem(READ_ALL) === "1") {
          sessionStorage.removeItem(READ_ALL);
          settings.readAll = true;
        }
      } catch (e) {
        /* storage denied — the ceiling simply stays on, which is the safe way
         * for this particular failure to land (P.III). */
      }
      const owner = S.owner();

      let rows = S.rowsOf(sourceUl);
      /* GITHUB'S ORDER, WRITTEN ON THE ROW. Shelving and pinning reorder the
       * rows and nothing else remembers where they stood; `unshelve` needs it
       * from a clone, where no closure survives. Page one only — merged rows
       * are copies and do not go back. */
      rows.forEach((li, i) => { li.dataset.shI = String(i); });
      /* WHAT THE MERGE COULD NOT REACH, carried as far as the toolbar.
       * `stopped` starts at "off" because that is the honest answer when
       * `fetchAllPages` is false: page one is not all there is, it is all we
       * were asked to read, and GitHub's pager below is untouched and says so. */
      let truncated = false;
      let pagesRead = 0;
      let stopped = "off";
      if (settings.fetchAllPages) {
        const more = await S.fetchRestOfPages(settings.maxPages);
        truncated = more.truncated;
        pagesRead = more.pagesRead;
        stopped = more.stopped;
        if (more.rows.length) {
          rows = rows.concat(more.rows);
          /* THE PAGER STAYS WHEN THERE IS SOMETHING BEHIND IT. Hiding it was
           * unconditional, and on a collection past the ceiling that removed
           * the reader's only route to the repositories we had just decided
           * not to fetch — those rows were not merely missing from the
           * shelves, they were unreachable from the page. GitHub's navigation
           * is hidden only where we have genuinely replaced what it navigates
           * to.
           *
           * `more.rows.length` is kept as the other half of the condition for
           * a case `truncated` cannot see: standing on the LAST page of a
           * multi-page tab there is no next link, nothing merges, and the
           * container holds the Previous link. Hiding it there strands the
           * reader the same way, one direction over. */
          if (!truncated) S.hidePager();
        }
      }

      /* READ FROM THE NAV, AND NULL RATHER THAN WRONG — see `repoTotal`. Read
       * once, here, for the same reason `lastSeen` is read once: GitHub's own
       * filters re-enter this function, and a figure re-read per render is a
       * number that moves under a line that is meant to be a fact. */
      const total = S.repoTotal();
      /* THREE STATES, AND THE THIRD IS THE ONE TO BE CAREFUL ABOUT. A known
       * total gives a count. No total and nothing missing gives zero. No total
       * and a horizon gives null — "there are more and I cannot say how many"
       * — and never 0, because 0 is the claim that the page is complete and
       * that is exactly what we have just found out it is not. The two are
       * different sentences in the toolbar and a different fact in the map. */
      const unread = (total !== null && total > rows.length)
        ? total - rows.length
        : (truncated ? null : 0);

      const names = rows.map(S.fullNameOf);

      /* ══ PHASE ONE — the page, from what is already free ══════════════════
       * A cold run is one authenticated fetch per repo at concurrency six, and
       * until it finishes the reader is looking at the flat list they came to
       * get away from. Two sources cost nothing and are sitting right here:
       * the topic chips GitHub renders on the rows, and every record rung 4
       * has already paid for on a previous visit.
       *
       * IT HELPS EXACTLY WHERE THE PAIN IS. The fact cache only ever holds
       * rung-4 records — `factsFromApi` results are never written to it — so
       * it is populated precisely for the private, API-invisible tail that
       * makes a run slow. An account the API can see is already fast and has
       * nothing cached; it simply skips this and loses nothing.
       *
       * NO FRESHNESS GATE. `scrape()` checks `cacheDays` because it is
       * deciding whether to spend a request; this spends nothing and is
       * provisional by construction. A nine-day-old topic list is a better
       * first frame than `Ungrouped`, and phase two overwrites it either way.
       * `Array.isArray` stays — it defends against a half-migrated store. */
      /* ══ WHAT THE HANDLERS READ ═══════════════════════════════════════════
       * The row-level listeners are attached ONCE, on the first pass, and they
       * outlive it — so anything they close over has to be a binding that
       * phase two updates, never a value phase one captured.
       *
       * It is not only staleness. `const { topics, facts } = await resolve(…)`
       * leaves both names in their dead zone for the whole of rung 4, which is
       * exactly the window in which the reader has a usable page to click on:
       * a drag or a note saved during it would have thrown a ReferenceError
       * rather than being merely wrong. */
      let curTopics = [];
      let curFacts = [];
      let host = null;
      let notes = await S.notes.read();
      let overrides = await S.overrides.read();
      let pins = await S.pins.read();
      const mine = S.isMine();

      /* WHEN THE READER WAS LAST HERE, read before anything is drawn and
       * stamped exactly once for the visit. Reading it per render would make
       * "since you were here" mean "since the last time this function ran" —
       * which, with a progressive render and GitHub's own filters, is a few
       * hundred milliseconds ago and therefore always zero. */
      const now = Date.now();
      /* Read before the stamp, and the stamp is a no-op after the first time
       * — a re-entry from GitHub's own filters must not become "last time". */
      const lastSeen = S.seen.read(owner);
      S.seen.stamp(owner, now);

      try {
        const warm = await S.cache.read();
        const chips = rows.map((li) => S.topicsIn(li));
        const early = names.map((n, i) => {
          const hit = warm[n];
          return hit && Array.isArray(hit.topics)
            ? hit
            : { name: n, topics: chips[i] || [], via: "page-chips" };
        });
        curTopics = early.map((f) => f.topics);
        curFacts = early;
        if (early.some((f) => f.topics.length)) {
          host = S.render({
            rows, names, settings, sourceUl, owner, notes, overrides, pins,
            mine, now, lastSeen,
            topics: curTopics,
            facts: curFacts,
            /* P.IV, and it is not a formality: this line must never name a
             * rung that has not run. `cache` and `page` are both true here,
             * and the moment the ladder answers it says so instead. */
            source: "page + cache",
            warning: "", health: "", deferred: 0,
            /* THESE FOUR ARE NOT PROVISIONAL, and that is why they are passed
             * in full here rather than stubbed like the three above. The merge
             * and the nav read both happened before this frame is built, so
             * the horizon is as true now as it will be after the ladder — it
             * is the only thing on this line that rung 4 cannot change its
             * mind about. Stubbing them would have made the first frame say
             * `330 repos` and the second `330 of 400`, which is the drift the
             * one-function-called-twice shape in view.js exists to prevent. */
            total, unread, truncated, pagesRead, stopped,
            provisional: true,
            handlers: shelfHandlers(),
          });
          host.dataset.provisional = "1";
          S.keepSource(host, sourceUl);
          sourceUl.replaceWith(host);
          swapped = true;
        }
      } catch (e) {
        /* The first frame is an optimisation. If anything about it is wrong
         * the reader must still get the page the slow way (P.III). */
        console.warn("[shelves] no early frame", e);
      }

      status.textContent = settings.token
        ? "reading topics from the API…"
        : "reading topics…";

      const { topics, facts, source, warning, health, deferred } = await S.resolve(
        rows,
        names,
        settings,
        (done, total) => {
          if (total) {
            status.textContent =
              "reading repo pages " + done + "/" + total +
              " — cached as it goes";
          }
        }
      );

      /* RE-READ, NOT REUSED. The reader has had the page for the whole of
       * rung 4 and may well have written a note or pinned a repo in it —
       * `margin()`'s repaint would otherwise wipe the note back to the empty
       * string it had when the first frame was drawn. */
      notes = await S.notes.read();
      overrides = await S.overrides.read();

      /* ── THE FIRST-DAY VERBS ARE FOR YOUR OWN PROFILE ────────────────────
       * P.XIV narrowed the expensive RUNGS to the reader's own repositories;
       * these three narrow the WRITES, which is the same argument one step
       * further. Suggestions and the walk are about a collection the reader
       * curates, and on a stranger's page they are worse than useless:
       *
       *   accepting one writes `settings.groups` — the reader's own
       *     configuration, over SYNC, on every machine — naming somebody
       *     else's topics, and pins overrides keyed to somebody else's repos;
       *   and because the first write flips the page out of auto-group mode,
       *     the next visit to their OWN profile drew ONE shelf with everything
       *     in it. Measured on torvalds' page: one press offered
       *     `add subsurface (3)`, and the reader's own three shelves collapsed
       *     to `Ungrouped: 3`.
       *
       * The read-only half of the page is untouched — a stranger's profile is
       * still shelved, still searchable, still audited. Only the verbs that
       * write the reader's own setup stand down, and they stand down by not
       * being handed to render() at all, so there is no affordance to press. */
      curTopics = topics;
      curFacts = facts;

      if (host) {
        /* ══ PHASE TWO — re-bucket, never re-render ═════════════════════════
         * The host is not replaced. See `host.rebucket` in view.js for what
         * that buys and what swapping would have cost. */
        host.rebucket({ topics, facts, notes, overrides, pins, source, warning,
                        health, deferred });
      } else {
        host = S.render({
          rows, topics, facts, names, notes, settings, sourceUl, source, warning,
          health, owner, deferred, overrides, pins, mine, now, lastSeen,
          total, unread, truncated, pagesRead, stopped,
          handlers: shelfHandlers(),
        });
        S.keepSource(host, sourceUl);
        sourceUl.replaceWith(host);
        swapped = true;
      }

      function shelfHandlers() {
        return {
          reload: () => location.reload(),
          /* THE ONLY VERB HERE THAT DELIBERATELY SPENDS REQUESTS. It reloads
           * rather than re-entering run(), for the same reason rescan does:
           * the pass is the product of the page, and the cache means the
           * second one re-reads none of what the first already got. */
          more: () => {
            try {
              sessionStorage.setItem(READ_ALL, "1");
            } catch (e) {
              /* Without the flag the reload would repeat the same bounded
               * pass and look like the button does nothing. Better to not
               * move at all than to spend a page load saying nothing. */
              console.warn("[shelves] cannot ask for the rest — storage denied", e);
              return;
            }
            location.reload();
          },
          rescan: async () => {
            await S.cache.clear();
            location.reload();
          },
          /* A NOTE MUST NOT RELOAD THE PAGE. It writes, it repaints the one
           * row it belongs to, and it refreshes that row's haystack so the
           * filter can find it on the very next keystroke — all without
           * costing the reader their scroll position or the shelves' state. */
          /* ---- the reader's own answer -------------------------------
           * ONE WRITE AND NO RELOAD. A move is not a re-derivation: the row is
           * already on the page, the shelves are already drawn, and the only
           * thing that changed is which of them holds it. Reloading would cost
           * the reader their scroll, their open shelves and the search they
           * were in the middle of — as the reward for tidying one repo.
           *
           * `overrides` is in the QUIET list below for the same reason: the
           * storage listener reloads on any setting it did not expect, and
           * without the exemption every move would reload the page it just
           * updated. */
          override: async (name, label, li) => {
            /* "PUT THIS ON THE LEFTOVERS SHELF" AND "FORGET MY OPINION" ARE
             * TWO VERBS SHARING ONE GESTURE, and they only agree for a repo
             * with no topics. Deleting the key on any move to the leftovers
             * shelf was silently a no-op for a TAGGED repo: the row slid over,
             * the counts changed, storage kept nothing, and the next load put
             * it straight back on its topic's shelf. The page and the store
             * disagreed for the rest of the session.
             *
             * So the question is what the repo would do with no opinion at
             * all. If it would land here anyway, an override is noise and the
             * key goes; if it would land somewhere else, the reader has said
             * something and it is stored — including the leftovers label. */
            const i = names.indexOf(name);
            /* THE FACTS GO WITH THE TOPICS. A rule shelf is judged against
             * thirteen fields, so asking `bucketFor` with topics alone gives
             * the natural shelf of a repo the desk knows nothing about — and
             * this answer decides whether the reader's opinion is STORED or
             * DELETED. Wrong here means a move that silently keeps no key. */
            const natural = S.bucketFor(i >= 0 ? curTopics[i] || [] : [], settings,
                                        "", i >= 0 ? curFacts[i] : null);
            const { ok } = await S.overrides.set(name, natural === label ? "" : label);
            if (!ok) return;
            if (!li) return;
            /* The write is the truth; this is the page catching up. Two cases,
             * and only one of them can: a shelf that is DRAWN takes the row
             * with no reload, and a shelf that is not — which is what
             * releasing a repo back onto a shelf only IT would create looks
             * like — has nowhere to catch up TO, so the pass is re-run
             * instead of leaving the page disagreeing with the store for the
             * rest of the session. The cache makes that free; nothing is
             * fetched twice. `flat list` draws no shelves at all and must
             * never reload: there the row is already where it belongs. */
            if (S.hasShelf(host, label)) S.moveRow(host, li, label);
            else if (host.querySelector("details.sh-shelf")) location.reload();
          },

          /* ---- the top of the shelf ------------------------------------
           * One key, one row re-homed, no reload — the same unit as a move,
           * because it is the same kind of decision. */
          pin: async (name, li) => {
            const { ok, pins: after } = await S.pins.toggle(name);
            if (!ok) return;
            pins = after;
            if (li) S.repin(host, li, !!after[String(name).toLowerCase()]);
          },

          /* ---- a suggestion becomes an ordinary shelf ------------------
           * A TOPIC SUGGESTION IS PURE CONFIGURATION — the shelving engine
           * already matches topics, so `groups` alone does the work. A prefix
           * or a language matches no topic and never will, so the repos it
           * named are pinned with overrides in the same press. Without that,
           * accepting `wiremock` would build an empty shelf and look broken.
           *
           * The reload is the storage listener's, not ours: `groups` is not
           * QUIET, so writing it re-runs the whole pass and the new shelf
           * arrives drawn, coloured and editable in the options page like any
           * other. That is the point — there is no "suggested" state to
           * migrate later. */
          addShelf: async (sug, onScreen) => {
            /* TRUNCATED ONCE, HERE, so both stores agree. `groups.add` and
             * `overrides.set` each cap a label at 60 characters; this path
             * wrote the override object directly and skipped it, so a longer
             * label produced a 60-char shelf and 70-char pins — two shelves,
             * one of them empty. */
            const label = String(sug.label || "").trim().slice(0, 60);
            if (!label) return;
            if (sug.kind !== "topic" && sug.repos && sug.repos.length) {
              const all = await S.overrides.read();
              sug.repos.forEach((r) => { all[String(r).toLowerCase()] = label; });
              await S.overrides.write(all);
            }
            /* KEEPING WHAT IS ALREADY ON SCREEN. With no groups configured the
             * shelves are auto-derived from topics; the first group written
             * turns that off, and a repo matching no group becomes leftovers.
             * So the first accept carries the visible shelves with it, in the
             * order they are drawn, and the new one goes last. Without this,
             * accepting a suggestion deletes every shelf the reader already
             * had — measured on the live page, `config` vanished. */
            const keep = settings.groups.length ? [] : (onScreen || []);
            const { ok } = await S.groups.add(keep.concat([label]));
            /* THE RELOAD IS THE ONLY FEEDBACK THIS PRESS HAS. It comes from
             * the storage listener noticing `groups`, so a rejected write —
             * quota, MAX_WRITE_OPERATIONS_PER_MINUTE — leaves the button
             * disabled reading "adding …" for good, on a page that never
             * changes. `overrides` is QUIET by design and cannot stand in.
             * Reproduced by stubbing the write to fail. */
            return { ok };
          },

          /* ---- the walk ------------------------------------------------
           * One tab per press. `window.open` is only permitted inside a user
           * gesture, which is exactly the guarantee we want: nothing here can
           * open a tab the reader did not ask for. */
          walk: (untagged, who) => {
            if (!untagged.length) return;
            /* MODULO, NEVER `Math.min`. Clamping to `length` yields the one
             * index that is past the end, and the bookmark is only ever
             * compared against a list that SHRINKS as the reader tags things.
             * Measured: walk to 3 of 5, tag three repos, come back to a list
             * of 2 — the button opened nothing, read "3 of 2", and stayed
             * dead for good, because nothing ever moved the bookmark back.
             * The list getting shorter is the feature working. */
            const at = S.bench.at(who) % untagged.length;
            S.bench.set(who, (at + 1) % untagged.length);
            window.open("https://github.com/" + untagged[at], "_blank", "noopener");
          },

          note: async (name, text) => {
            const { notes: after } = await S.notes.set(name, text);
            const i = names.indexOf(name);
            const li = i >= 0 ? rows[i] : null;
            if (!li) return;
            const wrap = li.querySelector(".sh-margin");
            if (wrap) S.paintNote(wrap, after[name] || "");
            li.dataset.shHay = S.haystack(
              li.dataset.shText || "", curFacts[i], after[name] || ""
            );
          },
        };
      }

    } catch (e) {
      /* P.III — the page must never be left worse than we found it. If we
       * threw before the swap, the original list is still in the document;
       * un-mark it so a later pass may try again. */
      if (!swapped) delete sourceUl.dataset[S.DONE];
      console.warn("[shelves]", e);
    } finally {
      status.remove();
      busy = false;
      /* A pass the cache interrupted held `busy` while Back restored the
       * page, so the kick that page earned was refused. Earn it again. */
      if (epoch !== unshelved) kick();
    }
  }

  /* ---- the other two routes -------------------------------------------- */
  /* THREE SURFACES, ONE LIFECYCLE. Until the mark, this extension ran on
   * exactly one page; the discipline that made that safe — everything funnels
   * into an idempotent entry point, and every trigger calls it — is what makes
   * three safe too. Each route guards itself on its own route test, so the
   * kicks below can fire on any github.com page and at most one of them acts.
   *
   * The top-up is deliberately NOT kicked by turbo: it is bounded per page
   * VISIT, and turbo fires on every in-page navigation, which would turn a
   * budget of six into six per click. */
  let marking = false;
  async function mark() {
    if (marking) return;
    if (!S.isRepoPage()) return;
    if (document.getElementById("shelves-mark")) return;
    marking = true;
    try {
      await S.markRepoPage();
    } catch (e) {
      /* A missing chip must never cost the reader the repo page they actually
       * came for (P.III). */
      console.warn("[shelves]", e);
    } finally {
      marking = false;
    }
  }

  const kick = () => {
    setTimeout(run, 120);
    setTimeout(mark, 160);
  };

  kick();
  document.addEventListener("turbo:render", kick);
  document.addEventListener("turbo:load", kick);
  document.addEventListener("pjax:end", kick);

  /* HAND TURBO THE PAGE GITHUB DREW, NOT OURS. The snapshot taken right after
   * this event is what Back restores, and a snapshot is a clone — listeners
   * do not survive it. So the host is taken apart first, and the restored
   * page is an ordinary unshelved list that run() rebuilds live. `isLiveHost`
   * in run() is the second net, for a snapshot this event did not precede.
   *
   * A pass that has not swapped yet left its list marked consumed and its
   * status line above it; both are undone too, or the finder would skip the
   * restored list for good. */
  document.addEventListener("turbo:before-cache", () => {
    const host = document.getElementById(S.HOST_ID);
    if (host) S.unshelve(host);
    document.querySelectorAll("#sh-status").forEach((s) => s.remove());
    document.querySelectorAll("ul[data-shelves-done]").forEach((ul) => {
      if (!ul.closest("#" + S.HOST_ID)) delete ul.dataset[S.DONE];
    });
    unshelved++;
  });

  /* Once per load of a github.com page, and never on the profile tab — warm.js
   * refuses there anyway, but saying it twice costs nothing and the second
   * reader of this file should not have to open warm.js to learn it. */
  if (!S.isRepoTab()) S.warmLater();

  /* MEASURED (charter §6): GitHub's own Type/Language filters replace the
   * list wholesale. The observer notices the new list; run() being idempotent
   * is what makes reacting to every mutation safe. */
  const observer = new MutationObserver(() => {
    if (S.isRepoPage()) {
      if (!document.getElementById("shelves-mark")) mark();
      return;
    }
    if (!S.isRepoTab()) return;
    const host = document.getElementById(S.HOST_ID);
    if (host) {
      if (!S.isLiveHost(host)) kick();   // a restored snapshot — run() rebuilds
      return;
    }
    if (S.findList()) kick();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  /* Saving in the options page should show its effect immediately. Only the
   * user pressing Save fires this, so a reload is proportionate.
   *
   * THE THREE EXEMPTIONS ARE THE THREE THINGS THIS PAGE WRITES TO ITSELF.
   * A reload is right for a setting the options page changed and wrong for
   * anything the page just did: the fact cache fills during a cold run (a
   * reload there would restart the run it is the product of) and a note is
   * saved by the reader mid-page — reloading would throw away their scroll,
   * their open shelves and the search they were in the middle of typing, as
   * the reward for writing one line about a repo.
   *
   * `shelfMap` joins them for a sharper reason: this page WRITES it on every
   * render, so without the exemption every render would trigger a reload,
   * which would render, which would write it again. */
  const QUIET = ["topicCache", "repoFacts", "notes", "shelfMap", "overrides",
                 "pins"];
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (!S.isRepoTab()) return;
      if (Object.keys(changes).some((k) => QUIET.indexOf(k) === -1)) location.reload();
    });
  } catch (e) {
    /* no chrome.storage in a harness — the page simply will not auto-reload */
  }
})(globalThis.Shelves);
