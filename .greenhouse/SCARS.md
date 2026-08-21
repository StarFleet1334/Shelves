# SCARS

One line per thing that broke here and what got past it.
Every tending is handed the tail of this file before it starts, so
the same wall is not walked into twice.

- `node tests/harness.js 9` printed "all 0 scenarios passed" and exited 0 -> a number that names no scenario now FAILS, or a roadmap proof would tick itself before the test existed
- rung 1 returns for EVERY repo the moment ONE row carries chips -> the ladder must treat page chips as a floor and keep climbing for the rest (measured: 4 repos, 1 chipped, 3 shelved as Ungrouped with zero requests)
- a repo page that 429s or 404s is swallowed and the repo lands in Ungrouped with no warning, while the toolbar still says `via api (public)` -> count the unread and say so (P.IV)
- a 401 on `/user/repos` never retries the unauthenticated endpoint, yet the source line already says `api (public)` -> either fall back for real or stop claiming it
- topics scraped from a repo page must be scoped to `.Layout-sidebar`, or a README full of /topics/ links lies about the repo's tags
- a row's own textContent is read AFTER the note margin is appended -> every row matched the query "note" and a saved note counted twice; capture `li.dataset.shText` once, before anything is added to the row
- the filter forces shelves open to show hits, and the `toggle` listener wrote that to the collapse store -> a cleared search left every closed shelf hanging open; park the real state in `data-sh-was-open` and stand the listener down while `data-filtering` is set
- GitHub's <meta name="description"> is "<about>. Contribute to o/n development…" and there is no way to tell its joining period from one the owner typed -> strip it with the boilerplate; a stray "." on every description is the more visible wrong
- a proof that names a harness scenario by NUMBER ticks itself the moment a scenario is inserted above it (appending facts/find/note made `harness.js 8` mean the facts scenario, which passes) -> proofs name scenarios by keyword, and a selector matching nothing fails
- `.sh-margin { flex: 0 0 100% }` appended to GitHub's repo row: `d-flex` DOES NOT WRAP, so a 100% basis with flex-shrink 0 does not drop to its own line — it takes the width and refuses to give it back, collapsing the description from 599px/2 lines to 94px/13, breaking words mid-word -> put the note INSIDE the row's text column (the li child holding the h3), and give any li-level fallback `flex: 1 1 100%; min-width: 0`. jsdom cannot see this; tests/row-layout.html + aether/look.py can
