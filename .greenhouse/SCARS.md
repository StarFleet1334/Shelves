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
- a shelf glyph the font stack lacks renders as the MISSING-GLYPH BOX, which at 10px looks enough like a hollow square marker to survive being looked at: `□` (U+25A1) and `●` (U+25CF) are both tofu in GitHub's own stack on Windows, and `●` was slot 0 -> measure every candidate against the width of U+FFFF (guaranteed to have no glyph anywhere); equal width IS the box. tests/glyph-probe.html
- a fixture that draws only the shelves this month happens to have draws only some of the palette: the first identity shot rendered 9 of 12 slots and the tofu was sitting in one of the 3 it never reached -> the fixture names twelve labels, which the collision walk guarantees exhausts every slot
- ONE lightness cannot serve two themes: at hsl(H, 62%, 52%) blue measured 3.3:1 on #0d1117 while yellow measured 2.2:1 on #ffffff, because luminance is not a function of hue -> solve each hue for its own lightness at a common relative luminance (0.19), which clears 4.3:1 on both. This extension has no theme detection on purpose, so the colour has to work on both backgrounds rather than pick one
- reporting a topic family's reach as the SUM of its spellings inflates it: `ai-project` (2) + `aiproject` (1) is three repos, not four, when one repo wears both -> count the union of repo indices, or a labelling problem reads as a bigger collection
