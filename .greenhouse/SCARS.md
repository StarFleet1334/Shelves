# SCARS

One line per thing that broke here and what got past it.
Every tending is handed the tail of this file before it starts, so
the same wall is not walked into twice.

- `node tests/harness.js 9` printed "all 0 scenarios passed" and exited 0 -> a number that names no scenario now FAILS, or a roadmap proof would tick itself before the test existed
- rung 1 returns for EVERY repo the moment ONE row carries chips -> the ladder must treat page chips as a floor and keep climbing for the rest (measured: 4 repos, 1 chipped, 3 shelved as Ungrouped with zero requests)
- a repo page that 429s or 404s is swallowed and the repo lands in Ungrouped with no warning, while the toolbar still says `via api (public)` -> count the unread and say so (P.IV)
- a 401 on `/user/repos` never retries the unauthenticated endpoint, yet the source line already says `api (public)` -> either fall back for real or stop claiming it
- topics scraped from a repo page must be scoped to `.Layout-sidebar`, or a README full of /topics/ links lies about the repo's tags
