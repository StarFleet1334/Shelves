"""Build the .zip the Chrome Web Store wants, and refuse to build a bad one.

    python tools/package.py            # -> dist/shelves-1.0.0.zip
    python tools/package.py --check    # audit only, write nothing

THE ONLY THING THAT SHIPS IS `extension/`. Everything else in this repository —
the harness, the red team, the fixtures, the roadmap, the scars — is how the
thing is built and not part of it. A packaging step that zips the repository is
how a test fixture, a scratch file or a stray credential ends up in a public
listing, so this walks the one directory and names every file it adds.

It FAILS rather than warns. A zip is submitted once and reviewed for days; an
audit that prints a warning nobody reads is worth nothing at that distance.
"""

import argparse
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "extension")
DIST = os.path.join(ROOT, "dist")

# Store limits, from the developer documentation. Named here so a failure says
# which rule it broke rather than "too long".
MAX_NAME = 75
MAX_DESC = 132
NEEDED_ICONS = ("16", "32", "48", "128")

# Anything matching these has no business in a published package.
JUNK = (".map", ".log", ".bak", ".orig", ".rej", ".swp", ".DS_Store", "Thumbs.db")
JUNK_DIRS = (".git", "node_modules", "__pycache__", ".vscode", ".idea")


def audit():
    """@returns list of problems; empty means it is fit to submit."""
    bad = []
    mf = os.path.join(SRC, "manifest.json")
    if not os.path.exists(mf):
        return ["no manifest.json in extension/"]
    with open(mf, encoding="utf-8") as fh:
        m = json.load(fh)

    if m.get("manifest_version") != 3:
        bad.append("manifest_version must be 3; got %r" % m.get("manifest_version"))
    name = m.get("name", "")
    desc = m.get("description", "")
    if not name or len(name) > MAX_NAME:
        bad.append("name is %d chars (1-%d)" % (len(name), MAX_NAME))
    if not desc or len(desc) > MAX_DESC:
        bad.append("description is %d chars (1-%d)" % (len(desc), MAX_DESC))
    ver = str(m.get("version", ""))
    parts = ver.split(".")
    if not ver or len(parts) > 4 or not all(p.isdigit() and len(p) <= 5 for p in parts):
        bad.append("version %r must be 1-4 dot-separated integers" % ver)

    icons = m.get("icons") or {}
    for size in NEEDED_ICONS:
        rel = icons.get(size)
        if not rel:
            bad.append("no %spx icon declared" % size)
            continue
        if not os.path.exists(os.path.join(SRC, rel)):
            bad.append("icon %s missing on disk: %s" % (size, rel))

    # Every file the manifest names must exist, or the upload is rejected on
    # a technicality after the review queue has already eaten a week.
    named = []
    for cs in m.get("content_scripts") or []:
        named += cs.get("js", []) + cs.get("css", [])
    if m.get("background", {}).get("service_worker"):
        named.append(m["background"]["service_worker"])
    if m.get("options_page"):
        named.append(m["options_page"])
    act = (m.get("action") or {}).get("default_popup")
    if act:
        named.append(act)
    for rel in named:
        if not os.path.exists(os.path.join(SRC, rel)):
            bad.append("manifest names a file that is not there: %s" % rel)

    # Permission creep is the commonest reason a review stalls, and the
    # commonest reason a user says no.
    perms = m.get("permissions") or []
    hosts = m.get("host_permissions") or []
    for p in perms:
        if p not in ("storage",):
            bad.append("undeclared-in-review permission: %r "
                       "(justify it in PUBLISHING.md first)" % p)
    for h in hosts:
        if h not in ("https://github.com/*", "https://api.github.com/*"):
            bad.append("host permission beyond GitHub: %r" % h)
    if m.get("web_accessible_resources"):
        bad.append("web_accessible_resources exposes files to any page")
    if m.get("externally_connectable"):
        bad.append("externally_connectable lets a page talk to the extension")

    for f in walk():
        rel = os.path.relpath(f, SRC)
        if any(rel.endswith(j) for j in JUNK):
            bad.append("junk file would ship: %s" % rel)
        with open(f, "rb") as fh:
            body = fh.read()
        if rel.endswith((".js", ".html", ".css", ".json")):
            # A control byte in a TEXT file is the scar this repo carries
            # twice: `\b` is a valid escape in a patch script and becomes a
            # backspace, which parses, runs, and silently means something
            # else. A PNG is full of NULs by design, so this is scoped to
            # what is actually text.
            ctrl = [c for c in body if c < 9 or (13 < c < 32)]
            if ctrl:
                bad.append("%d control byte(s) in a text file: %s"
                           % (len(ctrl), rel))
            text = body.decode("utf-8", "replace")
            for needle, why in (("eval(", "eval"), ("new Function", "new Function")):
                if needle in text:
                    bad.append("%s in %s — MV3 forbids it" % (why, rel))
    return bad


def walk():
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = [d for d in dirnames if d not in JUNK_DIRS]
        for f in sorted(filenames):
            yield os.path.join(dirpath, f)


def build():
    with open(os.path.join(SRC, "manifest.json"), encoding="utf-8") as fh:
        version = json.load(fh)["version"]
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, "shelves-%s.zip" % version)
    total = 0
    # Sorted, and with a fixed timestamp, so the same tree produces the same
    # bytes — a package you can diff against the last one you submitted.
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in walk():
            rel = os.path.relpath(f, SRC).replace("\\", "/")
            info = zipfile.ZipInfo(rel, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(f, "rb") as fh:
                data = fh.read()
            z.writestr(info, data)
            total += len(data)
            print("   +", rel)
    print("\n%s  (%d files, %.1f KB raw, %.1f KB zipped)" % (
        os.path.relpath(out, ROOT), len(z.namelist()), total / 1024,
        os.path.getsize(out) / 1024))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="audit only")
    args = ap.parse_args()

    problems = audit()
    if problems:
        print("NOT fit to submit:")
        for p in problems:
            print("  -", p)
        return 1
    print("audit: clean")
    if args.check:
        return 0
    build()
    return 0


if __name__ == "__main__":
    sys.exit(main())
