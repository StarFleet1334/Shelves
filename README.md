# SHELVES

Group your GitHub repositories by topic, in the page you already open.

`github.com/<you>?tab=repositories` is one flat list — 76 repos in a column,
three filters, no folders. SHELVES re-draws it as named, counted, collapsible
shelves built from the **topics** you already put on your repos.

Then it does two things the page cannot. `/` searches your repositories by
**description, topic, language, licence and README** — not just by name, which
is all GitHub's own box can match. And every row carries a **private note**,
kept in your browser, that nothing on GitHub offers anywhere.

It is a lens, not an editor. It never writes to your GitHub account.

```
┌ expand all · collapse all · flat list · rescan · [find  /]  2 of 76 ─── 76 repos · 4 shelves · 31 tagged · via repo pages ┐

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

The first load shows a progress line — `reading topics from repo pages 34/76 —
cached after this` — for roughly ten to twenty seconds. Every load after that
is instant.

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
  the leftovers shelf.

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

### The optional token

Without a token, private repos' topics are read from your own repo pages using
the session you are already signed in with — one request per repo, cached for a
week. That is the default and it is correct; the token only makes it faster.

With one, a single API call answers everything:

1. [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta) → **Generate new token**
2. Repository access: **All repositories**
3. Permissions → Repository permissions → **Metadata: Read-only**
4. Every other permission: *No access*
5. Paste it into the options page and Save.

`Metadata: Read-only` is the weakest credential GitHub can mint. It cannot read
a line of your code and cannot write anything at all. It is stored in
`chrome.storage.local` — never in synced storage, so it does not travel to your
other machines — and is sent to `api.github.com` and nowhere else.

---

## Running the tests

```
cd tests
npm install        # jsdom, once — the extension itself has no dependencies
node harness.js    # all seven scenarios
node harness.js 3  # just scenario 3
```

Seven scenarios drive the real content scripts and the real service worker
against a jsdom GitHub:

| # | Scenario | Proves |
|---|----------|--------|
| 1 | chips already on the page | free path works, costs no network |
| 2 | no chips, no token | private repos resolve by page scraping |
| 3 | no chips, with token | one authenticated call, zero scraping |
| 4 | pagination | page-2 repos are shelved, pager hidden |
| 5 | idempotence | a second pass makes no second host, no nesting |
| 6 | warm cache | zero repo-page fetches, and the toolbar says *cached* |
| 7 | token rejected (401) | says so, falls through, still renders |
| 8 | facts | one page read yields ten fields, topics still sidebar-scoped |
| 9 | find | description, README, topic and language are all searchable |
| 10 | note | written, painted, searchable — and survives a rescan |

Scenarios can be named as well as numbered — `node harness.js facts find` —
and a selector that matches nothing **fails**. Roadmap proofs use keywords for
that reason: a number is an index and moves the moment a scenario is inserted
above it.

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
│       ├── topics.js       the four-rung topic ladder
│       ├── view.js         bucketing and rendering
│       ├── main.js         lifecycle; one idempotent run()
│       └── shelves.css     themed off GitHub's own CSS variables
├── tests/
│   ├── world.js            fake GitHub: jsdom + chrome stub + real worker in a vm
│   ├── harness.js          the seven scenarios
│   └── package.json        jsdom, dev only
└── tools/make_icons.py     regenerates the icons from source
```

Read `CHARTER.md` before changing anything in `src/`. It carries ten principles
and seven facts that were established by measurement — several of the odder
lines in the code are load-bearing, and the charter is where the reasons live.

---

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
- GitHub occasionally restructures the profile page. If shelves stop appearing,
  the selectors in `src/dom.js` are the single place to look — that is why they
  live in one file.

## Troubleshooting

| What you see | What it means |
|---|---|
| toolbar says `via api (public)` and most repos are Ungrouped | private topics were not read — check that page scraping is not blocked, or add a token |
| `token rejected (401)` | the token expired or was revoked; clear the field or make a new one |
| everything in Ungrouped | the repos have no topics yet, or your shelf names do not match any topic |
| shelves do not appear at all | not on `?tab=repositories`, or GitHub changed its markup — see `src/dom.js` |
| stale grouping after re-tagging | press **rescan** in the toolbar |
| `/` does nothing | the cursor is in another field — `/` stands down inside inputs so it never steals a keystroke you meant for GitHub |
| a note vanished | it was emptied; an empty note is deleted rather than stored blank. Nothing else removes one |
