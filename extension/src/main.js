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
    if (document.getElementById(S.HOST_ID)) return;     // already shelved
    const sourceUl = S.findList();
    if (!sourceUl) return;                              // nothing to shelve

    busy = true;
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
      if (settings.fetchAllPages) {
        const more = await S.fetchRestOfPages(settings.maxPages);
        if (more.length) {
          rows = rows.concat(more);
          S.hidePager();
        }
      }

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
      const mine = S.isMine();

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
            rows, names, settings, sourceUl, owner, notes, overrides, mine,
            topics: curTopics,
            facts: curFacts,
            /* P.IV, and it is not a formality: this line must never name a
             * rung that has not run. `cache` and `page` are both true here,
             * and the moment the ladder answers it says so instead. */
            source: "page + cache",
            warning: "", health: "", deferred: 0,
            provisional: true,
            handlers: shelfHandlers(),
          });
          host.dataset.provisional = "1";
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
              " — cached after this";
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
        host.rebucket({ topics, facts, notes, overrides, source, warning,
                        health, deferred });
      } else {
        host = S.render({
          rows, topics, facts, names, notes, settings, sourceUl, source, warning,
          health, owner, deferred, overrides, mine,
          handlers: shelfHandlers(),
        });
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
            const natural = S.bucketFor(i >= 0 ? curTopics[i] || [] : [], settings);
            const { ok } = await S.overrides.set(name, natural === label ? "" : label);
            if (!ok) return;
            /* The write is the truth; this is the page catching up. If the
             * shelf has gone (a filter, a re-render) the next load still puts
             * the row in the right place. */
            if (li) S.moveRow(host, li, label);
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
    if (document.getElementById(S.HOST_ID)) return;
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
  const QUIET = ["topicCache", "repoFacts", "notes", "shelfMap", "overrides"];
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
