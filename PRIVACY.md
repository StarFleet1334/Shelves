# Privacy

SHELVES has no server. There is nothing to sign in to, no account, no
analytics, no telemetry, no crash reporting and no third party of any kind. It
is a page rearranger that runs in your browser.

**No data leaves your browser except to GitHub itself**, at the two addresses
the extension declares in its manifest and nowhere else:

- `https://github.com` — the pages you are already looking at, requested with
  the session you are already signed in with. These are the same requests your
  browser would make if you clicked the same links.
- `https://api.github.com` — only if you choose to add a token, and only to
  ask for the list of repositories you already see on your own profile.

There is no other host in the source. You can check that claim rather than
take it: `node tests/redteam.js` fails if any shipped file names one.

## What is stored, and where

Everything is stored locally, in this browser's own extension storage. Nothing
is encrypted, because a browser profile is a place your operating system is
already protecting; if other people use your computer account, weigh that.

In `chrome.storage.local` — **this machine only, never synced**:

- **a fact cache** — for each of your repositories: name, description,
  language, star and fork counts, licence, homepage, last-pushed time, and the
  first 400 characters of the README. This includes **private** repositories,
  because those are the ones the extension has to read a page for. It is
  derived, it expires, and *Clear topic cache* in the options page removes it.
- **your notes** — anything you typed into a repository's margin.
- **your overrides** — the repositories you put on a shelf by hand.
- **your pins** — the repositories you pinned to the top of a shelf.
- **a shelf map** — which shelf each repository landed on, so the mark on a
  repository's own page agrees with the profile page.
- **your token, if you added one.** Deliberately in local storage rather than
  synced storage, so it never travels to your other machines.

In `chrome.storage.sync` — this follows your browser profile between machines,
because it is configuration rather than data:

- your shelf names and rules, the name of the leftovers shelf, whether shelves
  start collapsed, the cache lifetime, and whether background warming is on.

In `localStorage` on `github.com`, because they are about reading rather than
about you: which shelves you left open, whether you chose compact rows, where
you had reached in the untagged walk, and when you last visited your own
Repositories tab.

## What is never stored

Your GitHub password. Any credential other than a token you paste yourself.
Anything from a page belonging to someone else — on a profile that is not
yours, the extension does not scrape, does not cache and does not write.

## The token

Optional. The extension asks you to create a **fine-grained** token with
`Metadata: Read-only` and nothing else, which is the weakest credential GitHub
can issue: it cannot read a line of your code and cannot write anything at all.
It is sent as an `Authorization` header to `api.github.com` and to no other
address. It is never written to a log, never included in an export, and never
placed in synced storage.

## Exporting

The options page can write your notes, overrides and pins to a JSON file so you
can move them to another machine. **That file contains the names of your
private repositories.** It does not contain your token. Where the file goes
afterwards is yours to decide.

## Deleting everything

Uninstall the extension. Chrome removes its storage with it, and GitHub is
exactly as it was — the extension never wrote anything to your account, so
there is nothing on GitHub's side to undo. *Clear topic cache* in the options
page removes the derived half at any time without touching what you wrote.

## Contact

Open an issue on the repository.
