# SHELVES

Group your GitHub repositories by topic, in the page you already open.

`github.com/<you>?tab=repositories` is one flat list — 76 repos in a column,
three filters, no folders. SHELVES re-draws it as named, counted, collapsible
shelves built from the **topics** you already put on your repos.

Then it does things the page cannot. `/` searches your repositories by
**description, topic, language, licence and README** — not just by name, which
is all GitHub's own box can match. Every row carries a **private note**, kept in
your browser, that nothing on GitHub offers anywhere. Every shelf wears a
**colour and a glyph** so you find one by recognising it rather than by reading.
And **audit** reads the collection back to you: which topics are three spellings
of one idea, which are on everything and therefore group nothing, and which of
your repos have no description, no README or no licence.

It no longer lives on one page. Open a repo and it wears its shelf's mark, in the
shelf's colour, with your private note — and if you let it, it quietly keeps its
cache warm while you are elsewhere on GitHub so you never wait out a cold read
again.

It is a lens, not an editor. It never writes to your GitHub account, and it
talks to exactly two hosts — `github.com` and `api.github.com`. Nothing it
learns leaves your browser.

It does **keep** things there, though, and the charter spells out exactly what
(topics, descriptions, README openings, your notes — for private repos too,
unencrypted, in your browser profile). Worth reading before you install it on a
shared machine.

```
┌ expand all · collapse all · flat list · rescan · audit 9 · [find  /] ─── 76 repos · 4 shelves · 31 tagged · via page + api (public) + repo pages ┐

▾ aiproject                                                                                         12
    chat-agent          Python  ★2   Updated 2 days ago      Private
    rag-pipeline        Python  ★0   Updated last week       Private
    …
▸ config                                                                                             1
▸ learning                                                                                           9
▸ Ungrouped                                                                                         54
```

Type `rate limiting` and the two repos whose *descriptions* say so rise out of
seventy-six, regardless of what they are called.
```
▾ aiproject                                                                                        1 / 12
    throttle-kit        Python  ★42  Updated 2 days ago
      ✎ the one with the broken deploy
▸ tooling (dimmed, no matches)                                                                     0 / 9
```

---

## Install and run

There is **no build step**. The folder in this repo is the folder the browser
loads.

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**, top right.
3. Click **Load unpacked**, and choose the `extension/` folder inside this
   project — *not* the project root.
4. Go to `https://github.com/<your-username>?tab=repositories` and reload.

The first load asks the GitHub API once, and one request answers every public
repository you own. Only what it cannot see — your private repos — is read a
page at a time, behind a progress line: `reading topics from repo pages 34/76 —
cached after this`. On the 77-repo account this was last measured against that
came to **one API call and no repo-page reads at all**; an account that is
mostly private is ten to twenty seconds. Every load after that is instant.

### Tag some repos first

SHELVES groups by topic, so a repo with no topics has nothing to group by. On
any repo: **About** (right sidebar) → ⚙ gear → **Topics** → type a label →
Enter → **Save changes**. GitHub lowercases them, so `AiProject` becomes
`aiproject`.

### Choose your shelves

Click the extension's icon (or `chrome://extensions` → *Details* → *Extension
options*):

- **Your shelves** — the topics you want as sections, in order. A repo goes on
  the **first** shelf whose topic it carries. Leave it empty and SHELVES groups
  automatically by whatever topics it finds, biggest shelf first.
- **Private repositories** — nothing to do. It works with no token; see below
  if you want it faster.
- **Behaviour** — start collapsed, how long to remember topics, what to call
  the leftovers shelf. Concurrency, page depth and the rung-4 ceiling
  (`scrapeMax`, 100) are defaults in `src/store.js` and are not on this page
  yet; the ceiling has a button on the toolbar instead.

### Find anything (`/`)

Press `/` anywhere on the page — or click the box in the toolbar — and type.
It matches the repo's **name, description, topics, language, licence, the
first line of its README, and your own note**, all of which SHELVES read once
and cached. GitHub's own filter box matches names only, which is why *"the one
about rate limiting"* is findable here and not there.

Shelves show `hits / total` while you search, and a shelf with nothing in it
dims rather than disappearing — the shelves are the map, and a map that
reshuffles while you search it is harder to read. `Esc` clears.

### A private margin

