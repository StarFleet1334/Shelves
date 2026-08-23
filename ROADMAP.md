# SHELVES — roadmap

`smoke: node tests/harness.js`

Ordered by how much each would change the daily experience, not by effort.
Every milestone carries a **proof** — the command that settles whether its tick
was honest. A proof naming a scenario the harness does not have yet *fails*,
deliberately: the test gets written before the box gets ticked.

**A proof names its scenario by KEYWORD, never by number.** Numbers are indices
and they move: three scenarios were appended and `harness.js 8` stopped meaning
the ladder milestone and started meaning the facts one — which passes, so the
milestone would have ticked itself. `harness.js ladder-floor` still means what
it meant, and fails until a scenario answers to that name.

Two facts frame the whole list, and both were measured against the real code
rather than guessed:

1. **The ladder short-circuits on the first repo it can answer.** One repo with
   topic chips on the page returns `via page` for all of them, and the other
   seventy-five land in Ungrouped having cost zero requests. This was written as
   latent, on the measurement that rung 1 rendered nothing — *"the day GitHub
   restores chips is the day SHELVES gets worse"*. **That day was 2026-08-22.**
   It is now the first thing on this list by a distance.
2. **A first run for someone who has never tagged a repo produces the page they
   already had.** Fifteen seconds of fetching, then one shelf called Ungrouped
   holding all 76. Everything under *the first day* exists to close that,
   without ever writing to GitHub.

---

## Landed

- [x] ONE PARSE, TEN FACTS — the repo page we already fetch gives up its description, language, stars, forks, licence, homepage, README opening line and last-touched time, not just its topic chips; the API path harvests the same fields from a body it was already receiving `proof: node tests/harness.js facts`
- [x] FIND — `/` searches descriptions, topics, languages, licences, READMEs and your own notes, which GitHub's own box (names only) cannot; shelves count their hits and dim rather than reshuffle `proof: node tests/harness.js find`
- [x] A PRIVATE MARGIN — one local note per repo, painted on the row, searchable, and never taken by a rescan `proof: node tests/harness.js note`
- [x] THE VOCABULARY PANEL — the tag system read as a system: spellings of one idea merged, one-character neighbours and narrower words offered as suspicions, blanket labels and single-use topics named, every topic listed and pressable. No request, no storage, nothing written `proof: node tests/harness.js vocabulary`
- [x] SHELF IDENTITY — a hue and a glyph per shelf, hashed from the name so nothing is stored and nothing can drift; two channels so either one alone identifies a shelf; measured in a real browser for tofu and for 3:1 contrast against both themes `proof: node tests/harness.js identity`
- [x] THE MARK FOLLOWS THE REPO — a repo's own page wears its shelf's glyph, name and colour, links back to the shelves, and carries the private note, editable in place. Costs no request; reads the shelf map the profile page leaves behind rather than guessing a colour that would disagree `proof: node tests/harness.js mark`
- [x] THE REPO AUDIT — what is missing across the collection (topics, description, README, licence) and what is archived, each denominated ONLY over the repos whose source could have answered, with what could not be asked said out loud `proof: node tests/harness.js audit`
- [x] BACKGROUND TOP-UP — the stalest cache entries refreshed while you are elsewhere on github.com, so a week-old cache is never fifteen seconds of waiting. Opt-in, one at a time, bounded per visit, never on the profile tab, stops on the first refusal `proof: node tests/harness.js warm`
- [x] THE CANARY — a moved selector is SAID rather than silently absorbed: the anchors each parse could find are tallied, and below five pages read there is deliberately no opinion `proof: node tests/harness.js canary`
- [ ] drive `facts.js` against a REAL logged-in repo page and demote anything that does not read — only `topics` and `description` are measured; the other eight prefer <meta> and href shapes over class names, which is a hedge, not a proof `proof: node tests/harness.js real-page`

## Hardened for release

Found by a pre-publication security review of the whole repository, each one
measured before and after rather than reasoned about. These are not features and
they were not on this list; they are here because the proof discipline is the
same and a fix nobody can re-run is a fix nobody can trust.

