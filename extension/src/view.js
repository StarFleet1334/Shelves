/* SHELVES — view.js
 *
 * Bucketing and rendering. The one rule that matters here: the rows are
 * GitHub's OWN <li> elements, re-parented (P.V). Nothing is rebuilt from
 * data, so stars, language dots, "Updated 3 days ago", the Private badge and
 * every field GitHub adds next year keep working with no effort.
 */
globalThis.Shelves = globalThis.Shelves || {};
(function (S) {
  "use strict";

  /* First match wins — a repo is on exactly one shelf, always. Duplicates
   * would destroy both the counts and the ability to scan the page once
   * (charter, Boundaries). */
  S.bucketFor = function bucketFor(topics, settings) {
    if (settings.groups.length) {
      const hit = settings.groups.find((g) => topics.indexOf(g.toLowerCase()) !== -1);
      return hit || settings.otherLabel;
    }
    // No configured shelves: auto-group by the repo's first topic, alphabetical,
    // so the same repo always lands on the same shelf between loads.
    return topics.length ? topics.slice().sort()[0] : settings.otherLabel;
  };

  S.bucket = function bucket(rows, topics, settings) {
    const buckets = new Map();
    rows.forEach((li, i) => {
      const key = S.bucketFor(topics[i] || [], settings);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(li);
    });

    let order;
    if (settings.groups.length) {
      order = settings.groups.filter((g) => buckets.has(g));
    } else {
      order = Array.from(buckets.keys())
        .filter((k) => k !== settings.otherLabel)
        .sort((a, b) => buckets.get(b).length - buckets.get(a).length || a.localeCompare(b));
    }
    if (buckets.has(settings.otherLabel)) order.push(settings.otherLabel); // always last
    return { buckets, order };
  };

  function button(label, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sh-btn";
    b.textContent = label;
    if (title) b.title = title;
    return b;
  }

  /**
   * Builds the whole replacement subtree. Pure construction: it does not touch
   * the live page, so main.js owns the single swap.
   */
  S.render = function render(ctx) {
    const { rows, topics, settings, sourceUl, source, warning, owner, handlers } = ctx;
    const { buckets, order } = S.bucket(rows, topics, settings);
    const open = S.collapse.read(owner);

    const host = document.createElement("div");
    host.id = S.HOST_ID;

    const bar = document.createElement("div");
    bar.className = "sh-bar";

    const expand = button("expand all");
    const collapse = button("collapse all");
    const flat = button("flat list", "GitHub's plain ungrouped list");
    const rescan = button("rescan", "Forget cached topics and read them again");
    const note = document.createElement("div");
    note.className = "sh-note";

    /* P.IV — always say which rung answered. When grouping looks wrong this
     * is the first thing anyone needs to know. */
    const tagged = topics.filter((t) => t && t.length).length;
    note.textContent =
      rows.length + " repos · " + order.length + " shelves · " +
      tagged + " tagged · via " + source;
    if (warning) {
      const w = document.createElement("span");
      w.className = "sh-warn";
      w.textContent = warning;
      note.append(" · ", w);
    }

    bar.append(expand, collapse, flat, rescan, note);
    host.appendChild(bar);

    order.forEach((label) => {
      const list = buckets.get(label);
      const d = document.createElement("details");
      d.className = "sh-shelf";
      const remembered = open[label];
      d.open = remembered === undefined ? !settings.startCollapsed : !!remembered;

      const sum = document.createElement("summary");
      sum.className = "sh-sum";
      const name = document.createElement("span");
      name.className = "sh-name";
      name.textContent = label;
      const count = document.createElement("span");
      count.className = "sh-count";
      count.textContent = String(list.length);
      sum.append(name, count);
      d.appendChild(sum);

      const ul = document.createElement("ul");
      ul.className = sourceUl.className;
      ul.dataset[S.DONE] = "1"; // guard two: the finder must never take this back
      list.forEach((li) => ul.appendChild(li));
      d.appendChild(ul);

      d.addEventListener("toggle", () => {
        const state = S.collapse.read(owner);
        state[label] = d.open;
        S.collapse.write(owner, state);
      });

      host.appendChild(d);
    });

    expand.addEventListener("click", () =>
      host.querySelectorAll("details").forEach((d) => (d.open = true))
    );
    collapse.addEventListener("click", () =>
      host.querySelectorAll("details").forEach((d) => (d.open = false))
    );
    rescan.addEventListener("click", () => handlers.rescan());
    flat.addEventListener("click", () => {
      if (host.dataset.flat === "1") return handlers.reload();
      host.dataset.flat = "1";
      const one = document.createElement("ul");
      one.className = sourceUl.className;
      one.dataset[S.DONE] = "1";
      // Keeps the merged pages 2..N — flat is not "back to page one".
      host.querySelectorAll("details li").forEach((li) => one.appendChild(li));
      host.querySelectorAll("details").forEach((d) => d.remove());
      host.appendChild(one);
      flat.textContent = "shelved";
    });

    return host;
  };

  S.status = function status(text) {
    let el = document.getElementById("sh-status");
    if (!el) {
      el = document.createElement("div");
      el.id = "sh-status";
      el.className = "sh-status";
    }
    el.textContent = text;
    return el;
  };
})(globalThis.Shelves);