Hover any row and a small `✎ note` appears. Write anything: *"the one with the
broken deploy"*, *"client wants this back in March"*. `Enter` saves,
`Shift+Enter` makes a new line, `Esc` cancels.

Notes are **yours, not the cache's**. They live in this browser, never travel
to GitHub or to your other machines, are searchable by `/`, and — unlike
topics, stars or anything else on the page — nothing can rebuild one if it is
lost. So *rescan* and *clear cache* both leave them strictly alone, which the
charter states as the single exception to principle I.

Press **Save**. The GitHub tab reloads itself.

### Shelf identity — a colour and a glyph

Every shelf gets a hue and a shape, so eight shelves are one glance instead of
eight reading tasks.

The mark is a **hash of the shelf's own name**. Nothing is stored, nothing
syncs, nothing can be lost, and the same shelf is the same colour on every
machine you use, forever. The trade is that you cannot pick a colour and that
renaming a shelf gives it a new one — both stated in the charter, and both
cheaper than a settings key that would need a default, a migration and an answer
for a renamed shelf.

Two channels carry the same slot, so **either one alone identifies a shelf**:
a reader who cannot separate two of the hues still has twelve distinct shapes.
The leftovers shelf stays deliberately outside the palette — it is a remainder,
not an idea.

Both halves were measured in a real browser rather than eyeballed. `●` and `□`
turned out to be **tofu** in GitHub's own font stack on Windows — the
missing-glyph box, which at 10px passes for a marker — and a single lightness
across all twelve hues put four of them below 3:1 on the light theme. Every hue
now solves for its own lightness and clears **4.3:1 against both** `#ffffff` and
`#0d1117`, with no theme detection anywhere. See `tests/identity.html` and
`tests/glyph-probe.html`.

### Audit

Press **audit** in the toolbar. It opens one panel with two sections, because
they are two questions about one collection: what is wrong with your **topics**,
and what is missing from your **repositories**.

#### Topics GitHub will show you one repo's topics, and
it will show you every repo carrying one topic — but nothing anywhere shows you
your labelling vocabulary *as a whole*, which is exactly why it rots: every
individual decision looked fine.

The panel names five things, and **draws what is certain differently from what
is a guess**:

| | |
|---|---|
| **one idea** | `ai-project` and `aiproject` are the same letters. Arithmetic, so they are merged and counted as a **union** of repos — two spellings across three repos is three, not four |
| **narrower** | `ai` is a whole word inside `ai-project`. A suspicion, never merged |
| **typo?** | `kubernetes` and `kubernets` are one character apart. Also a suspicion |
| **blanket** | a topic on 5 of 6 tagged repos separates almost nothing; as a shelf it reproduces the flat list |
| **used once** | a topic on one repo describes that repo. It will make a shelf of one |

The count rides on the **closed** button, because a panel nobody opens tells
nobody anything. Every topic is listed below the findings, and pressing one
filters the page to the repos wearing it — a search you could not previously
express. Topics that are already shelves wear that shelf's own mark, so the
panel and the page below it are visibly the same map.

It reads the topics the ladder already resolved: no request, no storage, and
nothing written anywhere. Acting on what it says is still your job on GitHub,
because editing topics would be a write and principle I says no.

#### Repositories

The other half counts what is missing across the whole collection — no topics,
no description, no README, no licence — and what is archived but still shelved
among live work. GitHub can tell you *one* repo has no description; it has never
told anyone they have twelve, and twelve is the number that changes an
afternoon.

Each finding has a **SHOW** button that filters the page to exactly those repos.
That is a second addressing mode, not a search: *"the 12 with no description"* is
not a substring anyone could type, so it addresses rows by name and the find box
goes empty rather than filling with something unreadable. Your next keystroke
drops straight back into text search.

**The denominators are the honest part.** A count reads *2 of 4*, not *2 of 6*,
because two of those repos were answered by the GitHub API — whose body carries
no README at all — and asking them about a README would be reporting the API's
shape as your failing. On an account with a token, that would be every repo you
own. Whatever could not be asked is printed under the findings rather than
silently narrowing the denominator. This is principle XIII in the charter, and
it is there because an audit that quietly over-reports looks exactly like one
that works.

