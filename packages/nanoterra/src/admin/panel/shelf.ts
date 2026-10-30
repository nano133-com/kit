// The Shelf screen in /admin (the Cosmetics tab): the game's looks with what each has sold, and a draft you can change in this page. It runs only in
// the creator's own browser, on the creator's own game. It changes NOTHING on the game: the new looks.json is text to copy and put
// in the repository (there is no server call that writes looks, on purpose). Its rules are in the package's looks path (../../looks).
//
// Two modes. To see: the looks the game sells NOW (its looks.json), in a grid of cards with a big picture, the price and its step on the ladder, what each
// has sold and its share of the sales, its slots; filters (All, For sale, Free, Not sold yet) and a sort. To edit: the draft, one card open at a time with its
// fields in groups (name, price, look, slots), a "New" or "Changed" mark on each card, and a change bar at the bottom of the screen with the copy keys.

import { diffLooks, removalProblems } from "../../looks/change.js";
import { SLOTS_MAX } from "../../looks/look.js";
import { looksJson, slugId } from "../../looks/json.js";
import { PRICE_LADDER, priceText, rungOf, rungUsd } from "../../looks/ladder.js";
import { COLOR_PATTERN, HATS, lookProblems, usdText, type Hat, type Look, type Problem } from "../../looks/look.js";
import { copy, dollars, h, plural } from "./dom.js";
import { icon } from "./icons.js";
import { aiPrompt, changeText, ownedIds, shelfStats, soldText, type LookStats, type ShelfOrder, type ShelfPlayer } from "./shelfData.js";

export type ShelfData = { orders: ShelfOrder[]; players: ShelfPlayer[]; repo: string | null };

const NS = "http://www.w3.org/2000/svg";
const INK = "#1d1530";
const svg = (tag: string, attrs: Record<string, string | number> = {}, ...kids: Element[]) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
};
const shape = (tag: string, attrs: Record<string, string | number>) => svg(tag, { stroke: INK, "stroke-width": 1.4, "stroke-linejoin": "round", ...attrs });

/** The shapes of a hat in the flat picture's 64 x 72 box, in the colour `fill`. */
function hatShapes(hat: Hat, fill: string): Element[] {
  const hats: Record<Hat, () => Element[]> = {
    cap: () => [shape("path", { d: "M19 24 A13 13 0 0 1 45 24 Z", fill }), shape("rect", { x: 30, y: 22, width: 22, height: 4, rx: 2, fill })],
    beanie: () => [shape("path", { d: "M18 23 A14 14 0 0 1 46 23 Z", fill }), shape("rect", { x: 18, y: 21, width: 28, height: 5, rx: 2, fill }), shape("circle", { cx: 32, cy: 9, r: 3.5, fill })],
    crown: () => [shape("polygon", { points: "20,22 20,11 26,17 32,9 38,17 44,11 44,22", fill })],
    tophat: () => [shape("rect", { x: 23, y: 3, width: 18, height: 17, rx: 2, fill }), shape("rect", { x: 17, y: 19, width: 30, height: 4, rx: 2, fill })],
  };
  return hats[hat]();
}

/** A small flat picture of a look: the body in its colour and the hat in its colour. (The game draws the real character; a game can give its own picture.) */
export function lookPicture(l: Look): Element {
  const hat = l.change.hat;
  return svg(
    "svg",
    { viewBox: "0 0 64 72", width: 56, height: 63, role: "img", "aria-label": `${l.name}: ${l.change.hat ?? "no hat"}` },
    shape("rect", { x: 23, y: 61, width: 7, height: 9, rx: 2, fill: "#3a3f5c" }),
    shape("rect", { x: 34, y: 61, width: 7, height: 9, rx: 2, fill: "#3a3f5c" }),
    shape("rect", { x: 16, y: 37, width: 32, height: 28, rx: 12, fill: l.change.body }),
    shape("circle", { cx: 32, cy: 26, r: 13, fill: "#f2c9a0" }),
    svg("circle", { cx: 27, cy: 27, r: 1.7, fill: INK }),
    svg("circle", { cx: 37, cy: 27, r: 1.7, fill: INK }),
    ...(hat ? hatShapes(hat, l.change.hatColor ?? "#444444") : []),
  );
}

/** The drawing on a hat choice in the editor: the hat alone (or a dashed head for "No hat"), filled with the text colour, so the choice shows the look's hat colour. */
function hatChoicePicture(hat: Hat | null): Element {
  const head = shape("circle", { cx: 32, cy: 30, r: 12, fill: "#f2c9a0" });
  const kids = hat ? [head, ...hatShapes(hat, "currentColor")] : [svg("circle", { cx: 32, cy: 30, r: 12, fill: "#f2c9a0", stroke: INK, "stroke-width": 1.4, "stroke-dasharray": "3 3" })];
  return svg("svg", { viewBox: "0 0 64 46", width: 46, height: 33, "aria-hidden": "true", focusable: "false" }, ...kids);
}

