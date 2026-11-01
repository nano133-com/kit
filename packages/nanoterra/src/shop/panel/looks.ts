// The looks sheet (the game starter's src/client/ui/looks.ts, with Echo Island's tabs for a game with wear slots): wear a look you own, or buy one.
// Every look is shown with its price before any step: nothing is random, and there are no loot boxes.
//
// A game that sells only outfits gets one list. A game with items of its own wear slots ("wear": "shovel") gets a tab for each slot, the outfits first;
// with `takeOff`, each item tab starts with its plain choice (free, "No charm").

import { h } from "../../admin/panel/dom.js";
import { OUTFIT, isOutfit, usdText, wearOf, type Look } from "../../looks/look.js";

const HAT_WORDS: Record<string, string> = { cap: "with a cap", beanie: "with a beanie", crown: "with a crown", tophat: "with a top hat" };

/** A tab's words: its key's word, and its plain choice's name (an item slot's: "Plain shovel", "No charm"). */
export type SlotWords = { tab: string; plain?: string };

export type LooksViewOptions = {
  looks: readonly Look[];
  owned: ReadonlySet<string>;
  signedIn: boolean;
  /** Whether the player wears this look now. */
  worn(look: Look): boolean;
  wear(look: Look): void;
  /** Takes off the item of a wear slot (back to the plain tool, or none). With it, each item tab starts with the plain choice. */
  takeOff?: (slot: string) => void;
  /** Whether nothing is worn in this slot (the plain choice is worn). Default: no look of the slot is worn. */
  plainWorn?: (slot: string) => boolean;
  buy(look: Look): void;
  /** The game's own picture of a look (a canvas, an image), or null for the kit's swatch. */
  picture?: (look: Look) => HTMLElement | null;
  /** Words for the tabs, by wear slot ("outfit" and the game's own). Default: "Outfits", then each slot's name. */
  slots?: Record<string, SlotWords>;
  /** The tab that is open (a wear slot). Default: the first. */
  tab?: string;
  /** A tab was chosen: the sheet draws again with it. */
  onTab?: (slot: string) => void;
};

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");

/** The wear slots of a list, in the order they first show (the outfits first). */
export function slotsOf(looks: readonly Look[]): string[] {
  const out: string[] = [OUTFIT];
  for (const l of looks) if (!out.includes(wearOf(l))) out.push(wearOf(l));
  return looks.some((l) => wearOf(l) === OUTFIT) ? out : out.slice(1);
}

function swatchOf(look: Look): HTMLElement {
  const swatch = h("span", { class: "n133s-swatch", "aria-hidden": "true" });
  if (isOutfit(look)) {
    swatch.style.background = look.change.body;
    if (look.change.hat) {
      const hat = h("span", { class: `n133s-swatch-hat n133s-hat-${look.change.hat}` });
      hat.style.background = look.change.hatColor ?? "#333";
      swatch.append(hat);
    }
  } else {
    swatch.classList.add("n133s-swatch-item");
    swatch.textContent = look.name.charAt(0).toUpperCase();
  }
  return swatch;
}

export function looksView(p: LooksViewOptions): HTMLElement {
  const slots = slotsOf(p.looks);
  const tab = p.tab && slots.includes(p.tab) ? p.tab : slots[0];
  const words = (slot: string): SlotWords => p.slots?.[slot] ?? (slot === OUTFIT ? { tab: "Outfits" } : { tab: titleCase(slot), plain: `No ${slot.replace(/-/g, " ")}` });
  const list = h("ul", { class: "n133s-looks" });
  const row = (pic: HTMLElement, name: string, line: string, action: HTMLElement, worn: boolean) =>
    h("li", { class: `n133s-look${worn ? " n133s-look-worn" : ""}` }, pic, h("span", { class: "n133s-look-text" }, h("strong", {}, name), h("small", {}, line)), action);

  if (tab !== OUTFIT && p.takeOff) {
    const plain = p.plainWorn ? p.plainWorn(tab) : !p.looks.some((l) => wearOf(l) === tab && p.worn(l));
    const action = h("button", { class: `n133s-btn${plain ? "" : " n133s-primary"}`, type: "button", disabled: plain, onclick: () => p.takeOff!(tab) }, plain ? "Wearing" : "Wear");
    list.append(row(h("span", { class: "n133s-swatch n133s-swatch-plain", "aria-hidden": "true" }), words(tab).plain ?? `No ${tab}`, "free", action, plain));
  }
  for (const look of p.looks) {
    if (wearOf(look) !== tab) continue;
    const mine = look.priceUsd === 0 || p.owned.has(look.id);
    const worn = p.worn(look);
    const action = mine
      ? h("button", { class: `n133s-btn${worn ? "" : " n133s-primary"}`, type: "button", disabled: worn, onclick: () => p.wear(look) }, worn ? "Wearing" : "Wear")
      : h("button", { class: "n133s-btn n133s-buy", type: "button", onclick: () => p.buy(look) }, `Buy ${usdText(look.priceUsd)}`);
    const what = isOutfit(look) ? (look.change.hat ? HAT_WORDS[look.change.hat] : "colour only") : tab.replace(/-/g, " ");
    const state = mine ? (look.priceUsd === 0 ? " · free" : " · yours") : "";
    list.append(row(p.picture?.(look) ?? swatchOf(look), look.name, `${what}${state}`, action, worn));
  }

  const tabs =
    slots.length > 1
      ? h(
          "div",
          { class: "n133s-tabs", role: "tablist", "aria-label": "Kinds of looks" },
          ...slots.map((s) =>
            h("button", { class: "n133s-tab", type: "button", role: "tab", "aria-selected": s === tab ? "true" : "false", onclick: () => p.onTab?.(s) }, words(s).tab),
          ),
        )
      : null;

  return h(
    "div",
    { class: "n133s-looks-view" },
    tabs,
    list,
    h("p", { class: "n133s-fine" }, "A look changes how your character looks. It never changes a score. You pay in Nano (XNO), straight to the game's creator."),
    p.signedIn ? null : h("p", { class: "n133s-fine" }, "To buy a look, sign in with Nano first: your looks belong to your Nano address."),
  );
}
