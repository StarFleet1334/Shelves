# Publishing

Everything here is either done, or is a thing only you can do because it needs
your identity or your money. The parts that are done are checkable:

```
python tools/package.py --check     # refuses to build an unfit package
python tools/package.py             # -> dist/shelves-1.0.0.zip
cd tests && node harness.js         # 39 scenarios
cd tests && node redteam.js         # 533 adversarial probes
```

`package.py` zips **`extension/` and nothing else**. The harness, the red team,
the fixtures, the roadmap and the scars are how this was built and are not part
of it — a packaging step that zips the repository is how a scratch file ends up
in a public listing.

---

## Before you upload

**Look at the screenshots.** `store/screenshots/` was generated against your own
GitHub profile, so **your avatar, your display name and your username are in
all five of them**, as are the names of 54 of your repositories. A store listing
is public and permanent in a way a repository is not. If that is not what you
want, regenerate them against a throwaway account or an org, or crop the left
column out. This is the only step in this file that is hard to undo.

**Decide the account.** A listing belongs to whoever registers it. A one-time
$5 fee registers a Chrome Web Store developer account, and it cannot be moved
between accounts afterwards without re-publishing under a new listing and
losing the users. If this might become an org's extension, register it as the
org now.

**Pick the version and leave it alone.** `1.0.0` is what the manifest says. The
store will not accept the same version twice, and it will not accept a version
that sorts lower than one you have published, so a mistake here costs you a
number rather than being fixable.

---

## The listing

**Name** (75 max) — `Shelves — group GitHub repos by topic`, 37 characters.

**Summary** (132 max) — the manifest description, 121 characters:

> Groups your GitHub Repositories tab into collapsible shelves by topic.
> Read-only: it never writes to your GitHub account.

**Category** — *Developer Tools*.

**Description.** Lead with the problem rather than the feature list: a
Repositories tab is a flat list sorted by date, and past about forty repos it
stops being readable. Then what it does, then the two claims worth making
plainly, because they are the two a reader will be suspicious of:

- it never writes to your GitHub account — no server, no account, no telemetry
- it costs nothing to try: no sign-in, and the token is optional

**Screenshots** — 1280×800 PNG, up to five. Generated in
`store/screenshots/`, in the order a reader should meet them: the cold start,
the shelves, compact rows, the filter, the audit.

---

## The privacy tab

This is where extensions stall, and every answer below is already true — none
of it needs new work, only stating.

**Single purpose** (one sentence, and the reviewer holds you to it):

> Rearranges the signed-in user's own GitHub "Repositories" tab into
> collapsible groups by repository topic.

**Permission justifications**, one per permission, in the reviewer's words:

| permission | why |
|---|---|
| `storage` | Remembers the user's shelf configuration, their private notes, which repositories they placed on a shelf by hand, and a cache of repository facts so the same page is not re-read on every visit. All of it stays in the browser. |
| `https://github.com/*` | The extension's entire function is to rearrange a page on github.com. It reads the repository rows already on the user's Repositories tab, and reads a repository's own page to find its topics when the API cannot see it (private repositories). It also places a small marker on a repository's own page showing which shelf it belongs to. |
| `https://api.github.com/*` | Optional. If the user supplies a fine-grained token with `Metadata: Read-only`, one API call replaces reading each repository page individually. Used for nothing else. |

**Remote code** — *No*. Everything executes from the package; there is no
`eval`, no `new Function`, no remotely hosted script, and no
`web_accessible_resources`. `tests/redteam.js` fails if any of that appears.

**Data usage.** Tick *Personally identifiable information* — the extension
stores repository names, including private ones, which are tied to an
identifiable account. Then certify all three, which are true:

- not sold to third parties
- not used or transferred for any purpose unrelated to the item's single purpose
- not used or transferred to determine creditworthiness or for lending

**Privacy policy URL** — required once you tick anything above. `PRIVACY.md` is
written for this; publish it at a stable URL (the repository's own
`PRIVACY.md` on GitHub is acceptable) and paste that link.

---

## What a reviewer will actually look at

The broad host permission on `github.com/*`. It is justified above and it is
genuinely the whole product, but expect it to be the thing that adds days. Two
details help: the manifest carries eight `exclude_matches` keeping the
extension off `/settings/*`, `/login*`, `/sessions/*` and the rest, and the
description says *read-only* in its first two lines.

First review of a new listing commonly takes a few days and can take longer;
updates to an existing one are usually faster. A rejection names a policy
section — fix and resubmit rather than appealing, unless it is plainly wrong.

---

## After it is live

`package.py` produces a deterministic zip — same tree, same bytes — so you can
diff a release against the last one you submitted and know exactly what
changed.

To ship an update: bump `version` in `extension/manifest.json`, run the two
test suites and `package.py`, upload the new zip. Users get it automatically
within a few hours.

**Microsoft Edge Add-ons takes the same package** with no changes: MV3, same
manifest, a separate (free) developer account and a much shorter queue. Firefox
does **not** — it wants `browser_specific_settings` and its own review, and the
`chrome.*` calls would need a shim. Worth doing only if someone asks.