/**
 * A Shelf picture that shows the look on the real character. `load` gives the drawing function (a look to a PNG address, or null), and is
 * called once, the first time a picture is asked for: let it import your preview file dynamically, so Three.js loads only when the Shelf
 * opens (this file never imports it; the game starter's src/client/admin.ts shows how). Until the picture is drawn, and when it cannot be (no WebGL, a failure), the flat picture stays.
 * `@nano133/nanoterra/character` has `createLookPreview` to make the drawing function.
 */
export function previewPicture(load: () => Promise<(l: Look) => Promise<string | null>>, fallback: (l: Look) => Element = lookPicture, size = 64): (l: Look) => Element {
  let ready: Promise<((l: Look) => Promise<string | null>) | null> | null = null;
  return (l) => {
    const box = h("span", { class: "shelf-preview" }, fallback(l));
    ready ??= load().catch(() => null);
    const look: Look = { ...l, change: { ...l.change }, ...(l.slots ? { slots: { ...l.slots } } : {}) };
    void ready
      .then((render) => (render ? render(look) : null))
      .then((src) => {
        if (!src) return;
        const img = h("img", { src, width: size, height: size, alt: `${l.name || "A look"} on the character` }) as HTMLImageElement;
        box.replaceChildren(img);
      })
      .catch(() => undefined);
    return box;
  };
}

const clone = (ls: readonly Look[]): Look[] => ls.map((l) => ({ id: l.id, name: l.name, priceUsd: l.priceUsd, change: { ...l.change }, ...(l.slots ? { slots: { ...l.slots } } : {}) }));

/** The names of the slots that differ between two looks (added, removed or another value). */
function slotNamesChanged(before: Look, after: Look): string {
  const names = new Set([...Object.keys(before.slots ?? {}), ...Object.keys(after.slots ?? {})]);
  return [...names].filter((n) => (before.slots?.[n] ?? null) !== (after.slots?.[n] ?? null)).join(", ");
}

function fieldWords(d: ReturnType<typeof diffLooks>["changed"][number]): string {
  const parts = d.fields.map((f) => {
    if (f === "name") return `name "${d.before.name}" to "${d.after.name}"`;
    if (f === "priceUsd") return `price ${usdText(d.before.priceUsd)} to ${usdText(d.after.priceUsd)}`;
    if (f === "body") return "body colour";
    if (f === "hat") return `hat ${d.before.change.hat ?? "none"} to ${d.after.change.hat ?? "none"}`;
    if (f === "slots") return `slots changed (${slotNamesChanged(d.before, d.after)})`;
    return "hat colour";
  });
  return `${d.after.name}: ${parts.join(", ")}`;
}

/** The price as the cards write it: "Free", "25¢ · statement", "$1.10" (a price that is not a step of the ladder has no step name), "No price". */
function priceWords(usd: number): string {
  if (!Number.isFinite(usd)) return "No price";
  if (usd === 0) return "Free";
  const r = rungOf(usd);
  return `${priceText(usd)}${r ? ` · ${r.name}` : ""}`;
}

/** The colours the body colour offers in one press (any colour is good: the colour field is next to them). */
export const BODY_COLOURS = ["#4aa8ff", "#3ddc97", "#ffcf5a", "#ff7a3d", "#ff5c8a", "#9b6bff", "#2b2d42", "#f4f1ea"] as const;

/** A hat's name as the editor writes it. */
const HAT_WORDS: Record<Hat, string> = { cap: "Cap", beanie: "Beanie", crown: "Crown", tophat: "Top hat" };

export type ShelfFilter = "all" | "sale" | "free" | "unsold";
export type ShelfSort = "best" | "price-desc" | "price-asc" | "name" | "file";

const FILTERS: readonly { id: ShelfFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sale", label: "For sale" },
  { id: "free", label: "Free" },
  { id: "unsold", label: "Not sold yet" },
];
const SORTS: readonly { id: ShelfSort; label: string }[] = [
  { id: "best", label: "Best selling" },
  { id: "price-desc", label: "Price: high to low" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "name", label: "Name" },
  { id: "file", label: "File order" },
];

/** Whether a look passes a filter. "Not sold yet": a look for sale that no paid order and no owner has. Pure, for the screen and its tests. */
export function shelfFilter(l: Look, f: ShelfFilter, s: LookStats | undefined): boolean {
  if (f === "sale") return l.priceUsd > 0;
  if (f === "free") return l.priceUsd === 0;
  if (f === "unsold") return l.priceUsd > 0 && !s?.paid && !s?.owners;
  return true;
}

