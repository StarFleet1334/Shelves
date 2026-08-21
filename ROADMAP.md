# SHELVES — roadmap

Ordered by how much each would change the daily experience, not by effort.

## Next

- **A shelf per repo, not per topic-priority.** Today a repo tagged both
  `aiproject` and `learning` lands on whichever shelf is ordered first. That is
  the right default, but an explicit "pin this repo to this shelf" override
  would cover the handful of repos where the ordering is wrong.
- **Drag to reorder shelves** in the options page. The ↑/↓ buttons work and are
  keyboard-reachable; dragging is what people reach for.
- **Shelf from a search, not only a topic.** `archived:false language:python`
  as a shelf definition would cover the repos the user never tagged.

## Later

- **Org repositories.** `#org-repositories` is already in the selector list and
  will probably work; it has not been driven against a real org page, so it is
  not claimed.
- **Firefox.** One port of the content-script/worker split (principle VII).
- **A count badge on the toolbar icon** — how many repos are still untagged, as
  a nudge rather than a notification.

## Deliberately not doing

- Editing topics from the extension. That is a write; principle I says no.
- Grouping by language or stars. Those are filters GitHub already ships, and a
  second axis makes the mental model two things instead of one.
- Syncing shelves to a server. Everything stays in the browser.

## Open questions

- Is a week the right cache TTL? It is configurable, but the default was picked
  by feel and has not been measured against how often anyone re-tags.
- The scrape path costs one request per untagged repo on first run. At 76 repos
  that is fine. At 400 it may need a ceiling and a "continue" control.