The caveat shrinks as the ladder climbs. A repo answered by page chips alone
carries three fields and can be asked about nothing else, so a run that stopped
at rung 1 could only report *not asked* about the whole collection: on the
77-repo account, making rung 1 a floor moved that line from **readme, licence
and description** to **readme alone**, and three real gaps appeared underneath
it that had been invisible.

### The mark on a repo's own page

Open any of your repositories and a chip sits at the top of the About sidebar:
the shelf's glyph, its name in its colour, the shelf's size, and a link back to
the shelves. Your private note comes with it, editable right there — which is
where you actually are when you remember something about a repo.

It is beside the topics on purpose. The shelf is the *consequence* of the
topics, and putting the answer next to its own input is the only placement that
needs no explaining.

**It fetches nothing.** Every input is already on the page or in local storage,
which is what makes it safe on a page you opened to read code.

The colour needs the whole collection to be correct — palette collisions are
resolved across every shelf at once — so the Repositories tab writes the shelf
list down and this page reads it. Without it (you have never opened your
shelves, and you are auto-grouping) the chip still names the shelf and simply
**declines to claim a colour**. A mark that disagrees with the shelves would be
worse than no mark.

### Where the topics come from

Four rungs, climbed from free to expensive, stopping the moment every repo is
answered:

1. **the topic chips already in the page** — free, no request
2. **`api.github.com` with your token** — one request per 100 repos, sees private
3. **`api.github.com` without one** — the same cost, public repos only
4. **each remaining repo's own page** — one request each, sees private

**Rung 1 is a floor, not an answer.** GitHub renders chips on some rows and not
others — 9 of 77 on the account this was re-measured against — so what the page
gives up for free is kept, and every repo it did not name still climbs. Until
2026-08-23 one chipped row ended the ladder for the whole collection: 68 repos
in Ungrouped, zero requests, nothing on the toolbar to say anyone had been
skipped, and no descriptions, READMEs, languages or licences for `/` to search,
because a chip is three fields and a repo page is ten.

So the source line is a **list of the rungs that contributed**, not one name:

```
via page
via api (token)
via page + api (public)
via api (public) + repo pages (cached)
via page + api (public) + repo pages
```

One name was enough while a run could only ever be one rung. With chips as a
floor a render is routinely two or three, and naming only the first would hide
the requests that answered most of the collection.

**Rung 4 has a ceiling.** It reads at most `scrapeMax` repositories in a pass —
100 by default, and a default rather than an option, because the options page
does not expose it yet — and the toolbar then grows a `read N more` button that
lifts the ceiling for exactly one pass. Everything the first pass read is
cached, so continuing costs only the repos that were deferred.

A deferred repo is **not** counted among the `N unread`: unread means we tried
and failed, and its cure is *rescan*. And it is not drawn as a warning, because
nothing went wrong — a limit you can lift is a choice offered, and filing it
beside `token rejected` would teach you to read a choice as a fault.

### Keeping the cache warm (off by default)

A first run that reaches rung 4 is ten to twenty seconds of fetching, and the
cache expires, so it comes back every week. Turn on **Keep the cache warm in the
background** in options and SHELVES refreshes the stalest few entries while you
are elsewhere on github.com.

It is off by default and stays that way, deliberately: everything else here
spends a request on a page you opened to see the result, and this spends them on
pages you opened for something else. That is a different kind of cost and it
needs its own consent.

The guards are the feature. It runs **only** where you are already on GitHub,
**never** on your Repositories tab (the ladder owns that page), **never** in a
background tab, one repo at a time with a gap, at most six per page you visit,
stalest first — and it **stops dead on the first refusal**, because a background
job that retries into a rate limit is how a convenience gets the foreground
throttled.

It refreshes what it has already seen and never discovers. A first run is still
cold; the point is that the second week is not.

### On other people's profiles

The shelves work on anyone's Repositories tab, but on a profile that is not
yours they use the **free rungs only**: topic chips already in the page, plus
the public API for that username. One or two requests, no token, no repo-page
scraping, and nothing written to your cache.

That is a deliberate narrowing, not a limitation. Your token answers *"what are
**my** repositories"*, which tells you nothing about somebody else's page — so
sending it there spends a credential on a request that cannot use it. And rung 4
would fetch every one of their repos with your session cookie: on a 600-repo
account, six hundred authenticated requests for one click on a link. The source
line lists the rungs that answered and ends `· not yours`, so the narrowing is
visible rather than assumed.

