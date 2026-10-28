// The Shelf screen in /admin: the game's looks with what each has sold, and a draft you can change in this page. It runs only in
// the creator's own browser, on the creator's own game. It changes NOTHING on the game: the new looks.json is text to copy and put
// in the repository (there is no server call that writes looks, on purpose). Its rules are in the package's looks path (../../looks).

import { diffLooks, removalProblems } from "../../looks/change.js";
import { SLOTS_MAX } from "../../looks/look.js";
import { looksJson, slugId } from "../../looks/json.js";
import { PRICE_LADDER, priceText, rungOf, rungUsd } from "../../looks/ladder.js";
import { HATS, lookProblems, usdText, type Hat, type Look, type Problem } from "../../looks/look.js";
import { copy, h } from "./dom.js";
import { aiPrompt, changeText, ownedIds, shelfStats, soldText, type ShelfOrder, type ShelfPlayer } from "./shelfData.js";

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

/** A small flat picture of a look: the body in its colour and the hat in its colour. (The game draws the real character; a game can give its own picture.) */
export function lookPicture(l: Look): Element {
  const hat = l.change.hat;
  const hc = l.change.hatColor ?? "#444444";
  const hats: Record<Hat, Element[]> = {
    cap: [shape("path", { d: "M19 24 A13 13 0 0 1 45 24 Z", fill: hc }), shape("rect", { x: 30, y: 22, width: 22, height: 4, rx: 2, fill: hc })],
    beanie: [shape("path", { d: "M18 23 A14 14 0 0 1 46 23 Z", fill: hc }), shape("rect", { x: 18, y: 21, width: 28, height: 5, rx: 2, fill: hc }), shape("circle", { cx: 32, cy: 9, r: 3.5, fill: hc })],
    crown: [shape("polygon", { points: "20,22 20,11 26,17 32,9 38,17 44,11 44,22", fill: hc })],
    tophat: [shape("rect", { x: 23, y: 3, width: 18, height: 17, rx: 2, fill: hc }), shape("rect", { x: 17, y: 19, width: 30, height: 4, rx: 2, fill: hc })],
  };
  return svg(
    "svg",
    { viewBox: "0 0 64 72", width: 56, height: 63, role: "img", "aria-label": `${l.name}: ${l.change.hat ?? "no hat"}` },
    shape("rect", { x: 23, y: 61, width: 7, height: 9, rx: 2, fill: "#3a3f5c" }),
    shape("rect", { x: 34, y: 61, width: 7, height: 9, rx: 2, fill: "#3a3f5c" }),
    shape("rect", { x: 16, y: 37, width: 32, height: 28, rx: 12, fill: l.change.body }),
    shape("circle", { cx: 32, cy: 26, r: 13, fill: "#f2c9a0" }),
    svg("circle", { cx: 27, cy: 27, r: 1.7, fill: INK }),
    svg("circle", { cx: 37, cy: 27, r: 1.7, fill: INK }),
    ...(hat ? hats[hat] : []),
  );
}

const clone = (ls: readonly Look[]): Look[] => ls.map((l) => ({ id: l.id, name: l.name, priceUsd: l.priceUsd, change: { ...l.change }, ...(l.slots ? { slots: { ...l.slots } } : {}) }));

/** "wings ember, trail #ffcf5a" */
const slotsText = (l: Look): string => Object.entries(l.slots ?? {}).map(([k, v]) => `${k} ${v}`).join(", ");

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

/**
 * The screen. `looks` is the game's looks now (its looks.json): the draft starts from them. `update` hands the screen fresh numbers (after the page reloads
 * the summary) and keeps the draft. `picture` draws a look (default: the flat picture above). `repoHelp` is what to tell a game that has no repository set.
 */
