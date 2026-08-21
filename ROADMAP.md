# SHELVES — roadmap

`smoke: node tests/harness.js`

Ordered by how much each would change the daily experience, not by effort.
Every milestone carries a **proof** — the command that settles whether its tick
was honest. A proof naming a scenario the harness does not have yet *fails*,
deliberately: the test gets written before the box gets ticked.

Two facts frame the whole list, and both were measured against the real code
rather than guessed:

1. **The ladder short-circuits on the first repo it can answer.** One repo with
   topic chips on the page returns `via page` for all of them, and the other
   seventy-five land in Ungrouped having cost zero requests. Rung 1 renders
   nothing today, so this is latent — and the day GitHub restores chips is the
   day SHELVES gets *worse*, because a partial rollout is the likely shape.
2. **A first run for someone who has never tagged a repo produces the page they
   already had.** Fifteen seconds of fetching, then one shelf called Ungrouped
   holding all 76. Everything under *the first day* exists to close that,
   without ever writing to GitHub.

---

## The ladder must be honest

- [ ] the ladder answers PER REPO, not per page — chips found on some rows are a floor, and the repos they did not answer still climb to the API and the repo pages `proof: node tests/harness.js 8`
- [ ] a repo page that could not be read is SAID, not silently Ungrouped — the toolbar counts them (`3 unread`) and names rescan as the cure `proof: node tests/harness.js 9`
- [ ] a rejected token falls back to the UNAUTHENTICATED api before scraping 76 pages, and the source line says which of the two answered `proof: node tests/harness.js 10`
- [ ] the scrape path has a ceiling and a *continue* — above `scrapeMax` repos it reads that many, says how many are left and offers to read the rest, so 400 untagged repos is a choice rather than 400 requests `proof: node tests/harness.js 11`

## The first day — value before the user has tagged anything

- [ ] LOCAL SHELF OVERRIDES: drag a row onto a shelf and it stays there, stored locally, outranking topics — shelving with no topics at all, and still not one write to GitHub `proof: node tests/harness.js 12`
- [ ] Ungrouped becomes a WORKBENCH, not a dump: `31 untagged · tag them` walks the untagged repos one at a time, opening each at its About panel, so the two-click path becomes the extension's own funnel `proof: node tests/harness.js 13`
- [ ] SUGGESTED SHELVES on a cold start — topics that match no shelf, shared name prefixes, dominant languages — each offered as `add "rag" as a shelf (7 repos)` and accepted in one click into a normal, editable shelf `proof: node tests/harness.js 14`

## Shelves worth the name

- [ ] a shelf may be a RULE, not only a topic: `topic:ai lang:python fork:false archived:false pushed:<90d`, parsed once and applied to the rows already on the page `proof: node tests/harness.js 15`
- [ ] the shelf header carries WEIGHT, not just a count — total stars, how many are stale, and `3 updated since you were last here`, which GitHub itself cannot tell you `proof: node tests/harness.js 16`
- [ ] a row wears CHIPS for the other shelves it matched — first match still wins the row, but the information that rule throws away is given back `proof: node tests/harness.js 17`
- [ ] pin a repo to the top of its shelf `proof: node tests/harness.js 18`

## The page as an instrument

- [ ] PROGRESSIVE RENDER: shelve from the warm cache in the first frame and re-bucket as topics arrive, so a cold run is usable in 200 ms instead of fifteen seconds `proof: node tests/harness.js 19`
- [ ] COMPACT density — one line per repo, so 76 fit on a screen instead of a scroll — remembered per profile `proof: node tests/harness.js 20`
- [ ] KEYBOARD: `/` filters in place, `j`/`k` move between shelves, `1`–`9` jump, `e`/`c` expand and collapse. GitHub's users are keyboard users `proof: node tests/harness.js 21`
- [ ] the built-in filter box and the Type/Language filters compose with the shelves instead of tearing them down and rebuilding them `proof: node tests/harness.js 22`

## Reach

- [ ] the same lens on `?tab=stars` — starred repos are the list that most needs shelving and the one nobody can tag `proof: node tests/harness.js 23`
- [ ] org repositories, driven against a real org page rather than claimed `proof: node tests/harness.js 24`
- [ ] EXPORT and IMPORT the shelf layout as JSON, so a team can share one set of shelves `proof: node tests/harness.js 25`
- [ ] the options page exposes what the store already carries — concurrency, page depth, the scrape ceiling — instead of defaults nobody can reach `proof: node tests/harness.js 26`
- [ ] drag to reorder shelves in the options page; the ↑/↓ buttons stay, because dragging is not keyboard-reachable `proof: node tests/harness.js 27`
- [ ] FIREFOX: one port of the content-script/worker split (principle VII) `proof: node tests/harness.js 28`

---

## Deliberately not doing

- Editing topics from the extension. That is a write; principle I says no. The
  overrides above are the answer that stays read-only: they live in the
  browser, and uninstalling still undoes everything.
- Grouping by language or stars **as a permanent axis**. Those are filters
  GitHub already ships, and a second axis makes the mental model two things
  instead of one. As a one-time *suggestion* that becomes an ordinary shelf, it
  is configuration rather than a second axis.
- Syncing shelves to a server. Everything stays in the browser.

## Open questions

- Is a week the right cache TTL? It is configurable, but the default was picked
  by feel and has not been measured against how often anyone re-tags.
- Should an override survive a repo being renamed? Everything is keyed by
  `owner/name`, which a rename breaks silently — the repo reappears in
  Ungrouped, which is the safe failure but not an obvious one.
- A count badge on the toolbar icon (how many repos are still untagged) would
  need `action.setBadgeText` from the worker, which knows nothing about the
  page. Worth a permission? Probably not; the toolbar line already says it.
