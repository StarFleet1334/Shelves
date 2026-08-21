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

      const { topics, facts, source, warning } = await S.resolve(
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
        rows, topics, facts, names, notes, settings, sourceUl, source, warning, owner,
        handlers: {
          reload: () => location.reload(),
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

  const kick = () => setTimeout(run, 120);

  kick();
  document.addEventListener("turbo:render", kick);
  document.addEventListener("turbo:load", kick);
  document.addEventListener("pjax:end", kick);

  /* MEASURED (charter §6): GitHub's own Type/Language filters replace the
   * list wholesale. The observer notices the new list; run() being idempotent
   * is what makes reacting to every mutation safe. */
  const observer = new MutationObserver(() => {
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
   * the reward for writing one line about a repo. */
  const QUIET = ["topicCache", "repoFacts", "notes"];
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
