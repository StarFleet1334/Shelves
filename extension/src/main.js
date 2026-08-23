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

      const notes = await S.notes.read();

      const host = S.render({
        rows, topics, facts, names, notes, settings, sourceUl, source, warning,
        health, owner, deferred,
        handlers: {
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
          note: async (name, text) => {
            const { notes: after } = await S.notes.set(name, text);
            const i = names.indexOf(name);
            const li = i >= 0 ? rows[i] : null;
            if (!li) return;
            const wrap = li.querySelector(".sh-margin");
            if (wrap) S.paintNote(wrap, after[name] || "");
            li.dataset.shHay = S.haystack(
              li.dataset.shText || "", facts[i], after[name] || ""
            );
          },
        },
      });

      sourceUl.replaceWith(host);
      swapped = true;
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
  const QUIET = ["topicCache", "repoFacts", "notes", "shelfMap"];
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