/** The looks in a sort's order (a new list; equal looks keep the file's order). Pure, for the screen and its tests. */
export function shelfSort(ls: readonly Look[], by: ShelfSort, stats: Map<string, LookStats>): Look[] {
  const place = new Map(ls.map((l, i) => [l, i]));
  const cents = (l: Look) => stats.get(l.id)?.paidCents ?? 0;
  const owners = (l: Look) => stats.get(l.id)?.owners ?? 0;
  const cmp: Record<ShelfSort, (a: Look, b: Look) => number> = {
    best: (a, b) => cents(b) - cents(a) || owners(b) - owners(a),
    "price-desc": (a, b) => b.priceUsd - a.priceUsd,
    "price-asc": (a, b) => a.priceUsd - b.priceUsd,
    name: (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    file: () => 0,
  };
  return [...ls].sort((a, b) => cmp[by](a, b) || place.get(a)! - place.get(b)!);
}

/** A slot's value as a chip: a colour gets a swatch. */
function slotChip(name: string, value: string): HTMLElement {
  const sw = COLOR_PATTERN.test(value) ? h("span", { class: "swatch", "aria-hidden": "true" }) : null;
  sw?.style.setProperty("--swatch", value);
  return h("li", { class: "slot-chip" }, sw, h("span", { class: "slot-name" }, name), " ", h("span", { class: "slot-value" }, value));
}

/**
 * The screen. `looks` is the game's looks now (its looks.json): the draft starts from them. `update` hands the screen fresh numbers (after the page reloads
 * the summary) and keeps the draft, the mode, the open card, the filter and the sort. `picture` draws a look (default: the flat picture above). `repoHelp` is
 * what to tell a game that has no repository set.
 */
export function shelfView(first: ShelfData, looks: readonly Look[], picture: (l: Look) => Element = lookPicture, repoHelp = "To get a link to your looks.json on GitHub, give the admin your repository (for example your-name/your-game)."): { el: HTMLElement; update: (d: ShelfData) => void } {
  const LOOKS = looks;
  let data = first;
  let draft = clone(LOOKS);
  let editing = false;
  /** The one card that is open in the editor (a look of the draft), or none. */
  let open: Look | null = null;
  /** The open card's marks and its list of problems: the change bar brings them up to date at every key press (the rest of the screen waits for a redraw). */
  let openParts: { marks: HTMLElement; problems: HTMLElement } | null = null;
  let filter: ShelfFilter = "all";
  let sort: ShelfSort = "best";
  const el = h("section", { class: "admin-card shelf", "aria-labelledby": "shelf-title" });

  const stats = () => shelfStats(data.orders, data.players);
  const owned = () => ownedIds(data.players);
  const isOriginal = (id: string) => LOOKS.some((l) => l.id === id);
  const freeCount = () => draft.filter((l) => l.priceUsd === 0).length;
  /** Whether the draft differs from the game's looks.json in any way, the order of the looks too (the file's own text is compared). */
  const changedFromGame = () => looksJson(draft) !== looksJson(LOOKS);

  /**
   * The pictures, kept by the look's text: a redraw puts the same picture back instead of drawing it again (a picture on the real character is drawn once,
   * and the card does not flash its flat picture first). Pictures that the last redraw did not use are let go.
   */
  const pictures = new Map<string, Element>();
  let used = new Set<string>();
  function pictureOf(l: Look): Element {
    const key = JSON.stringify([l.id, l.name, l.priceUsd, l.change, l.slots ?? null]);
    const kept = pictures.get(key);
    if (kept && !used.has(key)) {
      used.add(key);
      return kept;
    }
    const made = picture(l);
    pictures.set(key, made);
    used.add(key);
    return made;
  }

  /**
   * The rows of a look's slot editor, as typed: a name can be typed twice (an object cannot hold it), so the rows are the draft's own truth while it is edited, and the
   * look's `slots` is made from them. A row with no name and no value is a row not filled in yet: it is not a slot.
   */
  const slotRows = new WeakMap<Look, [string, string][]>();
  const rowsOf = (l: Look): [string, string][] => slotRows.get(l) ?? Object.entries(l.slots ?? {});
  function setRows(l: Look, rows: [string, string][]) {
    slotRows.set(l, rows);
    const filled = rows.filter(([k, v]) => k !== "" || v !== "");
    if (filled.length) l.slots = Object.fromEntries(filled);
    else delete l.slots;
  }

  function problems(): Problem[] {
    const dup: Problem[] = [];
    draft.forEach((l, i) => {
      const seen = new Set<string>();
      for (const [k] of rowsOf(l)) {
        if (k !== "" && seen.has(k)) dup.push({ look: i + 1, field: "slots", message: `looks.json, look ${i + 1}: the slot name "${k}" is used twice` });
        seen.add(k);
      }
    });
    const own = [...dup, ...lookProblems(draft)];
    return own.length ? own : removalProblems(LOOKS, draft, owned());
  }

  function redraw() {
    used = new Set();
    openParts = null;
    const st = stats();
    const own = owned();
    const forSale = LOOKS.filter((l) => l.priceUsd > 0).length;
    const earned = [...st.values()].reduce((n, s) => n + s.paidCents, 0);

    const head = h(
      "div",
      { class: "card-head" },
      h("div", { class: "card-title" }, h("h2", { id: "shelf-title" }, "Shelf"), h("p", { class: "fine card-sub" }, editing ? "Draft: nothing here changes your game until you push the new looks.json." : "The looks your game sells now. Only you see these numbers.")),
      h(
        "button",
        {
          class: `btn ${editing ? "" : "btn-primary"}`,
          type: "button",
          "aria-pressed": editing ? "true" : "false",
          onclick: () => {
            editing = !editing;
            redraw();
          },
        },
        editing ? icon("close", 18) : icon("pencil", 18),
        editing ? "Close the editor" : "Edit the shelf",
      ),
    );
    const parts: (Node | null)[] = [head];

    if (!editing) {
      parts.push(
        h(
          "ul",
          { class: "shelf-stats", "aria-label": "The shelf in numbers" },
          h("li", {}, h("strong", {}, String(LOOKS.length)), ` ${LOOKS.length === 1 ? "look" : "looks"}`),
          h("li", {}, h("strong", {}, String(forSale)), " for sale"),
          h("li", {}, h("strong", {}, String(LOOKS.length - forSale)), " free"),
          h("li", {}, h("strong", {}, dollars(earned)), " earned"),
        ),
      );
      if (changedFromGame()) {
        const diff = diffLooks(LOOKS, draft);
        parts.push(
          h(
            "div",
            { class: "draft-note", role: "status" },
            icon("pencil", 18),
            h("span", {}, `You have a draft that is not in your game yet: ${changeText(diff)}.`),
            h("button", { class: "btn btn-small", type: "button", onclick: () => ((editing = true), redraw()) }, "Open the draft"),
          ),
        );
      }
      parts.push(toolbar(st), viewGrid(st));
    } else {
      parts.push(
        h("p", { class: "fine" }, "Change a look here to see what it would be. This page changes nothing in your game: when you are happy, copy the new looks.json into your repository and push it. Your game builds again and the new looks go live."),
        editGrid(st, own),
        ...foot(),
      );
    }
    el.replaceChildren(...parts.filter((p): p is Node => p !== null));
    for (const k of [...pictures.keys()]) if (!used.has(k)) pictures.delete(k);
  }

  // ---- To see ----

  function toolbar(st: Map<string, LookStats>): HTMLElement {
    const chips = h("div", { class: "seg", role: "group", "aria-label": "Show looks" });
    for (const f of FILTERS) {
      const n = LOOKS.filter((l) => shelfFilter(l, f.id, st.get(l.id))).length;
      chips.append(
        h(
          "button",
          { class: `seg-btn${filter === f.id ? " is-on" : ""}`, type: "button", "aria-pressed": filter === f.id ? "true" : "false", onclick: () => ((filter = f.id), redraw()) },
          f.label,
          h("span", { class: "seg-count" }, String(n)),
        ),
      );
    }
    const select = h("select", { class: "input select", "aria-label": "Sort the looks", onchange: (e: Event) => ((sort = (e.target as HTMLSelectElement).value as ShelfSort), redraw()) }, ...SORTS.map((s) => h("option", { value: s.id }, s.label)));
    select.value = sort;
    return h("div", { class: "toolbar" }, chips, h("label", { class: "sort" }, h("span", {}, "Sort"), select));
  }

  function viewGrid(st: Map<string, LookStats>): HTMLElement {
    const total = [...st.values()].reduce((n, s) => n + s.paidCents, 0);
    const shown = shelfSort(LOOKS.filter((l) => shelfFilter(l, filter, st.get(l.id))), sort, st);
    const grid = h("div", { class: "shelf-list" });
    if (!shown.length) grid.append(h("p", { class: "empty" }, "No look matches this filter."));
    for (const l of shown) grid.append(viewCard(l, st.get(l.id), total));
    return grid;
  }

  function stage(l: Look, ...extra: (Node | null)[]): HTMLElement {
    const box = h("div", { class: "shelf-stage" }, h("div", { class: "shelf-pic" }, pictureOf(l)), ...extra);
    if (COLOR_PATTERN.test(l.change.body)) box.style.setProperty("--tint", l.change.body);
    return box;
  }

  function slotList(l: Look): HTMLElement | null {
    const entries = Object.entries(l.slots ?? {});
    if (!entries.length) return null;
    return h("ul", { class: "slot-chips shelf-slots", "aria-label": `Slots of ${l.name}` }, h("li", { class: "sr-only" }, "Slots:"), ...entries.map(([k, v]) => slotChip(k, v)));
  }

  function viewCard(l: Look, s: LookStats | undefined, total: number): HTMLElement {
    const share = s && total > 0 && s.paidCents > 0 ? Math.round((s.paidCents / total) * 100) : 0;
    const bar = h("div", { class: "share-bar" });
    bar.style.setProperty("--share", `${share}%`);
    return h(
      "article",
      { class: `shelf-card${l.priceUsd === 0 ? " is-free" : ""}` },
      stage(l, h("span", { class: `price-pill${l.priceUsd === 0 ? " is-free" : ""}` }, priceWords(l.priceUsd))),
      h(
        "div",
        { class: "shelf-body" },
        h("strong", { class: "shelf-name" }, l.name || "(no name)"),
        h("span", { class: "fine" }, l.priceUsd === 0 ? "Every player starts with it" : soldText(s)),
        share ? h("div", { class: "share", title: `${share}% of the money from sales` }, bar, h("span", { class: "fine" }, `${share}% of sales`)) : null,
        slotList(l),
      ),
    );
  }

  // ---- To edit ----

  function editGrid(st: Map<string, LookStats>, own: Set<string>): HTMLElement {
    const bad = problems();
    const diff = diffLooks(LOOKS, draft);
    const added = new Set(diff.added.map((l) => l.id));
    const changed = new Set(diff.changed.map((c) => c.id));
    const grid = h("div", { class: "shelf-list is-editing" });
    draft.forEach((l, i) => {
      const mine = bad.filter((p) => p.look === i + 1);
      const mark = added.has(l.id) ? "new" : changed.has(l.id) ? "changed" : null;
      grid.append(l === open ? editCard(l, i, st, own, mine, mark) : compactCard(l, st, own, mine, mark));
    });
    for (const gone of diff.removed) grid.append(ghostCard(gone));
    grid.append(h("button", { class: "shelf-add-tile", type: "button", onclick: () => addLook() }, icon("plus", 22), h("span", {}, "Add a look")));
    return grid;
  }

  function marks(l: Look, own: Set<string>, mine: Problem[], mark: "new" | "changed" | null): HTMLElement {
    return h("span", { class: "marks" }, ...markList(l, own, mine, mark));
  }

  function markList(l: Look, own: Set<string>, mine: Problem[], mark: "new" | "changed" | null): (Node | null)[] {
    return [
      mark ? h("span", { class: `mark mark-${mark}` }, mark === "new" ? "New" : "Changed") : null,
      isOriginal(l.id) && own.has(l.id) ? h("span", { class: "mark mark-owned", title: "A player owns this look" }, icon("lock", 14), "Owned") : null,
      mine.length ? h("span", { class: "mark mark-bad" }, plural(mine.length, "problem")) : null,
    ];
  }

  function compactCard(l: Look, st: Map<string, LookStats>, own: Set<string>, mine: Problem[], mark: "new" | "changed" | null): HTMLElement {
    return h(
      "article",
      { class: `shelf-card is-compact${mark ? ` is-${mark}` : ""}${mine.length ? " has-problem" : ""}` },
      stage(l),
      h(
        "div",
        { class: "shelf-body" },
        h("strong", { class: "shelf-name" }, l.name || "(no name)"),
        h("span", { class: "shelf-price" }, priceWords(l.priceUsd)),
        h("span", { class: "fine" }, isOriginal(l.id) ? (l.priceUsd === 0 ? "Every player starts with it" : soldText(st.get(l.id))) : "New: not in your game yet"),
        marks(l, own, mine, mark),
      ),
      h(
        "button",
        { class: "btn btn-small card-open", type: "button", "aria-expanded": "false", "aria-label": `Edit ${l.name || "this look"}`, onclick: () => openCard(l) },
        icon("pencil", 16),
        "Edit",
      ),
    );
  }

  function ghostCard(l: Look): HTMLElement {
    return h(
      "article",
      { class: "shelf-ghost" },
      h("div", { class: "shelf-body" }, h("strong", { class: "shelf-name" }, l.name), h("span", { class: "fine" }, "Removed from the draft")),
      h(
        "button",
        {
          class: "btn btn-small",
          type: "button",
          onclick: () => {
            const at = Math.min(LOOKS.findIndex((x) => x.id === l.id), draft.length);
            draft = [...draft.slice(0, at), ...clone([l]), ...draft.slice(at)];
            redraw();
          },
        },
        "Put back",
      ),
    );
  }

  function openCard(l: Look | null) {
    open = l;
    redraw();
    const card = el.querySelector<HTMLElement>(".shelf-editing");
    if (card) {
      card.focus({ preventScroll: true });
      card.scrollIntoView?.({ block: "nearest" });
    }
  }

  function editCard(l: Look, i: number, st: Map<string, LookStats>, own: Set<string>, mine: Problem[], mark: "new" | "changed" | null): HTMLElement {
    const pic = h("div", { class: "shelf-pic" }, pictureOf(l));
    const stageBox = h("div", { class: "shelf-stage is-big" }, pic);
    const nameLine = h("strong", { class: "shelf-name" }, l.name || "(no name)");
    const priceLine = h("span", { class: "shelf-price" }, priceWords(l.priceUsd));
    const tint = () => (COLOR_PATTERN.test(l.change.body) ? stageBox.style.setProperty("--tint", l.change.body) : stageBox.style.removeProperty("--tint"));
    tint();
    // The real picture is drawn a moment after the last change: a colour dragged across the picker draws once, not at every step.
    let later: ReturnType<typeof setTimeout> | null = null;
    const sync = () => {
      nameLine.textContent = l.name || "(no name)";
      priceLine.textContent = priceWords(l.priceUsd);
      tint();
      if (later) clearTimeout(later);
      later = setTimeout(() => pic.replaceChildren(pictureOf(l)), 150);
      ladder.querySelectorAll<HTMLButtonElement>("button").forEach((c) => c.setAttribute("aria-pressed", Number(c.dataset.usd) === l.priceUsd ? "true" : "false"));
      swatches.querySelectorAll<HTMLButtonElement>("button").forEach((c) => c.setAttribute("aria-pressed", c.dataset.colour === l.change.body.toLowerCase() ? "true" : "false"));
      hatChoices.style.setProperty("color", l.change.hatColor ?? "#9aa4b2");
      refreshFoot();
    };

    const name = h("input", { class: "input", type: "text", maxlength: 40, value: l.name, "aria-label": `Name of look ${i + 1}`, oninput: (e: Event) => {
      l.name = (e.target as HTMLInputElement).value;
      if (!isOriginal(l.id)) l.id = slugId(l.name, [...draft.filter((x) => x !== l).map((x) => x.id), ...owned()]);
      sync();
    } });

    const priceInput = h("input", { class: "input input-num", type: "number", step: 0.01, min: 0, max: 1000, inputmode: "decimal", value: Number.isFinite(l.priceUsd) ? l.priceUsd : "", "aria-label": `Price in US dollars of ${l.name}`, oninput: (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      l.priceUsd = v === "" ? Number.NaN : Number(v);
      sync();
    } });
    const ladder = h("div", { class: "ladder", role: "group", "aria-label": "Price ladder" });
    const setPrice = (usd: number) => {
      l.priceUsd = usd;
      priceInput.value = String(usd);
      sync();
    };
    const step = (usd: number, price: string, word: string, title: string) =>
      h("button", { class: "ladder-step", type: "button", title, "data-usd": usd, "aria-pressed": l.priceUsd === usd ? "true" : "false", onclick: () => setPrice(usd) }, h("strong", {}, price), h("span", {}, word));
    ladder.append(step(0, "Free", "everyone", "Every player has it"));
    for (const r of PRICE_LADDER) ladder.append(step(rungUsd(r), priceText(rungUsd(r)), r.name, `${r.name}: ${r.for}`));

    const body = h("input", { class: "colour", type: "color", value: l.change.body, "aria-label": `Body colour of ${l.name}`, oninput: (e: Event) => {
      l.change.body = (e.target as HTMLInputElement).value;
      sync();
    } });
    const swatches = h("div", { class: "swatches", role: "group", "aria-label": "Body colours" });
    for (const c of BODY_COLOURS) {
      const b = h("button", { class: "swatch-btn", type: "button", "data-colour": c, title: c, "aria-label": `Body colour ${c}`, "aria-pressed": c === l.change.body.toLowerCase() ? "true" : "false", onclick: () => {
        l.change.body = c;
        body.value = c;
        sync();
      } }, h("span", { class: "swatch", "aria-hidden": "true" }));
      (b.firstChild as HTMLElement).style.setProperty("--swatch", c);
      swatches.append(b);
    }

    const hatColor = h("input", { class: "colour", type: "color", value: l.change.hatColor ?? "#1c6e4f", "aria-label": `Hat colour of ${l.name}`, disabled: !l.change.hat, oninput: (e: Event) => {
      l.change.hatColor = (e.target as HTMLInputElement).value;
      sync();
    } });
    const hatName = `n133-hat-${i}`;
    const hatChoices = h("div", { class: "hat-choices", role: "radiogroup", "aria-label": `Hat of ${l.name}` });
    for (const x of [null, ...HATS] as (Hat | null)[]) {
      const input = h("input", { type: "radio", name: hatName, value: x ?? "", checked: (l.change.hat ?? null) === x, onchange: () => {
        if (x === null) {
          delete l.change.hat;
          delete l.change.hatColor;
          hatColor.disabled = true;
        } else {
          l.change.hat = x;
          l.change.hatColor ??= hatColor.value;
          hatColor.disabled = false;
        }
        hatChoices.querySelectorAll(".hat-choice").forEach((c) => c.classList.toggle("is-on", (c.querySelector("input") as HTMLInputElement).checked));
        sync();
      } });
      hatChoices.append(h("label", { class: `hat-choice${(l.change.hat ?? null) === x ? " is-on" : ""}` }, input, hatChoicePicture(x), h("span", {}, x ? HAT_WORDS[x] : "No hat")));
    }
    hatChoices.style.setProperty("color", l.change.hatColor ?? "#9aa4b2");

    const lastFree = l.priceUsd === 0 && freeCount() === 1;
    const keep = isOriginal(l.id) && own.has(l.id);
    const remove = h("button", { class: "btn btn-danger", type: "button", disabled: keep || lastFree, title: keep ? "A player owns this look. Keep it in the file." : lastFree ? "Keep one free look: every player starts with it." : "", onclick: () => {
      draft = draft.filter((x) => x !== l);
      open = null;
      redraw();
    } }, icon("trash", 18), "Remove");
    const dup = h("button", { class: "btn", type: "button", onclick: () => addLook(l) }, icon("dup", 18), "Duplicate");

    const openMarks = marks(l, own, mine, mark);
    const openProblems = h("ul", { class: "card-problems" }, ...mine.map((p) => h("li", {}, p.message)));
    openProblems.hidden = !mine.length;
    openParts = { marks: openMarks, problems: openProblems };
    const group = (title: string, ...kids: (Node | null)[]) => h("div", { class: "edit-group" }, h("h3", {}, title), ...kids);
    return h(
      "article",
      { class: `shelf-card shelf-editing${mark ? ` is-${mark}` : ""}${mine.length ? " has-problem" : ""}`, tabindex: -1, "aria-label": `Editing ${l.name || "a look"}` },
      h(
        "div",
        { class: "edit-top" },
        stageBox,
        h(
          "div",
          { class: "shelf-body" },
          nameLine,
          priceLine,
          h("span", { class: "fine" }, isOriginal(l.id) ? (l.priceUsd === 0 ? "Every player starts with it" : soldText(st.get(l.id))) : "New: not in your game yet"),
          openMarks,
        ),
        h("button", { class: "btn btn-small card-done", type: "button", "aria-expanded": "true", onclick: () => openCard(null) }, icon("check", 16), "Done"),
      ),
      openProblems,
      h(
        "div",
        { class: "edit-groups" },
        group("Name", h("label", { class: "field" }, h("span", {}, "What players read"), name)),
        group("Price", h("label", { class: "field" }, h("span", {}, "Price in US dollars"), priceInput), ladder),
        h(
          "div",
          { class: "edit-group group-look" },
          h("h3", {}, "Look"),
          h(
            "div",
            { class: "look-fields" },
            h("div", { class: "field" }, h("span", {}, "Body colour"), h("div", { class: "colour-row" }, swatches, body)),
            h("div", { class: "field" }, h("span", {}, "Hat"), hatChoices),
            h("label", { class: "field" }, h("span", {}, "Hat colour"), hatColor),
          ),
        ),
        slotsEditor(l, isOriginal(l.id) && own.has(l.id)),
      ),
      keep ? h("p", { class: "fine owned-note" }, icon("lock", 14), "A player owns this look: its id stays, and it cannot be removed.") : null,
      h("div", { class: "shelf-actions" }, dup, remove),
    );
  }

  /** The slots of a look: names and values (words or #rrggbb colours) that the game reads. Rows to type in, at most SLOTS_MAX. */
  function slotsEditor(l: Look, owned: boolean): HTMLElement {
    const rows = rowsOf(l);
    const list = h("div", { class: "shelf-slot-list" });
    rows.forEach(([name, value], r) => {
      const edit = (index: 0 | 1) => (e: Event) => {
        const cur = rowsOf(l);
        cur[r] = index === 0 ? [(e.target as HTMLInputElement).value, cur[r][1]] : [cur[r][0], (e.target as HTMLInputElement).value];
        setRows(l, cur);
        refreshFoot();
      };
      list.append(
        h(
          "div",
          { class: "shelf-slot" },
          h("input", { class: "input", type: "text", maxlength: 24, value: name, placeholder: "name", autocapitalize: "none", spellcheck: false, "aria-label": `Name of slot ${r + 1} of ${l.name}`, oninput: edit(0) }),
          h("input", { class: "input", type: "text", maxlength: 40, value: value, placeholder: "word or #rrggbb", autocapitalize: "none", spellcheck: false, "aria-label": `Value of slot ${r + 1} of ${l.name}`, oninput: edit(1) }),
          h("button", { class: "btn btn-small btn-quiet", type: "button", "aria-label": `Remove slot ${name || r + 1} of ${l.name}`, onclick: () => (setRows(l, rowsOf(l).filter((_, i) => i !== r)), redraw()) }, "Remove"),
        ),
      );
    });
    const add = h("button", { class: "btn btn-small", type: "button", disabled: rows.length >= SLOTS_MAX, onclick: () => {
      const cur = rowsOf(l);
      let n = cur.length + 1;
      while (cur.some(([k]) => k === `slot-${n}`)) n++;
      setRows(l, [...cur, [`slot-${n}`, ""]]);
      redraw();
    } }, icon("plus", 16), "Add a slot");
    return h(
      "div",
      { class: "edit-group shelf-slots-edit" },
      h("h3", {}, "Slots"),
      h("span", { class: "fine" }, `Slots (${rows.length} of ${SLOTS_MAX}): words and colours that your game reads`),
      rows.length ? list : null,
      add,
      owned ? h("p", { class: "fine" }, "A player owns this look: its slots cannot change. Add a new look with the new slots instead.") : null,
    );
  }

  function addLook(from?: Look) {
    const name = from ? `${from.name} copy`.slice(0, 40) : "New look";
    const base: Look = from ? { id: "", name, priceUsd: from.priceUsd, change: { ...from.change }, ...(from.slots ? { slots: { ...from.slots } } : {}) } : { id: "", name, priceUsd: 0.05, change: { body: "#4aa8ff" } };
    // An id that a player owns is never given to a new look (even when that look is not in looks.json now): the new look would be what the owners own.
    base.id = slugId(name, [...draft.map((x) => x.id), ...owned()]);
    const at = from ? draft.indexOf(from) + 1 : draft.length;
    draft = [...draft.slice(0, at), base, ...draft.slice(at)];
    openCard(base);
    el.querySelector<HTMLInputElement>(".shelf-editing input[type=text]")?.focus();
  }

  // ---- The change bar ----
  //
  // Two parts. The bar that stays at the bottom of the screen while the Shelf is edited holds only what is needed at every moment: the state of the draft
  // and the two copy keys (on a phone it is about 110 px high). The rest comes after it in the page: the problems in full, GitHub, Start over, what changed,
  // the new file.

  const footBar = h("div", { class: "shelf-foot", role: "region", "aria-label": "Your draft" });
  const footMore = h("div", { class: "shelf-foot-more" });
  const foot = (): Node[] => {
    refreshFoot();
    return [footBar, footMore];
  };

  /** "1 changed", "2 added, 1 removed": only the parts that are not zero. */
  const shortChange = (d: ReturnType<typeof diffLooks>) =>
    [d.added.length && `${d.added.length} added`, d.changed.length && `${d.changed.length} changed`, d.removed.length && `${d.removed.length} removed`].filter(Boolean).join(", ");

  function refreshFoot() {
    const bad = problems();
    const diff = diffLooks(LOOKS, draft);
    const changed = diff.added.length + diff.removed.length + diff.changed.length > 0;
    const text = bad.length ? "" : looksJson(draft);
    const ready = !bad.length && changed;
    footBar.replaceChildren(
      h(
        "div",
        { class: "foot-status" },
        h("strong", {}, changed ? shortChange(diff) : "No change yet"),
        bad.length ? h("span", { class: "mark mark-bad" }, `${plural(bad.length, "problem")} to fix`) : changed ? h("span", { class: "mark mark-ok" }, icon("check", 14), "Ready to copy") : null,
      ),
      h(
        "div",
        { class: "foot-keys" },
        h("button", { class: "btn btn-primary", type: "button", disabled: !ready, onclick: (e: Event) => void copy(text, e.currentTarget as HTMLButtonElement) }, "Copy looks.json"),
        h("button", { class: "btn", type: "button", title: "Copy a message for your AI assistant: the new looks.json, what changed and the rules", disabled: !ready, onclick: (e: Event) => void copy(aiPrompt(text, diff, [...owned()].sort(), LOOKS), e.currentTarget as HTMLButtonElement) }, "Copy for my AI"),
      ),
    );
    const out: (Node | null)[] = [];
    if (bad.length) out.push(h("div", { class: "late-note foot-problems", role: "alert" }, h("strong", {}, "Fix these first"), h("ul", {}, ...bad.map((p) => h("li", {}, p.message)))));
    out.push(
      h(
        "div",
        { class: "foot-links" },
        data.repo ? h("a", { class: "btn btn-small", href: `https://github.com/${data.repo}/edit/main/looks.json`, target: "_blank", rel: "noopener noreferrer" }, "Open looks.json on GitHub", icon("external", 16)) : null,
        h("button", { class: "btn btn-small btn-quiet", type: "button", disabled: !changedFromGame(), onclick: () => ((draft = clone(LOOKS)), (open = null), redraw()) }, "Start over"),
      ),
    );
    if (!data.repo) out.push(h("p", { class: "fine" }, repoHelp));
    out.push(
      h(
        "details",
        { class: "foot-more shelf-changes" },
        h("summary", {}, `What changed: ${changed ? changeText(diff) : "No change yet"}`),
        changed
          ? h(
              "ul",
              {},
              ...diff.added.map((l) => h("li", {}, `Added: ${l.name} (${l.priceUsd === 0 ? "free" : usdText(l.priceUsd)})`)),
              ...diff.changed.map((c) => h("li", {}, fieldWords(c))),
              ...diff.removed.map((l) => h("li", {}, `Removed: ${l.name}`)),
            )
          : null,
      ),
    );
    if (ready) out.push(h("details", { class: "foot-more shelf-file" }, h("summary", {}, "Show the new looks.json"), h("pre", {}, text)));
    footMore.replaceChildren(...out.filter((n): n is Node => n !== null));
    // The open card's own marks and problems, from the same check.
    if (open && openParts) {
      const at = draft.indexOf(open) + 1;
      const mine = bad.filter((p) => p.look === at);
      const mark = diff.added.some((l) => l === open) ? "new" : diff.changed.some((c) => c.after === open) ? "changed" : null;
      openParts.marks.replaceChildren(...markList(open, owned(), mine, mark).filter((n): n is Node => n !== null));
      openParts.problems.replaceChildren(...mine.map((p) => h("li", {}, p.message)));
      openParts.problems.hidden = !mine.length;
    }
  }

  redraw();
  return {
    el,
    update(d) {
      data = d;
      redraw();
    },
  };
}
