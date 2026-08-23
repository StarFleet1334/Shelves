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
   It is now the first thing on this list by a distance. There is one
   legitimate early return beside it now, and it is worth naming because at a
   glance it reads like the bug: `remembered >= asked` in `resolve()` ends the
   ladder when the per-visit memo has already answered **every** repo on the
   list (*compose*, below). The gate is the whole difference — the bug returned
   when ONE repo was answered, this returns only when none is left — and the
   memo is filled per repo, only from a rung that genuinely answered.
2. **A first run for someone who has never tagged a repo used to produce the
   page they already had.** Fifteen seconds of fetching, then one shelf called
   Ungrouped holding all 76 — re-measured 2026-08-23 on a live profile at 54
   public repos, **1** of them tagged, 53 in the leftovers shelf. Everything
   under *the first day* existed to close that without ever writing to GitHub,
   and on 2026-08-23 all three of it landed: the same cold start now opens
   offering `add Java (23)`, `add Go (11)`, `add Python (3)` and
   `add wiremock (3)`, the leftovers shelf counts `53 untagged · tag them` and
   hands over one tab per press, and a row dragged onto a shelf stays there.
   The remaining work in this document is reach, not that gap.
3. **What a source can answer is itself a measurement, and it had gone stale
   under this list.** `CARRIES` — which rung may speak for which field — lived
   in `audit.js` and claimed the page rung could answer for `language` and
   `updated`. Re-measured 2026-08-23 against the server HTML `scrape()`
   actually parses (**not** the hydrated DOM `mark.js` reads), across six real
   repo pages: **zero** `<relative-time>` and **zero** `a[href*="/search?l="]`.
   GitHub renders the languages bar and every timestamp on the client now. The
   table moved to `facts.js`, beside the three functions that build the records
   it describes, and `audit.js` defers to it — one table, because a rule and an
   audit asking the same question from two copies drift silently in both
   directions. This is a live constraint on *shelves worth the name* below and
   not tidying: on a collection answered by repo-page scraping, a `lang:` or
   `pushed:` term can only report every repo as **unjudged**, which is the
   honest answer and is not the same sentence as "none".

---

## Landed

- [x] ONE PARSE, TEN FACTS — the repo page we already fetch gives up its description, language, stars, forks, licence, homepage, README opening line and last-touched time, not just its topic chips; the API path harvests the same fields from a body it was already receiving `proof: node tests/harness.js facts`
- [x] FIND — `/` searches descriptions, topics, languages, licences, READMEs and your own notes, which GitHub's own box (names only) cannot; shelves count their hits and dim rather than reshuffle `proof: node tests/harness.js find`
- [x] A PRIVATE MARGIN — one local note per repo, painted on the row, searchable, and never taken by a rescan `proof: node tests/harness.js note`
- [x] THE VOCABULARY PANEL — the tag system read as a system: spellings of one idea merged, one-character neighbours and narrower words offered as suspicions, blanket labels and single-use topics named, every topic listed and pressable. No request, no storage, nothing written `proof: node tests/harness.js vocabulary`
- [x] SHELF IDENTITY — a hue and a glyph per shelf, hashed from the name so nothing is stored and nothing can drift; two channels, so up to twelve shelves either one alone identifies a shelf and above that the pair does (see *the first day*, where the wrap that broke both at once was found); measured in a real browser for tofu and for 3:1 contrast against both themes `proof: node tests/harness.js identity`
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