### When GitHub's page moves

The repo page will be restructured eventually, and today that failure would be
silent: selectors return blanks, descriptions vanish, and the toolbar goes on
saying everything is fine — because a dead selector and a repo with nothing
filled in produce exactly the same record.

So each parse records which **anchors** it could find, separately from what they
said. If most of a run's pages come back without them, the toolbar says so:

```
76 repos · 1 shelf · 0 tagged · via api (public) + repo pages · GitHub's repo
page changed shape — shelving is unreliable: read 41 pages, found the About
sidebar on 0
```

Below five pages read there is deliberately **no opinion** — at that sample a run
of genuinely sparse repos is indistinguishable from a dead selector, and a canary
that cries wolf is turned off within a week.

It can only ever speak about pages rung 4 actually read, which is a second
reason rung 1 had to become a floor: a run that stopped at the chips read no
page at all, so the run that would have noticed the sidebar moving was the run
that never happened.

### The optional token

Without a token, private repos' topics are read from your own repo pages using
the session you are already signed in with — one request per repo, up to the
ceiling, cached for a week. That is the default and it is correct; the token
only makes it faster.

With one, a single API call answers everything, private repos included, and the
toolbar reads `via api (token)`:

1. [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta) → **Generate new token**
2. Repository access: **All repositories**
3. Permissions → Repository permissions → **Metadata: Read-only**
4. Every other permission: *No access*
5. Paste it into the options page and Save.

`Metadata: Read-only` is the weakest credential GitHub can mint. It cannot read
a line of your code and cannot write anything at all. It is stored in
`chrome.storage.local` — never in synced storage, so it does not travel to your
other machines — and is sent to `api.github.com` and nowhere else.

**A rejected token falls back to a request, not to a label.** If it has expired
or been revoked, the toolbar says `token rejected (401)` and the run *re-asks
the public endpoint without the credential* before anything else — so the line
reads `via api (public) + repo pages`, and only what the public API genuinely
cannot see reaches rung 4. That branch used to set the label and skip the
request: it named a rung that had not run, and every repo fell through as
missing, which turned one dead credential into a page that read every
repository you own, one at a time.

---

## Running the tests

```
cd tests
npm install                     # jsdom, once — the extension itself has no dependencies
node harness.js                 # all 25 scenarios
node harness.js ladder-floor    # just that one
node harness.js facts find      # two of them
```

Twenty-five scenarios drive the real content scripts and the real service
worker against a jsdom GitHub.

**Name a scenario by keyword, never by number.** A number is an index and it
moves: scenarios were appended, `harness.js 8` stopped meaning the ladder and
started meaning `facts` — which passes, so a milestone whose proof was a number
would have ticked itself. `harness.js ladder-floor` still means what it meant.
A keyword matches as a substring of the scenario's own name, and a selector that
matches nothing **fails** rather than passing emptily. Roadmap proofs are
written this way for the same reason, and this list was a numbered table for one
release too long — by the end its row 17 said `identity` while scenario 17 was
`credentials`.

- `network` — every row carries chips, the page alone is the whole answer, and
  it costs no network
- `ladder-floor` — chips are a floor: the repos they did not name still climb to
  the API and the repo pages, and the API never overwrites a chip answer
- `ceiling` — rung 4 stops at `scrapeMax`, says how many are left, and the
  continue reads exactly those and re-reads none of the rest
- `token-fallback` — a dead token re-asks the *public* API instead of reading
  every repo page one at a time
- `"no token"` — private repos resolve by page scraping, with no credential
  anywhere
- `"with token"` — one authenticated call, zero scraping
- `pagination` — page-2 repos are shelved, pager hidden
- `idempotence` — a second pass makes no second host, no nesting
- `"warm cache"` — zero repo-page fetches, and the toolbar says *cached*
- `rejected` — a 401 is said out loud, and the page still renders
- `facts` — one page read yields ten fields, topics still sidebar-scoped
- `find` — description, README, topic and language are all searchable
- `note` — written, painted, searchable — and survives a rescan
- `vocabulary` — families, suspicions, blanket labels and singletons, each drawn
  as what it is, and 3 000 topics in milliseconds
- `audit` — gaps denominated per field per source; a finding filters to its own
  repos
