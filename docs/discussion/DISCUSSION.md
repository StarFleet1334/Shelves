<!--
  HOW TO POST THIS
  ----------------
  1. New discussion -> category "Ideas" (or "Show and tell" if you're announcing
     rather than proposing).
  2. Paste the TITLE below into the title field.
  3. Paste everything under the ==== BODY ==== line into the body.
  4. Where you see a line like  [[IMAGE: 01-the-whole-map.png]]  , delete that
     line and drag the matching file from docs/media/ into the composer at
     that spot. GitHub uploads it and leaves a ![...](https://github.com/user-attachments/...)
     link behind. Do the GIF the same way (00-demo.gif, 3.8 MB, under the 10 MB cap).
  5. Delete this comment block.

  TITLE
  -----
  SHELVES — folders for the Repositories tab, built from the topics you already have
-->

==== BODY ====

## The problem is one column

`github.com/<you>?tab=repositories` is a flat list. Three filters, a search box that
matches names, and — on my account — **78 repositories in a single column**. There is no
folder, no group, no section. Nothing on that page can say *these five are the AI project
and those two are browser extensions*.

[[IMAGE: 08-flat-list-before.jpg]]

The label system already exists. **Topics** — repo → About → ⚙ → Topics — are free-form,
unlimited, editable in two clicks, and already attached to the right object. GitHub simply
never renders a view that groups by them.

**SHELVES is that view.**

---

## 78 repositories, six rows

[[IMAGE: 01-the-whole-map.png]]

Same page, same rows, same GitHub markup — re-drawn as named, counted, collapsible
shelves. Every shelf carries a hue and a glyph so you find one by recognising it rather
than by reading it. Open one and your repos are underneath, exactly as GitHub rendered
them.

[[IMAGE: 02-shelves-open.png]]

Here it is end to end — flat list → shelved → search → audit:

[[IMAGE: 00-demo.gif]]

---

## Then it does five things the page cannot

### 1. `/` finds a repo you cannot name

GitHub's own box matches **names**. Nothing else. So *"the one about rate limiting"* is
unfindable there, and findable here: `/` searches the repo's description, topics,
language, licence, the first line of its README, and your own private note.

Shelves show `hits / total` while you type, and an empty shelf **dims rather than
disappearing** — the shelves are the map, and a map that reshuffles while you search it is
harder to read.

[[IMAGE: 03-find.png]]

### 2. `audit` reads your labelling back to you

GitHub will show you one repo's topics, and every repo carrying one topic. Nothing
anywhere shows you your vocabulary **as a system** — which is exactly why it rots. Every
individual decision looked fine.

[[IMAGE: 04-audit.png]]

Two questions in one panel. What's wrong with the **topics**: which are two spellings of
one idea, which is a whole word inside another, which sit on almost everything and
therefore group nothing, which are used once and will make a shelf of one. And what's
missing from the **repositories**: no description, no README, no licence, archived-but-still-shelved.
Each finding has a `SHOW` button that filters the page to exactly those repos — *"the 64
with no description"* is not a substring anyone could type.

**The denominators are the honest part.** It reads `64 of 69`, not `64 of 78`, because
nine of those repos were answered by a source that carries no description field at all —
and asking them would be reporting the API's shape as your failing. Whatever could not be
asked is printed underneath rather than quietly narrowing the number.

### 3. Move a repo by hand — and pin the ones that matter

Some repos will never carry a topic. Some carry one that says the wrong thing. Hover a row,
grab the `⠿`, and drag it onto a shelf — or press it for a menu, which is the version that
works from a keyboard on a 78-row page.

[[IMAGE: 05-move-and-pin.png]]

An override outranks every topic, and it is the only thing here that can shelve a repo with
no topics at all. The first entry in that menu is `⚑ pin to top`, because the top of a shelf
is part of where a repo goes. Pins are a **stable partition, not a sort** — the order inside a
shelf stays GitHub's, and the only claim being made is *these few first*.

Moving a repo writes one key and re-homes one row. No reload, so you keep your scroll, your
open shelves and the search you were in the middle of.

### 4. A private margin

Every row gets a note. *"the one with the broken deploy"*. *"client wants this back in March."*
It lives in your browser, it is searchable by `/`, and it is the one thing here that
**nothing can rebuild** — so `rescan` and `clear cache` both leave notes strictly alone.

[[IMAGE: 06-private-margin.png]]

### 5. The shelf follows the repo

Open any of your repositories and the shelf is there at the top of the About sidebar — its
glyph, its name in its colour, its size, a link back — with your note, editable right where
you are when you remember something.

[[IMAGE: 07-repo-page-mark.png]]

It sits beside the topics on purpose: the shelf is the *consequence* of the topics, and
putting an answer next to its own input needs no explaining. **It fetches nothing.** Every
input is already on the page or in local storage.

---

## A shelf can be a question

A shelf's name is normally a topic, matched literally. That cannot express the shelf people
describe out loud — *the Python ones I still work on*, *everything I forked and never
touched* — because those are three fields and a date. So put an `=` in a shelf entry and the
left half is the name, the right half is the membership:

```
Live Python = topic:ai lang:python fork:false pushed:<90d
Java        = lang:java fork:false
Old Guard   = pushed:>2y
config
```

Thirteen fields (`topic:` `lang:` `license:` `name:` `desc:` `readme:` `homepage:` `fork:`
`archived:` `private:` `stars:` `forks:` `pushed:`), all AND-ed, `-` to negate. Parsed once
per page against records already read — no request, no index, and **no second axis**: an
entry with no `=` is still the plain topic shelf, both kinds live in one list in one order,
and a repo still lands on the first shelf that takes it.

Three rules it keeps, each of which is a way it could have lied instead:

- **A term nobody can judge excludes the repo, and the header says how many.** `fork:false`
  against a record that never carried a `fork` field is not false — it is *unknown*, and
  answering unknown as false is how a shelf quietly fills with the wrong repos. Those land
  on the leftovers shelf and the header says `N unjudged`.
- **A term nobody can parse is named, never dropped.** `Oops = lang:python topc:ai pushed:90`
  prints `unreadable in Oops: topc:ai pushed:90` and the rest of the rule still applies.
- **First match still wins.** What the second shelf would have said comes back as a chip on
  the row.

---

## It has an answer for day one

An account that has never used topics gets back the page it already had — one shelf called
Ungrouped holding everything. Grouping by topic is *correct and useless* there. Three things
close that, and **not one of them writes to GitHub**:

- **Suggested shelves.** A strip offering what the collection already says about itself, as
  `add <label> (N)` — a topic several repos share, a shared leading word in the names
  (`wiremock-api`, `wiremock-data`, `wiremock-demo` → `wiremock`), or a language. On my
  account, cold: `add Java (21) · add Go (10) · add gym (4) · add Python (3)`.
- **The workbench.** The leftovers shelf reads `68 untagged · tag them`. Press it and the
  next untagged repo opens in its own tab, where the two-click edit actually fixes it for
  good. The label then becomes `tag them · 2 of 68` — your place in the queue is remembered
  per profile, so this is a chore you can leave and come back to. One tab per press, never a
  fan of thirty.
- **By hand.** The grip, above.

Two things it will *not* suggest: anything covering more than half the collection (a shelf
holding half your repos is the flat list wearing a hat), and any repo that already has a
shelf.

---

## The promise, stated as a boundary

This is the part I'd most like challenged in the comments.

- **It never writes to your GitHub account.** Not a topic, not a description, not a star.
  Editing topics from the extension is a write, and the answer that stays read-only is the
  override — the opinion lives in your browser, keyed `owner/name`, and uninstalling undoes
  all of it.
- **It talks to exactly two hosts** — `github.com` and `api.github.com`. There is no other
  network call of any kind in the codebase, and no server anywhere.
- **It does keep things locally, and here is the whole of it:** per repo (private ones
  included, unencrypted, in this browser profile) — name, description, language, stars,
  forks, licence, homepage, last-touched, the README's first 400 characters; plus your
  notes, your overrides, your pins, and the shelf map. `chrome.storage.local` does not sync.
  Uninstalling deletes it. **Anyone who can read this browser profile can read all of it** —
  MV3 offers no encrypted store, so that is inherent rather than chosen, and it needs saying
  out loud before you install it on a shared machine.
- **The token is optional and should be the weakest one GitHub can mint.** Fine-grained,
  *Metadata: Read-only*, every other permission `No access`. It cannot read a line of your
  code and cannot write anything at all. **Do not paste a classic token** — its finest grain
  is `repo`, which can write to everything you own, and storing that in a browser profile to
  save one request per repository is a terrible trade.

---

## How it gets the topics

Four rungs, climbed from free to expensive, stopping the moment every repo is answered:

| rung | source | cost | sees private |
|---|---|---|---|
| 1 | topic chips already in the page | free | — |
| 2 | `api.github.com` with your token | 1 request / 100 repos | yes |
| 3 | `api.github.com` without one | 1 request / 100 repos | no |
| 4 | each remaining repo's own page | 1 request each | yes |

Rung 1 is a **floor, not an answer** — GitHub renders chips on some rows and not others, so
what is free is kept and every repo it did not name still climbs. The toolbar names the rungs
that actually contributed (`via page + api (public) + repo pages (cached)`), never just the
first one.

And you don't wait it out looking at the flat list. The page is shelved in the **first frame**
from the chips plus whatever the cache holds — measured at **341 ms**, against 1 178 ms on a
cold cache — then re-buckets itself when the ladder answers, keeping your filter, your open
shelves and your keyboard focus.

---

## Where it stands

- **~5,700 lines, no build step, no dependencies.** The folder in the repo is the folder the
  browser loads. `jsdom` is a dev dependency of the test harness and is never shipped.
- **39 scenarios** driving the real content scripts and the real service worker against a
  jsdom GitHub, plus **533 adversarial probes** across six red-team plugins.
- Layout, hit-testing and contrast were measured in a **real browser**, not eyeballed — which
  is how we learned `●` and `□` are tofu in GitHub's own font stack on Windows, and that a
  single lightness across twelve hues put four of them below 3:1 on the light theme. Every
  hue now solves for its own lightness and clears 4.3:1 against **both** `#ffffff` and
  `#0d1117`, with no theme detection anywhere.
- **Chrome and Edge.** `dist/shelves-1.0.0.zip` is built and store-fit.

### Known limits, up front

- A repo appears on **exactly one shelf**. First match wins; an override wins before that.
  The shelves it also matched are drawn as chips and counted nowhere.
- A rule can only ask what the answering rung carries. A repo read from its own page has no
  language and no push date — GitHub renders both on the client — so `lang:` and `pushed:`
  report those repos as `unjudged` rather than excluding them quietly.
- Eight of the ten harvested fields are best-effort. `topics` and `description` were measured
  against the real page; the rest prefer `<meta>` tags and href shapes over class names,
  which is a hedge, not a proof. Treat a blank star count as *not verified yet*.
- Above ~600 repos the API path stops paginating. Rung 4 reads at most 100 repos per pass and
  offers a `read N more` button rather than pretending.
- Firefox is a port, not a flag.

---

## What's next

- Drive `facts.js` against a **real logged-in repo page** and demote anything that does not
  actually read. This is the one that turns the hedge above into a measurement.
- The same lens on **`?tab=stars`** — starred repos are the list that most needs shelving and
  the one nobody can tag.
- **Org repositories**, driven against a real org page rather than claimed.
- **Export / import** the shelf layout as JSON, so a team can share one set of shelves.
- The options page **exposing what the store already carries** — concurrency, page depth, the
  scrape ceiling — instead of defaults nobody can reach.
- **Firefox**, as one port of the content-script/worker split.

---

## Questions I actually want answers to

1. **Is one axis the right call?** Language, stars and last-pushed are filters GitHub already
   ships, and a permanent second grouping makes the mental model two things instead of one.
   Rule shelves are the compromise: you can write `Java = lang:java fork:false`, but you have
   to supply the name. Does that hold up, or does it just move the problem?
2. **Is a week the right cache TTL?** It was picked by feel and has never been measured
   against how often anyone actually re-tags.
3. **Should an override survive a repo being renamed?** Overrides are keyed `owner/name`, so
   today a rename silently loses one.
4. **Should the background top-up be allowed to *discover*?** It currently only refreshes what
   it has already seen, so a repo created since your last visit is still a cold read. Closing
   that means fetching pages nobody asked for.
5. **Is "unjudged" understandable on a shelf header,** or does it read as a bug the first time
   you see it?

---

## Try it

No build step.

```
git clone <this repo>
```

1. `chrome://extensions` (or `edge://extensions`) → **Developer mode** on
2. **Load unpacked** → choose the `extension/` folder — *not* the project root
3. Open `https://github.com/<you>?tab=repositories` and reload

The first load asks the API once, and one request answers every public repository you own.
Only your private repos are read a page at a time, behind a progress line. Every load after
that is instant.

Then tag something and press `audit`.