- [x] THE READER'S CREDENTIALS ARE SPENT ON THE READER'S OWN PAGES ONLY — nothing anywhere asked *whose* profile was open, so a stranger's Repositories tab sent the reader's Bearer token to an endpoint answering with the reader's own repos, then fetched every one of the stranger's repo pages with the reader's cookie and cached them permanently. Measured at 12 repos; a 600-repo profile is 600 authenticated requests for one click on a link. Now: free rungs only off your own profile — 0 token, 0 scrapes, 0 cache writes, still shelved `proof: node tests/harness.js credentials`
- [x] STOP WHEN GITHUB SAYS STOP — `scrape()` is the highest-volume path in the extension and was the only one with no backoff. Measured against a server answering 429 to everything: 40 of 40 requests issued, and a page of Ungrouped repos with no explanation. Now 6 of 40 (one wave of in-flight requests) and a toolbar that names the status, the count and the cure `proof: node tests/harness.js unread`
- [x] A PAGE-SUPPLIED HREF IS NOT A URL TO FETCH — two path segments went from the page straight into `fetch("/" + name)`. No SSRF (the leading slash contained every crafted form to github.com), but `/settings/tokens/x` resolved to an authenticated GET of the reader's own token page, cached and made searchable in their UI. Now validated, with the route deny-list reused `proof: node tests/harness.js untrusted-names`
- [x] THE FACT CACHE IS NOT IMMORTAL — there was no eviction path anywhere, so one visit to a stranger's profile left the top-up refreshing their repositories forever. Now pruned by age (four TTLs, at least 90 days) and capped at 3 000, newest kept `proof: node tests/harness.js forgets`
- [x] THE VOCABULARY SCAN WAS QUADRATIC AND RAN ON EVERY RENDER — 25 s of blocked main thread on a synthetic 600-repo account, opened or not, because the badge needs it. Two indexes replaced the pairwise scan: 45 ms at 9 000 topics, and the reported lists are capped with the truncation stated `proof: node tests/harness.js vocabulary`
- [x] THE CHARTER PROMISED SOMETHING THE CODE CONTRADICTED — *"never stores your repositories anywhere"* stopped being true at `facts.js`, which caches descriptions, READMEs and private repo names. Corrected in the charter and the README, in full, rather than softened `proof: node tests/harness.js packaging`
- [x] a narrower content-script surface (`exclude_matches` off `/settings/*` and the auth routes), `.claude/` and the proofs cache untracked, and an MIT LICENSE — a repo with none is not legally reusable, which the extension's own audit panel had been saying about it `proof: node tests/harness.js packaging`

## The ladder must be honest

- [x] the ladder answers PER REPO, not per page — chips found on some rows are a floor, and the repos they did not answer still climb to the API and the repo pages. Observed 2026-08-22: GitHub now renders chips in the profile list, so a 77-repo account resolved `via page` on 9 rows and left 68 in Ungrouped for zero requests. Landed 2026-08-23: the gate is `fromChips >= asked`, the API result no longer overwrites a chip answer, and the source line became a LIST of the rungs that contributed. Re-measured against the live profile — `via page + api (public)`, one API call, zero page reads, and the audit's caveat fell from "readme, licence and description" to readme alone `proof: node tests/harness.js ladder-floor`
- [x] a repo page that could not be read is SAID, not silently Ungrouped — the toolbar counts them (`3 unread`) and names rescan as the cure. Landed with the rate-limit backoff, because they are the same silence `proof: node tests/harness.js unread`
- [x] a rejected token falls back to the UNAUTHENTICATED api before scraping 76 pages, and the source line says which of the two answered. It used to set the label and skip the request, so the line named a rung that had not run and every repo fell through as missing `proof: node tests/harness.js token-fallback`
- [x] the scrape path has a ceiling and a *continue* — above `scrapeMax` repos it reads that many, says how many are left and offers to read the rest, so 400 untagged repos is a choice rather than 400 requests. The offer is a toolbar button (`read N more`) and not a warning, because nothing went wrong; the cache is what makes the second pass cost only the deferred ones `proof: node tests/harness.js ceiling`