- `mark` — the shelf's mark on a repo page, with its note, at zero requests
- `degrades` — no shelf map means no colour — never a wrong one
- `warm` — off by default, stalest first, bounded, stops on 429, never discovers
- `canary` — a moved selector is named; four pages is below the floor
- `credentials` — a stranger's profile costs no token, no scrapes and no cache
  writes, and is still shelved
- `backoff` — GitHub says stop, the run stops, and the toolbar counts the unread
  and names the cure
- `untrusted` — a page-supplied href is not a URL to fetch
- `forgets` — the fact cache is pruned by age and capped by count, newest kept
- `packaging` — one permission, two hosts, the excluded routes, the licence, and
  a storage claim that matches the code
- `identity` — a distinct hue and glyph per shelf, stable under any drawing order

Two of those are phrases and need quoting, because the two token scenarios are
told apart by one word: `node harness.js "with token"`. Two more deliberately
overlap — `mark` runs `degrades` with it, `warm` runs `"warm cache"` with it —
which is a name covering both, where a number would have been a guess.

Several things in there are **not** checkable without a browser, and every one
of them shipped wrong once: `tests/row-layout.html` measures the note margin
against GitHub's real row, `tests/identity.html` + `tests/glyph-probe.html`
measure every palette slot for tofu and for contrast on both themes, and
`tests/mark.html` measures the repo-page chip inside a real 296px sidebar —
which is the only width at which a long shelf name can overflow. Photograph
them with anything that renders a page; jsdom computes no layout and cannot
tell a shape from the missing-glyph box.

