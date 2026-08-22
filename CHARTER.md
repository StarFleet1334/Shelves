# SHELVES — charter

A browser extension that gives GitHub's Repositories tab the one thing it has
never had: **shelves**. Your repos, grouped under headings you chose, in the page
you already open.

---

## The thing itself

`github.com/<you>?tab=repositories` is one flat list. Three filters, a
name-matching search box, and 76 repositories in a column. There is no folder, no
group, no section — nothing that says *these eleven are the AI project and those
nine are things I was learning*.

The label system already exists. **Topics** — repo → About → ⚙ → Topics — are
free-form tags, unlimited, editable in two clicks, and already attached to the
right object. GitHub simply never renders a view that groups by them.

SHELVES is that view. It reads the topics and re-draws the page as named,
counted, collapsible sections. It is a **lens on your own data**, and that phrase
is the whole design: it never writes to GitHub, never stores your repositories
anywhere, and uninstalls to exactly the page you had before.

---

## Principles

These are ordered. When two conflict, the earlier one wins, and the code should
say so at the point of conflict.

### I. The user's data is never the extension's data

SHELVES writes nothing to GitHub. Not a topic, not a star, not a description —
there is no code path that issues a mutating request, and the permissions it asks
for cannot express one. Almost everything it keeps locally (the fact cache, a
handful of settings) is derived, disposable, and reconstructible by pressing
*rescan*.

**There is exactly one exception, and it is written down here so that it cannot
be forgotten by someone tidying up a clear-cache handler: notes.** A sentence
the user typed about a repository is derived from nothing and no request
re-creates it. It therefore lives under a different rule from the cache —
*rescan* and *clear cache* must never take it with them, and the code says so
at both call sites. Widening this exception is a charter amendment, not a
feature.

The practical test: **uninstalling must be a complete undo.** No orphaned state
on any server, nothing changed about the account.

### II. Ask for the smallest permission that can do the job

`storage`, plus host access to `github.com` and `api.github.com`. Nothing else.
Not `tabs`, not `cookies`, not `webRequest`, not `<all_urls>`.

The optional token follows the same rule: a **fine-grained token with
`Metadata: Read-only`** — the weakest credential GitHub can mint that still
answers the question, unable to read a line of code or write anything at all. The
options page says this in words, next to the field, because a user pasting a
credential deserves to know exactly what they are handing over.

### III. Degrade, never fail

Every input is allowed to be missing. No token, no network, a rejected
credential, a repo page that 404s, a rate-limited API, GitHub restructuring its
DOM — each of these costs *some grouping*, and none of them may cost the user
their repository list.

The failure mode is always the same shape: **that repo lands in Ungrouped, and
the page still renders.** There is no error state in which SHELVES leaves the
page worse than it found it. The whole pass sits in a `try/finally` that restores
the original list if anything escapes.

### IV. Say which rung answered

Grouping is assembled from four different sources of truth (§ *The ladder*). When
the result looks wrong, the first question is always *where did these topics come
from* — so the toolbar states it, always, unprompted:
`76 repos · 4 groups · 31 tagged · via repo pages`.

An extension that silently produces the wrong grouping is worse than one that
produces none. Observability is not a debug feature here; it is the interface.

### V. Move the DOM, do not rebuild it

The rows in a group are **GitHub's own `<li>` elements, re-parented**. Not
re-rendered from scraped data, not reconstructed from the API.

This is what makes stars, language dots, "Updated 3 days ago", the Private badge,
fork indicators, hover cards and every future GitHub addition keep working with
no effort and no maintenance. Rebuilding rows from data would mean re-deriving
all of it and breaking quietly every time GitHub adds a field.

### VI. Idempotence is a property, not a hope

Every entry point — first load, Turbo navigation, a mutation observer, the
built-in Type/Language filters — funnels into one function that can be called at
any moment, any number of times, concurrently, and leaves the page in the same
state as calling it once.

This is not fastidiousness. The prototype's worst bug was a second pass
regrouping its *own* output and nesting the entire page inside one of its own
sections, because a `<ul>` SHELVES creates still matches the selector that finds
GitHub's. Two guards, belt and braces: skip any list inside our host element, and
mark every list we create with an attribute the finder refuses.

### VII. Same-origin work in the page, cross-origin work in the worker

