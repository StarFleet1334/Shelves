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

      const { topics, source, warning } = await S.resolve(
        rows,
        names,
        settings,
        (done, total) => {
          if (total) {
            status.textContent =
              "reading topics from repo pages " + done + "/" + total +
              " — cached after this";
          }
        }
      );

      const host = S.render({
        rows, topics, settings, sourceUl, source, warning, owner,
        handlers: {
          reload: () => location.reload(),
          rescan: async () => {
            await S.cache.clear();
            location.reload();
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
   * user pressing Save fires this, so a reload is proportionate. */
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (!S.isRepoTab()) return;
      if (Object.keys(changes).some((k) => k !== "topicCache")) location.reload();
    });
  } catch (e) {
    /* no chrome.storage in a harness — the page simply will not auto-reload */
  }
})(globalThis.Shelves);