## The first day — value before the user has tagged anything

- [ ] LOCAL SHELF OVERRIDES: drag a row onto a shelf and it stays there, stored locally, outranking topics — shelving with no topics at all, and still not one write to GitHub `proof: node tests/harness.js override`
- [ ] Ungrouped becomes a WORKBENCH, not a dump: `31 untagged · tag them` walks the untagged repos one at a time, opening each at its About panel, so the two-click path becomes the extension's own funnel `proof: node tests/harness.js workbench`
- [ ] SUGGESTED SHELVES on a cold start — topics that match no shelf, shared name prefixes, dominant languages — each offered as `add "rag" as a shelf (7 repos)` and accepted in one click into a normal, editable shelf. `S.vocabulary()` already computes every input this needs and marks which topics are shelves; what is missing is the one write to `settings.groups` `proof: node tests/harness.js suggest`

## Shelves worth the name

- [ ] a shelf may be a RULE, not only a topic: `topic:ai lang:python fork:false archived:false pushed:<90d`, parsed once and applied to the rows already on the page `proof: node tests/harness.js rule-shelf`
- [ ] the shelf header carries WEIGHT, not just a count — total stars, how many are stale, and `3 updated since you were last here`, which GitHub itself cannot tell you `proof: node tests/harness.js weight`
- [ ] a row wears CHIPS for the other shelves it matched — first match still wins the row, but the information that rule throws away is given back `proof: node tests/harness.js sibling-shelves`
- [ ] pin a repo to the top of its shelf `proof: node tests/harness.js pin-top`

## The page as an instrument

- [ ] PROGRESSIVE RENDER: shelve from the warm cache in the first frame and re-bucket as topics arrive, so a cold run is usable in 200 ms instead of fifteen seconds `proof: node tests/harness.js progressive`
- [ ] COMPACT density — one line per repo, so 76 fit on a screen instead of a scroll — remembered per profile `proof: node tests/harness.js density`
- [ ] KEYBOARD: `/` filters in place, `j`/`k` move between shelves, `1`–`9` jump, `e`/`c` expand and collapse. GitHub's users are keyboard users `proof: node tests/harness.js keyboard`
- [ ] the built-in filter box and the Type/Language filters compose with the shelves instead of tearing them down and rebuilding them `proof: node tests/harness.js compose`

## Reach

- [ ] the same lens on `?tab=stars` — starred repos are the list that most needs shelving and the one nobody can tag. Route 2 (`mark.js`) proved the content script can stand somewhere other than the profile tab; this is the same move for a list `proof: node tests/harness.js stars-tab`
- [ ] org repositories, driven against a real org page rather than claimed `proof: node tests/harness.js org-page`
- [ ] EXPORT and IMPORT the shelf layout as JSON, so a team can share one set of shelves `proof: node tests/harness.js export`
- [ ] the options page exposes what the store already carries — concurrency, page depth, the scrape ceiling — instead of defaults nobody can reach `proof: node tests/harness.js options-reach`
- [ ] drag to reorder shelves in the options page; the ↑/↓ buttons stay, because dragging is not keyboard-reachable `proof: node tests/harness.js reorder`
- [ ] FIREFOX: one port of the content-script/worker split (principle VII) `proof: node tests/harness.js firefox`

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

- The top-up refreshes what it has already seen and never discovers, so a repo
  created since your last visit to the Repositories tab is still a cold read.
  Warming from `shelfMap.names` instead of the cache's own keys would close
  that, at the cost of fetching pages nobody has asked for yet.
- Is a week the right cache TTL? It is configurable, but the default was picked
  by feel and has not been measured against how often anyone re-tags.
- Should an override survive a repo being renamed? Everything is keyed by
  `owner/name`, which a rename breaks silently — the repo reappears in
  Ungrouped, which is the safe failure but not an obvious one.
- A count badge on the toolbar icon (how many repos are still untagged) would
  need `action.setBadgeText` from the worker, which knows nothing about the
  page. Worth a permission? Probably not; the toolbar line already says it.