A hard line, drawn once, for reasons that are structural rather than stylistic:

- The **content script** can fetch `github.com` paths with the user's session
  cookie for free, and is the only place that can read a private repo's page.
- The **service worker** holds `host_permissions`, so it can call
  `api.github.com` with an `Authorization` header without meeting CORS preflight
  or the page's CSP.

Each half is trivially correct on its own side of the line and mysteriously
broken on the other. The line is worth more than the file it saves.

### VIII. Pay a cost once and remember it

Reading topics off 76 individual repo pages is 76 requests. Done on every page
load that is abusive — to GitHub and to the user. Done once and cached for a
week, it is a fifteen-second first run and instant thereafter.

Any expensive path must be cached, must show progress while it runs, and must
have a visible control that clears the cache — because the user is the only one
who knows they just re-tagged something.

### IX. No build step

Plain JavaScript, plain CSS, plain HTML. The folder that is in the repository is
the folder Chrome loads. No bundler, no transpiler, no `node_modules` shipped, no
generated artefact that can drift from its source.

The one dependency in the project (`jsdom`) exists solely so the test harness can
run, and never enters the extension.

### X. Comment the scars

Seven facts in this design were established by measurement and each cost a bug
(§ *What was measured*). Every one is commented **in the code, at the line it
constrains, with the reason** — because they are all locally-surprising, and a
future reader with good instincts will otherwise simplify them straight back into
the bug they came from.

### XI. Pay for a page once, and keep what it said

A repo's own page is the expensive thing SHELVES does — one request each,
seventy-six of them on a cold run. That document carries the description, the
language, the stars, the licence, the homepage, the README's opening line and
when it was last touched. Reading four topic chips out of it and discarding the
rest is not thrift; it is paying full price for a tenth of the goods, and it is
why the extension could not answer *"which repo was the one about rate
limiting?"* despite having read the answer aloud seventy-six times.

So: **one parse, every fact, one file.** Every selector for the repo page lives
in `facts.js` and nowhere else, each extractor with its own fallback chain, each
free to return nothing. A field that cannot be read costs that field — never the
row, never the render.

The other half of the principle is the harder one. Only `topics` and
`description` are *measured*; the rest are best-effort until someone drives them
against a real logged-in repo page. They therefore prefer `<meta>` tags and href
**shapes** over class names, because class names are the half that churns — and
a wrong selector here must always be an absent field, never a wrong one.

---

## What was measured

Ground truth, established by running a prototype against the real logged-in page
and against a jsdom harness. None of these are assumptions.

1. **The profile Repositories page renders no topic chips at all.** No
   `a.topic-tag` anywhere in the list. Topics must be *fetched*; the page cannot
   be scraped for them. This single fact determines the entire architecture.
2. **The unauthenticated API sees public repositories only.** For a user whose
   grouping topics live on private repos, it answers nothing useful. The
   prototype's first release grouped 1 of 76 repositories for exactly this
   reason.
3. **The tab paginates at 30.** Grouping what is on screen yields groups that are
   silently, invisibly incomplete — the worst kind of wrong.
4. **A `<ul>` we create still matches `#user-repositories-list ul`.** See
   principle VI.
5. **GitHub lowercases topics.** `AiProject` is stored as `aiproject`. Match
   case-insensitively; display the label as the user typed it.
6. **GitHub's own filters replace the list.** Any grouping must survive being
   torn out and re-run.
7. **A repo's own page does carry its topics**, in the sidebar, behind the
   session cookie — the only route to a private repo's topics without a
   credential.

And one lesson about method rather than about GitHub: **when a test fails, check
the harness before the code.** Two of the prototype's "failures" were a faulty
regex in the test stub — `/page=(\d+)/` cheerfully matching `per_page=100` — and
not defects in what was under test.

### XII. An identity may be derived, and then it costs nothing to keep

A shelf's colour and glyph are a hash of the shelf's own **name**. Nothing is
stored, nothing syncs, nothing migrates, and nothing can be lost — the same
shelf is the same colour on every machine, on every load, forever, because the
name is the only input. Principle I says the extension's state must be
derived, disposable and reconstructible; this is the one place where obeying it
made the feature *better* rather than merely cheaper, and it is worth stating
so the next person does not reach for a settings key.