export function shelfView(first: ShelfData, looks: readonly Look[], picture: (l: Look) => Element = lookPicture, repoHelp = "To get a link to your looks.json on GitHub, give the admin your repository (for example your-name/your-game)."): { el: HTMLElement; update: (d: ShelfData) => void } {
  const LOOKS = looks;
  let data = first;
  let draft = clone(LOOKS);
  let editing = false;
  const el = h("section", { class: "admin-card shelf", "aria-labelledby": "shelf-title" });

  const stats = () => shelfStats(data.orders, data.players);
  const owned = () => ownedIds(data.players);
  const isOriginal = (id: string) => LOOKS.some((l) => l.id === id);
  const freeCount = () => draft.filter((l) => l.priceUsd === 0).length;
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
    const st = stats();
    const own = owned();
    const head = h(
      "div",
      { class: "card-head" },
      h("h2", { id: "shelf-title" }, "Shelf"),
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
        editing ? "Close the editor" : "Edit the shelf",
      ),
    );
    const intro = h(
      "p",
      { class: "fine" },
      editing
        ? "Change a look here to see what it would be. This page changes nothing in your game: when you are happy, copy the new looks.json into your repository and push it. Your game builds again and the new looks go live."
        : "The looks your game sells now, with what each has sold in your own database. Nobody else sees these numbers.",
    );

    const list = h("div", { class: "shelf-list" });
    draft.forEach((l, i) => list.append(card(l, i, st, own)));
    const parts: (Node | null)[] = [head, intro, list];

    if (editing) {
      parts.push(
        h(
          "div",
          { class: "shelf-add" },
          h("button", { class: "btn", type: "button", onclick: () => addLook() }, "Add a look"),
          " ",
          h("button", { class: "btn", type: "button", disabled: JSON.stringify(draft) === JSON.stringify(LOOKS), onclick: () => ((draft = clone(LOOKS)), redraw()) }, "Start over"),
        ),
        foot(),
      );
    }
    el.replaceChildren(...parts.filter((p): p is Node => p !== null));
  }

  function card(l: Look, i: number, st: ReturnType<typeof stats>, own: Set<string>) {
    const rung = rungOf(l.priceUsd);
    const price = l.priceUsd === 0 ? "Free" : `${priceText(l.priceUsd)}${rung ? ` · ${rung.name}` : ""}`;
    const pic = h("div", { class: "shelf-pic" }, picture(l));
    const priceLine = h("span", { class: "shelf-price" }, price);
    const top = h("div", { class: "shelf-top" }, pic, h("div", { class: "shelf-text" }, h("strong", {}, l.name || "(no name)"), priceLine, h("span", { class: "fine" }, isOriginal(l.id) ? (l.priceUsd === 0 ? "Every player starts with it" : soldText(st.get(l.id))) : "New: not in your game yet"), l.slots && Object.keys(l.slots).length ? h("span", { class: "fine shelf-slots" }, `Slots: ${slotsText(l)}`) : null));
    if (!editing) return h("article", { class: "shelf-card" }, top);

    const sync = () => {
      pic.replaceChildren(picture(l));
      const r = rungOf(l.priceUsd);
      priceLine.textContent = Number.isFinite(l.priceUsd) ? (l.priceUsd === 0 ? "Free" : `${priceText(l.priceUsd)}${r ? ` · ${r.name}` : ""}`) : "No price";
      top.querySelector("strong")!.textContent = l.name || "(no name)";
      refreshFoot();
    };
    const name = h("input", { class: "shelf-input", type: "text", maxlength: 40, value: l.name, "aria-label": `Name of look ${i + 1}`, oninput: (e: Event) => {
      l.name = (e.target as HTMLInputElement).value;
      if (!isOriginal(l.id)) l.id = slugId(l.name, draft.filter((x) => x !== l).map((x) => x.id));
      sync();
    } });
    const priceInput = h("input", { class: "shelf-input shelf-num", type: "number", step: 0.01, min: 0, max: 1000, inputmode: "decimal", value: Number.isFinite(l.priceUsd) ? l.priceUsd : "", "aria-label": `Price in US dollars of ${l.name}`, oninput: (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      l.priceUsd = v === "" ? Number.NaN : Number(v);
      sync();
    } });
    const ladder = h("div", { class: "shelf-ladder", role: "group", "aria-label": "Price ladder" });
    const setPrice = (usd: number) => {
      l.priceUsd = usd;
      priceInput.value = String(usd);
      sync();
    };
    ladder.append(h("button", { class: "chip", type: "button", onclick: () => setPrice(0) }, "Free"));
    for (const r of PRICE_LADDER) ladder.append(h("button", { class: "chip", type: "button", title: `${r.name}: ${r.for}`, onclick: () => setPrice(rungUsd(r)) }, priceText(rungUsd(r))));
    const body = h("input", { class: "shelf-color", type: "color", value: l.change.body, "aria-label": `Body colour of ${l.name}`, oninput: (e: Event) => {
      l.change.body = (e.target as HTMLInputElement).value;
      sync();
    } });
    const hatColor = h("input", { class: "shelf-color", type: "color", value: l.change.hatColor ?? "#1c6e4f", "aria-label": `Hat colour of ${l.name}`, disabled: !l.change.hat, oninput: (e: Event) => {
      l.change.hatColor = (e.target as HTMLInputElement).value;
      sync();
    } });
    const hat = h("select", { class: "shelf-input", "aria-label": `Hat of ${l.name}`, onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === "") {
        delete l.change.hat;
        delete l.change.hatColor;
        hatColor.disabled = true;
      } else {
        l.change.hat = v as Hat;
        l.change.hatColor ??= hatColor.value;
        hatColor.disabled = false;
      }
      sync();
    } }, h("option", { value: "" }, "No hat"), ...HATS.map((x) => h("option", { value: x }, x)));
    hat.value = l.change.hat ?? "";

    const lastFree = l.priceUsd === 0 && freeCount() === 1;
    const keep = isOriginal(l.id) && own.has(l.id);
    const remove = h("button", { class: "btn", type: "button", disabled: keep || lastFree, title: keep ? "A player owns this look. Keep it in the file." : lastFree ? "Keep one free look: every player starts with it." : "", onclick: () => ((draft = draft.filter((x) => x !== l)), redraw()) }, "Remove");
    const dup = h("button", { class: "btn", type: "button", onclick: () => addLook(l) }, "Duplicate");

    return h(
      "article",
      { class: "shelf-card shelf-editing" },
      top,
      h("label", { class: "shelf-field" }, h("span", {}, "Name"), name),
      h("div", { class: "shelf-field" }, h("span", {}, "Price in US dollars"), priceInput, ladder),
      h("div", { class: "shelf-colors" }, h("label", { class: "shelf-field" }, h("span", {}, "Body colour"), body), h("label", { class: "shelf-field" }, h("span", {}, "Hat"), hat), h("label", { class: "shelf-field" }, h("span", {}, "Hat colour"), hatColor)),
      slotsEditor(l, isOriginal(l.id) && own.has(l.id)),
      keep ? h("p", { class: "fine" }, "A player owns this look: its id stays, and it cannot be removed.") : null,
      h("div", { class: "shelf-actions" }, dup, " ", remove),
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
          h("input", { class: "shelf-input", type: "text", maxlength: 24, value: name, placeholder: "name", autocapitalize: "none", spellcheck: false, "aria-label": `Name of slot ${r + 1} of ${l.name}`, oninput: edit(0) }),
          h("input", { class: "shelf-input", type: "text", maxlength: 40, value: value, placeholder: "word or #rrggbb", autocapitalize: "none", spellcheck: false, "aria-label": `Value of slot ${r + 1} of ${l.name}`, oninput: edit(1) }),
          h("button", { class: "btn btn-small", type: "button", "aria-label": `Remove slot ${name || r + 1} of ${l.name}`, onclick: () => (setRows(l, rowsOf(l).filter((_, i) => i !== r)), redraw()) }, "Remove"),
        ),
      );
    });
    const add = h("button", { class: "btn btn-small", type: "button", disabled: rows.length >= SLOTS_MAX, onclick: () => {
      const cur = rowsOf(l);
      let n = cur.length + 1;
      while (cur.some(([k]) => k === `slot-${n}`)) n++;
      setRows(l, [...cur, [`slot-${n}`, ""]]);
      redraw();
    } }, "Add a slot");
    return h(
      "div",
      { class: "shelf-field shelf-slots-edit" },
      h("span", {}, `Slots (${rows.length} of ${SLOTS_MAX}): words and colours that your game reads`),
      list,
      add,
      owned ? h("p", { class: "fine" }, "A player owns this look: its slots cannot change. Add a new look with the new slots instead.") : null,
    );
  }

  function addLook(from?: Look) {
    const name = from ? `${from.name} copy`.slice(0, 40) : "New look";
    const base: Look = from ? { id: "", name, priceUsd: from.priceUsd, change: { ...from.change }, ...(from.slots ? { slots: { ...from.slots } } : {}) } : { id: "", name, priceUsd: 0.05, change: { body: "#4aa8ff" } };
    base.id = slugId(name, draft.map((x) => x.id));
    draft = [...draft, base];
    redraw();
    el.querySelectorAll<HTMLInputElement>(".shelf-card:last-of-type input[type=text]").forEach((i) => i.focus());
  }

  const footBox = h("div", { class: "shelf-foot" });
  const foot = () => {
    refreshFoot();
    return footBox;
  };

  function refreshFoot() {
    const bad = problems();
    const diff = diffLooks(LOOKS, draft);
    const changed = diff.added.length + diff.removed.length + diff.changed.length > 0;
    const text = bad.length ? "" : looksJson(draft);
    const out: (Node | null)[] = [];
    if (bad.length) out.push(h("div", { class: "late-note", role: "alert" }, h("strong", {}, "Fix these first"), h("ul", {}, ...bad.map((p) => h("li", {}, p.message)))));
    out.push(
      h(
        "div",
        { class: "shelf-changes" },
        h("strong", {}, changed ? changeText(diff) : "No change yet"),
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
    const ready = !bad.length && changed;
    const copyJson = h("button", { class: "btn btn-primary", type: "button", disabled: !ready, onclick: (e: Event) => void copy(text, e.currentTarget as HTMLButtonElement) }, "Copy looks.json");
    const copyAi = h("button", { class: "btn", type: "button", disabled: !ready, onclick: (e: Event) => void copy(aiPrompt(text, diff, [...owned()].sort(), LOOKS), e.currentTarget as HTMLButtonElement) }, "Copy a message for my AI");
    out.push(
      h(
        "div",
        { class: "shelf-actions" },
        copyJson,
        " ",
        copyAi,
        data.repo ? h("a", { class: "btn", href: `https://github.com/${data.repo}/edit/main/looks.json`, target: "_blank", rel: "noopener noreferrer" }, "Open looks.json on GitHub") : null,
      ),
      !data.repo ? h("p", { class: "fine" }, repoHelp) : null,
      ready ? h("details", { class: "shelf-file" }, h("summary", {}, "Show the new looks.json"), h("pre", {}, text)) : null,
    );
    footBox.replaceChildren(...out.filter((n): n is Node => n !== null));
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