One class of bug not even a fixture can see, because it is about how much room
we take on **GitHub's** page rather than about our own markup: `tests/row-
height.py` loads the unpacked extension into a real browser, opens a real
profile, and asserts that a shelved row is exactly as tall as GitHub's own —
switching each of our rules off in the live page to find out which one owns the
difference.

**Run it signed in.** A signed-out profile is a different page, not a cheaper
sample of the same one: the lazy fragments GitHub ships inside a repo row only
refuse to load when they carry a nonce that is checked, and that is the
signed-in response. Merged rows there arrive with a fragment from another
page's nonce, fail without ever reaching the network, and reveal a full-width
error blankslate into a 145px column — 47 rows at 1 416px each, which reads as
blank because nothing in it is legible at that width. Measured signed out, the
same page is clean. The test now says so when it is run without a session.

Assertions are on counts and membership, never on "it did not throw".

**The harness cannot judge layout or event semantics.** After a change that
touches either, load it unpacked and look at the real page.

---

## Layout

```
shelves/
├── CHARTER.md              principles, measured facts, architecture
├── ROADMAP.md
├── extension/              ← this is what you Load unpacked
│   ├── manifest.json
│   ├── background.js       service worker; the only caller of api.github.com
│   ├── options.html/.js    shelf editor, token, behaviour
│   ├── icons/              generated by tools/make_icons.py
│   └── src/
│       ├── store.js        settings · token · fact cache · notes · collapse
│       ├── dom.js          route detection, list finding, page merging
│       ├── facts.js        ONE parse of a repo page → ten fields
│       ├── topics.js       the four-rung topic ladder; rung 1 is a floor
│       ├── vocab.js        the topics as a system, and the panel kit
│       ├── audit.js        the repos as a system: what is missing
│       ├── view.js         bucketing, rendering, shelf identity
│       ├── mark.js         route 2 — the mark on a repo's own page
│       ├── warm.js         route 3 — the opt-in background top-up
│       ├── main.js         lifecycle; one idempotent run()
│       └── shelves.css     themed off GitHub's own CSS variables
├── tests/
│   ├── world.js            fake GitHub: jsdom + chrome stub + real worker in a vm
│   ├── harness.js          the 25 scenarios, selected by keyword
│   └── package.json        jsdom, dev only
└── tools/make_icons.py     regenerates the icons from source
```

Read `CHARTER.md` before changing anything in `src/`. It carries ten principles
and seven facts that were established by measurement — several of the odder
lines in the code are load-bearing, and the charter is where the reasons live.

---

## What it stores

In your browser profile, unencrypted, via `chrome.storage.local`:

- **the fact cache** — for every repo including private ones: name, description,
  language, stars, forks, licence, homepage, last-touched, and the README's
  first 400 characters
- **your notes** — the one thing here that nothing can rebuild
- **the shelf map** — your shelf names, their counts, and your repo names
- **the token**, if you added one — `local` and never `sync`, so it does not
  travel between machines

Entries are pruned once they have been untouched for four cache lifetimes (at
least 90 days), and the cache is capped at 3 000 repos. **Clear topic cache** in
options empties it now; your notes are never touched by it.

One thing is kept outside all of that: pressing `read N more` writes a single
flag to `sessionStorage`, which the next load reads and deletes. It is not a
setting — it is a decision about this tab, taken once — so it never syncs and a
reload cannot silently repeat a large read you authorised once.

None of this ever leaves the browser — but anyone who can read your browser
profile can read all of it, including private repository names and whatever you
wrote in your notes. MV3 has no encrypted store, so that is inherent rather than
a choice. Worth knowing before installing on a shared machine.

## Known limits

- **Chrome and Edge only.** Firefox's MV3 service workers differ enough to be a
  port rather than a flag.
- **Eight of the ten harvested fields are best-effort.** `topics` and
  `description` were measured against the real page; the rest prefer `<meta>`
  tags and href shapes over class names, which is a hedge and not a proof.
  A field that cannot be read is absent, never wrong — but until someone drives
  `facts.js` against a real logged-in repo page (a milestone on the roadmap),
  treat a blank star count as "not verified yet" rather than "no stars".
- **Topics only.** Not language, not stars, not last-pushed — those are filters
  GitHub already ships.
- **A repo appears on exactly one shelf.** First match wins.
- **Above ~600 repos** the API path stops paginating; the page path still works.
- **Rung 4 reads at most 100 repositories in a pass** (`scrapeMax`). The rest
  are counted on a `read N more` button rather than fetched, and the button
  lifts the ceiling for one pass. It is a default in `src/store.js`; the options
  page does not expose it yet.
- GitHub occasionally restructures the profile page. If shelves stop appearing,
  the selectors in `src/dom.js` are the single place to look — that is why they
  live in one file.

## Troubleshooting

| What you see | What it means |
|---|---|
| the source line ends at `via api (public)` and most repos are Ungrouped | rung 4 never ran — private topics were not read. Check that page scraping is not blocked, or add a token |
| the source line names several rungs, `via page + api (public) + repo pages` | that is normal. It lists every rung that contributed, in the order it was climbed; one name would hide the requests that answered most of the collection |
| `read N more` in the toolbar | rung 4 stopped at 100 repos. Press it to read the rest — one request each, once, and they are cached afterwards. Nothing went wrong |
| `token rejected (401)` | the token expired or was revoked; clear the field or make a new one. The run has already re-asked the public API without it, so the page is still shelved |
| everything in Ungrouped | the repos have no topics yet, or your shelf names do not match any topic |
| shelves do not appear at all | not on `?tab=repositories`, or GitHub changed its markup — see `src/dom.js` |
| stale grouping after re-tagging | press **rescan** in the toolbar |
| `/` does nothing | the cursor is in another field — `/` stands down inside inputs so it never steals a keystroke you meant for GitHub |
| a note vanished | it was emptied; an empty note is deleted rather than stored blank. Nothing else removes one |
| a shelf changed colour | you renamed it. The mark is a hash of the name, which is what lets it be the same on every machine with nothing stored |
| two shelves look similar | they will still have different glyphs — the shape is the second channel and it never agrees with the wrong hue |
| the chip on a repo page has no colour | you are auto-grouping and have not opened your Repositories tab yet — the colour depends on the whole shelf list, so it declines to guess one |
| no chip at all on a repo page | only the repo's landing page carries the About sidebar it sits in; sub-pages (issues, code, a file) do not |
| the audit says "not asked" | those repos were answered by the GitHub API, whose body does not carry that field. A rescan without a token reads the pages themselves |
| the toolbar says `· not yours` | you are on someone else's profile; only the free rungs run there, on purpose |
| the toolbar says `N unread` | GitHub refused some repo-page reads — often a rate limit. Press **rescan** in a few minutes. Repos the ceiling deferred are never counted here: they were not tried, and their cure is the button, not a rescan |
| the toolbar says GitHub's page changed shape | it probably has. `facts.js` owns every repo-page selector; nothing else needs looking at |