Two things it costs, both accepted deliberately:

- **The owner cannot choose a shelf's colour.** A picker would need a store,
  and a store needs a migration, a default, and an answer for a renamed shelf.
  A name that produces its own colour has none of those, and nobody has ever
  needed a *particular* colour — only a consistent one.
- **A renamed shelf is a new colour.** That is the honest failure: the name IS
  the identity, so changing it changes the mark. It is also the rare case, and
  it fails visibly rather than silently.

Twelve slots, and collisions resolve by walking to the next free one **in
alphabetical order** — never in the order the shelves are drawn, because
auto-grouping sorts shelves by size and a colour that repainted whenever a repo
moved would be worse than no colour at all.

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │  github.com/<user>?tab=repositories       │
                    └──────────────────────────────────────────┘
                                      │
   ── content scripts, isolated world, one namespace `Shelves` ──────────────
                                      │
   store.js ── settings (sync) · token (local) · fact cache · notes ·
      │        collapse state       (notes are NOT cache — see principle I)
      │
   dom.js ──── isRepoTab · findList · harvest <li> · merge pages 2..N
      │                                   (same-origin, cookies free)
      │
   facts.js ── ONE PARSE of a repo page: topics · description · language ·
      │        stars · forks · licence · homepage · README · updated
      │
   topics.js ─ THE LADDER: page chips → API → repo pages
      │              │                    │
      │              │                    └── same-origin fetch + cache + pool
      │              │
      │              └── chrome.runtime.sendMessage ──┐
      │                                               │
   vocab.js ── the topics as a SYSTEM: families · typos · blanket labels ·
      │         the ones used once — pure analysis   │ over what the ladder
      │         already resolved, plus its own panel  │
      │                                               │
   view.js ─── bucket · order · build <details> · toolbar · the filter ·
      │        one row's private margin · a hue and a │
      │        glyph per shelf · themed off GitHub's  │
      │        own CSS variables                      │
      │                                               │
   main.js ── lifecycle: load, turbo:*, MutationObserver, storage changes
                                                      │
   ───────────────────────────────────────────────────┼──────────────────────
                                                      ▼
                    ┌──────────────────────────────────────────┐
                    │  background.js — service worker          │
                    │  the ONLY caller of api.github.com       │
                    │  paginates, attaches the token, returns  │
                    │  [{full_name, topics, private}]          │
                    └──────────────────────────────────────────┘

                    ┌──────────────────────────────────────────┐
                    │  options.html / options.js               │
                    │  ordered group editor · token · TTL ·    │
                    │  clear cache — opens as page or popup    │
                    └──────────────────────────────────────────┘
```

Seven content scripts rather than one file, sharing `globalThis.Shelves`. They
load in declared order and each does one job, which is what lets the harness
drive `topics.js` against a stub without a browser anywhere in sight.

### The ladder

Resolving *which topics does each of these N repositories have* is the core of
the extension. Walk it in order; stop when every repo is answered.

| # | Rung | Cost | Sees private? |
|---|------|------|---------------|
| 1 | Topic chips already in the page | free | — (renders none today, per measurement 1) |
| 2 | `api.github.com/user/repos` **with token** | 1–2 requests | **yes** |
| 3 | `api.github.com/users/<u>/repos` no token | 1–2 requests | no |
| 4 | Each remaining repo's own page, session cookie | 1 request per repo | **yes** |

Rung 1 stays first though it yields nothing today: it costs zero requests, and
the day GitHub restores chips it becomes the whole answer for free.

Rung 4 is the one that makes the extension work with **no configuration at all** —
the default experience is correct, and the token is an optimisation the user may
decline forever.

A repo the ladder cannot answer is not an error. It is Ungrouped.

---

## Boundaries

Deliberately outside the scope of this project:

- **Grouping anything but topics.** Not language, not stars, not last-pushed.
  Those are already filters GitHub ships; a second axis would make the mental
  model two things instead of one.
- **A repo appearing in two shelves.** First match wins, always. Duplicates
  destroy the count and the ability to scan a list once.
- **Editing topics from the extension.** That is a write, and principle I says
  no. The two-click path on GitHub already exists.
- **Firefox, for now.** MV3 service workers differ enough to be a port rather
  than a flag. The line in principle VII is the only place that would need to
  move.