- [x] LOCAL SHELF OVERRIDES: a repo goes where the reader says it goes. `S.overrides` in `chrome.storage.local`, `{ "owner/name": "shelf label" }`, checked by `bucketFor()` **before any topic** — and the only path in the extension that can shelve a repo with no topics at all. It landed as TWO gestures onto one write rather than the drag this line asked for: a `⠿` grip in the note margin drags onto a shelf, and pressing the same grip opens a menu of the shelves that exist, which is the half that works from a keyboard and the half a stub DOM can drive. A move writes ONE key and re-homes ONE row with **no reload** — the reader keeps their scroll, their open shelves and the search they were typing, which is why `overrides` had to join main.js's QUIET list — and moving a repo back onto the leftovers shelf DELETES the key rather than storing a withdrawn opinion. Exempt from `cache.clear()` exactly like notes, and for the same reason: no request re-derives one. Measured on the live profile — a row dragged out of Ungrouped onto `config` took the counts from 1 / 53 to 2 / 52 with nothing reloading, and was still 2 / 52 after a full page reload. Still not one write to GitHub `proof: node tests/harness.js override`
- [x] Ungrouped becomes a WORKBENCH, not a dump: the leftovers shelf's own summary reads `53 untagged · tag them`, one press opens the next untagged repo in its own tab, the label becomes `tag them · 2 of 53`, and past the last one it wraps to the start. One tab per press — a fan of thirty is an ambush, not a funnel. Counted from the **TOPICS** and not from the shelf, so a repo pinned by hand is off the leftovers shelf, still untagged and still worth tagging. The place in the queue is bookmarked in `localStorage` (`shelves:bench:<owner>`) beside the collapse state, because it is a place rather than a preference. The extension still writes nothing: the two-click edit happens in GitHub's own About panel, which is precisely why the walk hands over the tab instead of offering a form `proof: node tests/harness.js workbench`
- [x] SUGGESTED SHELVES on a cold start — `S.suggestions(vdata, facts, names, settings, placed)` in vocab.js, drawn as a strip above the shelves, each offer `add <label> (N)`, ranked by reach and capped at ten. Three kinds: `topic` (a real tag that is not yet a shelf), `prefix` (a shared leading word in the NAMES — the only signal an account with no topics gives at all) and `language`. What the sketch missed is that only a topic is pure configuration: a prefix and a language match no topic and never will, so the same press that writes `settings.groups` also **pins those repos with overrides**, or it would build an empty shelf and read as broken. Names arrive LOWERCASED (`fullNameOf` lowercases), so the prefix walk sorts the bare names and holds a run together while they still share ≥ 3 leading characters, labelling it with the prefix they actually share — `wiremock`, never `wire`. A repo already on a real shelf is never counted towards a new one, and a suggestion covering more than half the collection is suppressed as the blanket label `vocabulary()` already complains about. Cold start on the live profile: `add Java (23)`, `add Go (11)`, `add Python (3)`, `add wiremock (3)`; accepting `wiremock` gave `{config 1, wiremock 3, Ungrouped 50}` `proof: node tests/harness.js suggest`
- [x] SHELF IDENTITY SURVIVES THE THIRTEENTH SHELF — a prerequisite, not a feature, and found while building the three above. `identity()` used ONE slot for both channels, so past twelve the walk wrapped and handed out a duplicate hue **and** glyph together: both channels failing at once, which is the one failure two channels exist to prevent, and the README stated the opposite as fact. Not a corner case either — auto-grouping makes one shelf per distinct topic and `suggest` turns accepting a thirteenth into one click. Hue and glyph are now walked independently: twelve or fewer still get twelve distinct hues AND twelve distinct glyphs, unchanged, and above that the PAIR carries the identity, 144 of them. The cost is now stated rather than denied — past twelve, one channel necessarily repeats and the other is what tells two shelves apart `proof: node tests/harness.js identity`

## Shelves worth the name

Measured together on the live public profile — 54 repos, groups
`["Java = lang:java fork:false", "Recent = pushed:<180d", "Old Guard = pushed:>2y", "config"]`
— which is the run every number in this section comes from: **Java 26, Recent
1, Old Guard 23, Ungrouped 4**, 23 rows wearing sibling chips, and a pinned
repo at the top of Java that was still there after a reload.

