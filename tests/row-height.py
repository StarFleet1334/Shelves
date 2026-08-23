"""How tall is a shelved row, against how tall GitHub draws it?

    python tests/row-height.py                       # the owner's profile
    python tests/row-height.py <github-username>

THE ONLY TEST HERE THAT CAN SEE THIS CLASS OF BUG. Everything a fixture can
answer is about our own markup; this one is about how much room we take on
somebody else's page, and the answer only exists when GitHub's stylesheet,
GitHub's utility classes and our own are all in the same document. A fixture
built to check a hypothesis about that can only ever confirm it — one was, for
a whole session, while 22px of blank sat under all 54 rows of a real profile
(see SCARS).

So it loads the unpacked extension into a real browser, opens a real
Repositories tab twice — once without us and once with — and compares row for
row. Then it takes each of our own rules back off IN the live page, which is
what turns "the rows are too tall" into "this rule is the 22px".

Needs playwright and a Chromium-family browser; installs nothing. If neither is
here it says so in one sentence and exits 3, the way aether/look.py does.
"""

import sys
import tempfile

EXT = str(__import__("pathlib").Path(__file__).resolve().parent.parent / "extension")
OWNER = "StarFleet1334"

# Each of ours that could plausibly own a row's height, struck out one at a
# time. A rule that owns nothing changes nothing — which is the finding.
SUSPECTS = [
    ("the empty note line", '#shelves-host .sh-margin[data-has="0"] { display: none !important; }'),
    ("the note margin, all of it", "#shelves-host .sh-margin { display: none !important; }"),
    ("any ceiling on a row's svg", "#shelves-host li svg { max-height: none !important; }"),
    ("our list padding", "#shelves-host .sh-shelf ul { padding: 0 !important; }"),
    ("a stranded lazy fragment", "#shelves-host li poll-include-fragment, "
                                 "#shelves-host li include-fragment, "
                                 "#shelves-host li [data-show-on-forbidden-error] "
                                 "{ display: none !important; }"),
]

ROWS = """
() => {
  const host = document.getElementById('shelves-host');
  const scope = host || document.getElementById('user-repositories-list') || document.body;
  const lis = [...scope.querySelectorAll('li')].filter(li => li.querySelector('h3 a'));
  const meta = document.querySelector('meta[name="user-login"]');
  return {shelved: !!host,
          signedIn: !!(meta && meta.content),
          /* A fragment that never loaded is the shape of the 1 416px row. */
          stranded: document.querySelectorAll(
            '#shelves-host li poll-include-fragment, #shelves-host li include-fragment'
          ).length,
          rows: lis.map(li => [li.querySelector('h3 a').textContent.trim(),
                               Math.round(li.getBoundingClientRect().height)])};
}
"""

STRIKE = """
(css) => {
  const host = document.getElementById('shelves-host');
  const s = document.createElement('style');
  s.textContent = css;
  document.head.append(s);
  const lis = [...host.querySelectorAll('li')].filter(li => li.querySelector('h3 a'));
  const h = lis.map(li => Math.round(li.getBoundingClientRect().height));
  s.remove();
  return h;
}
"""


COMPACT = """
() => {
  const host = document.getElementById('shelves-host');
  const btn = [...host.querySelectorAll('.sh-btn')].find(b => b.textContent === 'compact');
  if (!btn) return null;
  const rows = () => [...host.querySelectorAll('li[data-sh-name]')]
    .map(li => Math.round(li.getBoundingClientRect().height))
    .filter(h => h > 0).sort((a, b) => a - b);
  host.querySelectorAll('details').forEach(d => d.open = true);
  const before = rows();
  btn.click();
  const after = rows();
  btn.click();                        // leave the page as we found it
  const mid = (a) => a[Math.floor(a.length / 2)];
  return {roomy: mid(before), compact: mid(after), n: before.length};
}
"""


def measure_compact(page):
    """COMPACT IS A CLAIM ABOUT PIXELS, so it is only ever true in a browser.
    jsdom computes no layout: the harness can assert the attribute, the toggle
    and the memory, and nothing at all about whether the row got shorter."""
    try:
        return page.evaluate(COMPACT)
    except Exception:
        return None


def open_tab(p, user, with_ext):
    args = ["--window-size=1440,1000"]
    if with_ext:
        args += [f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"]
    ctx = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(prefix="shelves-test-"), channel="msedge", headless=False,
        args=args, viewport={"width": 1440, "height": 1000})
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto(f"https://github.com/{user}?tab=repositories", wait_until="load", timeout=60000)
    page.wait_for_timeout(7000)   # shelving, the merged pages, and the sparklines
    return ctx, page


# Plain ASCII in everything printed: the console this runs in is cp1252 and an
# em dash is a UnicodeEncodeError, not a typographic preference.
def main(user):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("no browser to measure with: playwright is not installed on this "
              "machine. Carry on without this test rather than installing anything.")
        return 3

    with sync_playwright() as p:
        ctx, page = open_tab(p, user, with_ext=False)
        plain = dict(page.evaluate(ROWS)["rows"])
        ctx.close()

        ctx, page = open_tab(p, user, with_ext=True)
        d = page.evaluate(ROWS)
        if not d["shelved"]:
            print("FAIL - the extension did not shelve the list; nothing to measure")
            ctx.close()
            return 1
        ours = d["rows"]
        signed_in, stranded = d["signedIn"], d["stranded"]
        compact = measure_compact(page)
        struck = [(why, page.evaluate(STRIKE, css)) for why, css in SUSPECTS]
        ctx.close()

    # Only the rows GitHub itself served can be compared: pages 2..N are ours
    # alone, and a row with no control is not evidence of anything.
    pairs = [(n, h, plain[n]) for n, h in ours if n in plain]
    grown = [(n, h, was) for n, h, was in pairs if h != was]
    print(f"{user}: {len(ours)} shelved rows, {len(pairs)} of them also drawn by GitHub alone")
    if not signed_in:
        # THE PAGE IS NOT THE SAME PAGE SIGNED OUT. The lazy fragments GitHub
        # ships in a merged row only refuse to load when they carry a nonce
        # that is checked, which is the signed-in response. Two sessions have
        # now measured a clean page here while the owner's was 60 000px tall.
        print("  WARNING - signed out. The merged-page rows do not fail here;")
        print("            sign in to this browser profile or this run proves little.")
    if stranded:
        print(f"  {stranded} lazy fragments left un-loaded inside rows - "
              "each one is an error blankslate waiting to be revealed")
    print(f"  shelved {sum(h for _, h, _ in pairs)}px   github {sum(w for _, _, w in pairs)}px")

    if compact:
        gain = round(compact["roomy"] / compact["compact"], 1) if compact["compact"] else 0
        print(f"  compact: {compact['roomy']}px -> {compact['compact']}px per row "
              f"({gain}x more rows on a screen, over {compact['n']} rows)")
    else:
        print("  compact: not measured - no toolbar button found")

    if not grown:
        print("PASS - every shelved row is exactly as tall as GitHub's own")
    else:
        d = grown[0][1] - grown[0][2]
        print(f"FAIL - {len(grown)} rows differ, e.g. {grown[0][0]}: "
              f"{grown[0][2]}px -> {grown[0][1]}px ({d:+}px)")
        print("  which of ours owns it, struck out one at a time in the live page:")
        base = sum(h for _, h in ours)
        for why, hs in struck:
            print(f"    {sum(hs) - base:+6}px total   {why}")
    return 0 if not grown else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else OWNER))