- [x] A SHELF MAY BE A RULE, NOT ONLY A TOPIC — an entry in `settings.groups` of the form `Name = topic:ai lang:python fork:false pushed:<90d` becomes a shelf whose membership is a question; anything with no `=` stays the plain topic string shelves began with, so it is ONE list, one order, and nothing to migrate. New file `extension/src/rule.js` (`S.parseRule`, `S.shelfSpecs`, `S.matchRule`, `S.isRule`), parsed **once per page** and applied to the rows already there — no request, no index, no second axis. Terms are all `AND`-ed (no `or`, no parentheses, no precedence to learn or to get wrong: two ideas are two shelves, which is the model the rest of the extension already has), `-` negates one, and a bare word matches the name, the description or the topics. The fields are `topic`/`topics`, `lang`/`language`, `license`, `name`, `desc`/`description`, `readme`, `homepage`, `fork`, `archived`, `private`, `stars`, `forks` and `pushed`/`updated`; numbers take `>` `<` `>=` `<=`, ages take a unit (`90d`, `6m`, `2y`), and `pushed:<90d` reads as *pushed within the last 90 days* — the plain-English sense, which is the reverse of the arithmetic. **First match still wins, in the reader's own list order**, so a rule shelf is tried exactly where its entry sits and there is no new precedence anywhere. Three rules of its own, none of them in the sketch and each one a way the feature could have lied instead: a term naming a field the record's SOURCE cannot carry is **UNKNOWN, not false**, so it excludes the repo — leftovers is the charter's safe failure — and the count is stated on the shelf header as `N unjudged`; a term nobody can **parse** is named in the toolbar (`unreadable in Oops: topc:ai pushed:90`) rather than silently dropped, because a shelf that quietly ignores a third of itself leaves the reader looking at contents they cannot explain; and the whole thing is AND-ed, above. **The sketch's own example returns ZERO on this collection**, and that is worth writing down rather than quietly replacing with an example that works: `topic:ai lang:python fork:false archived:false pushed:<90d` wants a repo that is tagged, Python, unforked and pushed this quarter, and the live profile has **1 tagged repo of 54** and **1 repo pushed inside two years**. The grammar is sound; this particular collection is sparse, which is the same fact *the first day* is built around. Four ways a rule lied were found and fixed while measuring it, all of which change what a term means rather than whether it runs: `lang:` and `license:` are **exact**, not substrings (`lang:java` was holding 26 Java repos AND 2 JavaScript ones — the Java shelf went 28 → 26 live, and `lang:c` is the same trap waiting for C++, C#, CSS and Clojure); `name:` matches the repo's own name and not `owner/name` (`name:star` matched all 54 rows on an account called StarFleet1334); `factsFromApi` now carries `private`, which `CARRIES` had claimed and nothing wrote, so `private:false` matched every repository and `private:true` matched none; and `isFork()` is structural — measured on a real fork, `span.fork-flag` and `[data-testid="repo-header"]` both matched nothing while "forked from" sat in the HTML, so `fork:false` confidently kept a fork. (`a[href*="-ov-file"]` joined the licence selector in the same pass: `#Apache-2.0-1-ov-file` is the shape GitHub links a licence with now, on 5 of 6 real repo pages, and neither older spelling matched it.) `S.CARRIES`/`S.carries()` moved to `facts.js` and `audit.js` defers to it — see framing fact 3, which is what a rule may ask a scraped collection `proof: node tests/harness.js rule-shelf`
- [x] THE SHELF HEADER CARRIES WEIGHT — `★ <stars> · <n> stale · <n> since you were here · <n> unjudged`, drawn before the count and quieter than it, because the count is the shelf's identity and this is its weather. Stale is nothing pushed in a year. `N since you were here` is the sketch's own claim and it holds: GitHub knows when every repository was pushed and has no idea when **you** last looked, so the sentence can only exist in something living in your browser — `shelves:seen:<owner>` in `localStorage`, per profile, beside the other two postures. What the sketch did not know is that it has to be read and stamped **exactly once per visit**: a progressive render is two passes and a Type/Language filter is a third, so reading it per render would make "since you were here" mean "since a few hundred milliseconds ago" and the answer would be zero forever. And it shows **nothing rather than zero** when the source cannot answer — a rung-1 record carries no stars and no dates, and `★ 0 · 0 stale` would be a statement about the collection when it is a statement about the source. That is `carries()` again, the same test the audit uses and now the same table. `N unjudged` rides here rather than in a warning about the whole page, on the rule shelf that lost the repos. Measured live: Java read `★ 1 · 26 stale` `proof: node tests/harness.js weight`
- [x] A ROW WEARS CHIPS FOR THE OTHER SHELVES IT MATCHED — first match still wins the row, and it has to (a repo on two shelves is two counts that do not add up and a page you cannot scan once), but the information that rule throws away is real and is most of what a reader wants when a shelf looks thin. Capped at four chips and then `+n`. Two things the sketch left open, both decided by what was already on the row: they ride in the **note margin**, which on a row with no note is parked in the 24px of padding GitHub already leaves, so they cost the row **no height at all** — the difference between information and a redesign, and a bill this project has already paid once at 22px × 54 rows; and they are **drawn, never pressable**, because a chip you could click would mean "move it there", which is the grip's job and would quietly become a second way to write an override. Repainted on the second pass, since which shelves a row also matched is one of the things the ladder changes its mind about. Auto-grouping draws none: with no configured shelves there is one shelf per topic and every chip would be a restatement of the row. 23 of 54 rows wore one live `proof: node tests/harness.js sibling-shelves`
- [x] PIN A REPO TO THE TOP OF ITS SHELF — `S.pins` in `chrome.storage.local`, `{ "owner/name": true }`, offered by the **same grip menu that moves a repo** and as its first entry, because the top of a shelf is part of where a repo goes and a second affordance for it would be one gesture too many. Pinned rows rise as a **stable partition, not a sort**: GitHub's order inside a shelf is the reader's own `Sort` setting and is not ours to rearrange, so the only claim being made is *these few first*. Pinning puts a row **below** the ones already pinned, so pinning three in a row does not silently reverse them, and unpinning drops it back under the pinned ones rather than to the bottom. Rescan-proof and `clear cache`-proof exactly like notes and overrides, and for the same reason: no request re-derives which repositories matter to you this month. Those three are now the whole of that category `proof: node tests/harness.js pin-top`

## The page as an instrument

- [x] PROGRESSIVE RENDER — `run()` is two passes. Phase one shelves from what is already free: the topic chips on the rows, plus every record the fact cache already holds. Phase two hands the ladder's answer to `host.rebucket(…)`. The sketch's *re-bucket as topics arrive* turned out to be the load-bearing half rather than a wording — **it re-buckets and never re-renders**, because building a second host and swapping it in is four lines and silently loses the find box's text, the filter that text applied (the `sh-hide` classes ride on the ROWS and would survive with nothing on screen explaining them), `data-sh-was-open`, the open audit panel, keyboard focus and an open shelf-pick menu — and re-parents every row a second time, which is a second chance to cut GitHub's own lazy fragments off mid-flight. So a row moves only if its shelf changed and a shelf is created only if it is new. The provisional pass writes **nothing persistent**: no `shelves:open:<owner>` key (a `toggle` is a queued task, so a shelf the guess opened would otherwise persist a name the finished page may never draw again, into a store with no eviction path) and no shelf map (another page would colour a chip from an order that may not survive). The source line reads `via page + cache` and never names a rung that has not run. It helps exactly where the pain is: the fact cache only ever holds rung-4 records, so it is populated precisely for the private, API-invisible tail that makes a run slow, and an account the API can see skips the whole thing and loses nothing. Measured on the live profile — first frame at **341 ms**, against **1 178 ms** with a cold cache, settling to the full answer after `proof: node tests/harness.js progressive`
- [x] COMPACT DENSITY — a `compact`/`roomy` button in the toolbar that sets ONE attribute on the host, remembered per profile in `localStorage` (`shelves:density:<owner>`) and read **before the first paint**, because applying it afterwards draws the roomy page and then collapses it under the reader. It is CSS only (P.V): the description, the topic chips and the commit graph are hidden, never removed, so the search index still reaches every field and `roomy` gives them back instantly. Per profile and deliberately not in `settings`, because the right density depends on the SCREEN and sync would carry a 27-inch monitor's choice to a laptop where it is wrong. Measured live: **109px → 41px per row, nine rows a screen → twenty-four**. One surprise, and it is in the stylesheet rather than the design — Primer's `.d-inline-block` is `!important`, so `display: flex` on the row's text column lost however specific the selector was: 81px instead of 41px, and the rule looked simply not to have fired `proof: node tests/harness.js density`
- [x] KEYBOARD — `/` focuses and selects the filter, `j`/`k` walk to the next and previous shelf, `1`–`9` jump to that shelf **and open it** (a shelf you jumped to and cannot see is not a jump), `e`/`c` expand and collapse every shelf. `j`/`k` move **focus**, not the scroll — focus is what a screen reader follows and what `Enter` then acts on — and they wrap, because a cursor that sticks at the end gives no feedback distinguishable from a key that did nothing. What the sketch did not know is that **`/` was never ours**: GitHub binds it on `document` too and their script runs long before a content script at `document_idle`, so their listener is registered first and fires first, and `preventDefault` from a later one is far too late. Measured only in a real browser — our `/` was opening GitHub's quick-search overlay over the page. The map is registered in the CAPTURE phase and every branch that acts calls `stopPropagation`, because capturing without stopping leaves their handler to run anyway. Every key stands down inside a field (GitHub's own boxes and our note editor included), a modified key is left to the browser, and a digit naming no shelf is not swallowed `proof: node tests/harness.js keyboard`
- [x] COMPOSE — and what composing turned out to mean is not what this line asked for. **The rows cannot be kept.** Measured: the Type and Language menus are an in-page fetch plus a `history.replaceState` that REPLACES the children of `#user-repositories-list`; no `turbo:*` event fires at all, so the MutationObserver is the only thing that notices, and the rows arrive as brand-new elements with every `data-sh-*` gone. There is nothing there to compose with. What survives is the JAVASCRIPT CONTEXT, so the **answer** and the **query** do: a per-visit session memo (`S.session` in topics.js) makes a dropdown cost **zero** requests instead of one API call per press — keyed on whether a rung *answered* rather than on whether it *found* anything, since "this repo genuinely has no topics" is the commonest answer there is and remembering only the tagged left every untagged repo climbing the whole ladder again — and the reader's typed query is re-applied after the swap. The other half of the line needed nothing at all: GitHub's own *Find a repository* box is server-side (`data-throttled-autosubmit`) and the `data-filterable-*` attributes on its `<ul>` are inert — typing hides no row, removes no row and sets no class — so not copying them onto our own lists never broke it, which is the opposite of what it looks like. A by-name filter from the audit is deliberately NOT restored: it names repositories the new row set may not contain, and a filter that silently means something else is worse than none. Measured live through the real dropdown — before `2 of 54`, after `26 repos · 1 shelves · 0 tagged · via already read`, the find box still reading `gym` and the bar `1 of 26` `proof: node tests/harness.js compose`

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
  overrides above have shipped and are the answer that stays read-only: the
  opinion lives in the browser, keyed `owner/name`, and uninstalling still
  undoes everything. The workbench is the other half of the same answer — it
  hands the reader the tab and lets GitHub take the write.
- Grouping by language or stars **as a permanent axis**. Those are filters
  GitHub already ships, and a second axis makes the mental model two things
  instead of one. What is built instead is configuration, twice over, and
  neither one is an axis: `S.suggestions()` offers a language a shelf-worth of
  repos share, and accepting it writes `settings.groups` and pins those repos,
  producing a shelf indistinguishable from one typed into the options page —
  no "suggested" state to migrate later; and a **rule shelf** lets the reader
  write `Java = lang:java fork:false` or `stars:>10` themselves. That is the
  line, and it is worth stating exactly: a rule is one more entry in the one
  list of shelves, tried in the reader's own order, and a repo still lands on
  exactly one of them. There is no second grouping anywhere, and nothing on the
  page groups by language or stars unless the reader wrote the shelf that does.
  *A count is not a name* was the old reason stars were not offered; a rule
  shelf answers it by making the reader supply the name.
- Syncing shelves to a server. Everything stays in the browser.

## Open questions

- The top-up refreshes what it has already seen and never discovers, so a repo
  created since your last visit to the Repositories tab is still a cold read.
  Warming from `shelfMap.names` instead of the cache's own keys would close
  that, at the cost of fetching pages nobody has asked for yet.
- Is a week the right cache TTL? It is configurable, but the default was picked
  by feel and has not been measured against how often anyone re-tags. The
  progressive render has since made it two questions rather than one: how long
  a cached fact may be **spent from** (`scrape()` checks `cacheDays`, because
  it is deciding whether to spend a request) and how long it may be **shown**
  (the first frame checks nothing, because it spends nothing and phase two
  overwrites it either way). A nine-day-old topic list is a better first frame
  than `Ungrouped` — but it is on screen, and nothing says it is stale.
- The session memo dies with the page, so a dropdown is free and a **reload**
  is not. The disk cache cannot close that: `repoFacts` only ever holds rung-4
  records, so the API rung fires on every run, warm or cold — one
  `api.github.com` call per page load for an answer the last one already had.
  Caching an API reply to disk would mean deciding how long "this repo has no
  topics" stays true, which is the TTL question again with a different blast
  radius.
- Should an override survive a repo being renamed? **This is live now rather
  than hypothetical**, and it is three stores rather than one: notes, overrides
  and now `pins` are all keyed `owner/name`, which a rename breaks silently —
  the repo reappears in Ungrouped unpinned and with an empty margin, which is
  the safe failure but not an obvious one, and the old keys stay in storage
  pointing at a name that no longer exists. Nothing anywhere tells the reader
  the shelving they did by hand was dropped. Surviving it would mean keying by
  the repo's id, which the profile page does not carry.
- `N unjudged` names the problem and offers no cure. A repo is unjudged because
  the rung that answered it cannot carry the field the rule asked for — a
  scraped page has no language and no push date, and rung 1's chips have
  neither plus nothing else — so the fix is a token, or a rescan that reaches
  the API, and the header says none of that. Putting a verb there would mean
  the shelf header offering to spend requests, which no other count on this
  page does.
- A rule is written in a textarea in the options page and read on the profile
  tab, so a misspelt field is only discovered once, in the toolbar, after a
  reload. The options page could parse it at the point of typing — `parseRule`
  already hands back `bad` — but that is the first thing in this extension that
  would validate the reader's configuration rather than simply reading it.
- A count badge on the toolbar icon (how many repos are still untagged) would
  need `action.setBadgeText` from the worker, which knows nothing about the
  page. Worth a permission? Probably not; the toolbar line already says it.
