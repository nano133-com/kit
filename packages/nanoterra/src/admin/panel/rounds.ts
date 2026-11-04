// The Rounds screen of /admin (the Cosmetics tab's "Looks / Rounds" switch, only when the game sells plays): a card for each play of plays.json with
// what it has done (sold, used, ready, not used in time), and a draft you can change in this page. Like the Shelf, it changes NOTHING on the game: the
// new plays.json is text to copy and put in the repository (there is no server call that writes a play or a price, on purpose). The rules of a play are
// the kit's (checkPlays, ../../looks/play.ts): one use of the game, nothing else.

import type { Look } from "../../looks/look.js";
import { slugId } from "../../looks/json.js";
import { PLAY_ONE_USE, PLAY_USES, PLAY_WAIT_DAYS, PLAY_WAIT_DAYS_MAX, playProblems, type Play } from "../../looks/play.js";
import { priceText } from "../../looks/ladder.js";
import type { AdminSummary, PlayStats } from "../store.js";
import { copy, h, plural } from "./dom.js";
import { icon } from "./icons.js";

export type RoundsView = { el: HTMLElement; update(s: AdminSummary): void };

/** A play as plays.json writes it: `useWithinDays` only when it is not the default. */
const fileOf = (p: Play): Play => ({ id: p.id, name: p.name, priceUsd: p.priceUsd, use: p.use, ...(p.useWithinDays !== undefined && p.useWithinDays !== PLAY_WAIT_DAYS ? { useWithinDays: p.useWithinDays } : {}) });
/** The text of plays.json for a list of plays. */
export const playsJson = (plays: readonly Play[]): string => `${JSON.stringify(plays.map(fileOf), null, 2)}\n`;

/** What changed from the game's plays to the draft: added, changed (by id) and removed. */
export function playsDiff(before: readonly Play[], after: readonly Play[]): { added: Play[]; changed: Play[]; removed: Play[] } {
  const same = (a: Play, b: Play) => JSON.stringify(fileOf(a)) === JSON.stringify(fileOf(b));
  return {
    added: after.filter((p) => !before.some((b) => b.id === p.id)),
    changed: after.filter((p) => before.some((b) => b.id === p.id && !same(b, p))),
    removed: before.filter((b) => !after.some((p) => p.id === b.id)),
  };
}

/**
 * A message for an AI assistant that works in the game's repository: the whole new plays.json, what changed, and the rules. It holds no address, no order
 * and no secret: only the plays, and the ids that players paid for.
 */
export function playsPrompt(text: string, diff: ReturnType<typeof playsDiff>, sold: readonly string[]): string {
  const quote = (ids: readonly string[]) => ids.filter((id) => /^[a-z0-9-]{1,40}$/.test(id)).map((id) => JSON.stringify(id)).join(", ");
  return [
    "Replace plays.json at the top of this game with the text below, then run `npm run check` and push to GitHub. Do not change anything else.",
    "",
    `The change: ${diff.added.length} added, ${diff.changed.length} changed, ${diff.removed.length} removed.`,
    `Plays that players paid for and that must keep the same id: ${sold.length ? quote(sold) : "none yet"}.`,
    `Rules: ${PLAY_ONE_USE} (no prize, reward, odds, chance, random, tickets, tokens, cash or bonus); "use" is one of ${PLAY_USES.join(", ")}; prices in US dollars above 0 with at most 4 decimals; "useWithinDays" is 1 to ${PLAY_WAIT_DAYS_MAX} (30 when missing); never change or remove the id of a play that sold; a play never takes the id of a look.`,
    "",
    "plays.json:",
    "```json",
    text.trimEnd(),
    "```",
  ].join("\n");
}

const none = (playId: string): PlayStats => ({ playId, sold: 0, used: 0, ready: 0, late: 0, notUsedInTime: 0 });

/** The screen. `plays` is the game's plays now (its plays.json): the draft starts from them. `looks` are the game's looks (a play never takes their ids). */
export function roundsView(plays: readonly Play[], looks: readonly Look[]): RoundsView {
  const PLAYS = plays.map((p) => ({ ...p }));
  let draft: Play[] = PLAYS.map((p) => ({ ...p }));
  let stats: PlayStats[] = [];
  let editing = false;
  const el = h("section", { class: "admin-card rounds", "aria-labelledby": "rounds-title" });
  const statOf = (id: string) => stats.find((s) => s.playId === id) ?? none(id);
  /** The plays that players paid for: their ids must stay. */
  const sold = () => PLAYS.filter((p) => statOf(p.id).sold > 0 || statOf(p.id).ready > 0).map((p) => p.id);

  function problems(): string[] {
    const out = playProblems(draft, looks).map((p) => p.message);
    for (const p of PLAYS) {
      if (draft.some((d) => d.id === p.id)) continue;
      const s = statOf(p.id);
      if (s.ready > 0) out.push(`${p.name}: ${plural(s.ready, "paid credit")} ${s.ready === 1 ? "waits" : "wait"} for a round. Keep it until ${s.ready === 1 ? "it is" : "they are"} used.`);
      else if (s.sold > 0) out.push(`${p.name} sold before: keep it, or never give its id "${p.id}" to another play.`);
    }
    return out;
  }

  function redraw() {
    const head = h(
      "div",
      { class: "card-head" },
      h("div", { class: "card-title" }, h("h2", { id: "rounds-title" }, "Rounds"), h("p", { class: "fine card-sub" }, editing ? "Draft: nothing here changes your game until you push the new plays.json." : "The rounds your game sells now (plays.json). Only you see these numbers.")),
      h(
        "button",
        { class: `btn ${editing ? "" : "btn-primary"}`, type: "button", "aria-pressed": editing ? "true" : "false", onclick: () => ((editing = !editing), redraw()) },
        editing ? icon("close", 18) : icon("pencil", 18),
        editing ? "Close the editor" : "Edit",
      ),
    );
    el.replaceChildren(head, ...(editing ? editParts() : [viewGrid()]));
  }

  function viewGrid(): HTMLElement {
    if (!PLAYS.length) return h("p", { class: "empty" }, "Your game sells no rounds.");
    return h(
      "div",
      { class: "rounds-grid" },
      ...PLAYS.map((p) => {
        const s = statOf(p.id);
        const num = (label: string, n: number, alert = false) => h("li", { class: alert && n > 0 ? "is-alert" : "" }, h("span", {}, label), h("strong", {}, String(n)));
        return h(
          "article",
          { class: "round-card", "data-play": p.id },
          h("div", { class: "round-top" }, h("strong", { class: "round-name" }, p.name), h("span", { class: "mark" }, "Round")),
          h("p", { class: "round-price" }, h("strong", {}, priceText(p.priceUsd)), h("span", { class: "fine" }, ` · one ${p.use}, used once · waits ${plural(p.useWithinDays ?? PLAY_WAIT_DAYS, "day")}`)),
          h("ul", { class: "glance-list round-numbers" }, num("Sold", s.sold), num("Used", s.used), num("Ready", s.ready), num("Not used in time", s.notUsedInTime, true), num("Paid late", s.late, true)),
        );
      }),
    );
  }

  function editParts(): Node[] {
    const bad = problems();
    const diff = playsDiff(PLAYS, draft);
    const changed = diff.added.length + diff.changed.length + diff.removed.length > 0;
    const ready = !bad.length && changed;
    const text = ready ? playsJson(draft) : "";
    const field = (label: string, input: HTMLElement) => h("label", { class: "round-field" }, h("span", { class: "fine" }, label), input);
    const forms = draft.map((p, i) => {
      const locked = PLAYS.some((x) => x.id === p.id);
      const name = h("input", { class: "input", type: "text", value: p.name, maxlength: 40, "aria-label": `Name of play ${i + 1}` });
      name.addEventListener("change", () => {
        p.name = name.value;
        if (!locked) p.id = slugId(name.value, [...draft.filter((x) => x !== p).map((x) => x.id), ...looks.map((l) => l.id), ...PLAYS.map((x) => x.id)]);
        redraw();
      });
      const price = h("input", { class: "input input-num", type: "number", min: 0.0001, step: 0.0001, value: String(p.priceUsd), inputmode: "decimal", "aria-label": `Price of ${p.name} in US dollars` });
      price.addEventListener("change", () => ((p.priceUsd = Number(price.value)), redraw()));
      const use = h("select", { class: "input", "aria-label": `What ${p.name} buys` }, ...PLAY_USES.map((u) => h("option", { value: u, ...(u === p.use ? { selected: true } : {}) }, u)));
      use.addEventListener("change", () => ((p.use = use.value as Play["use"]), redraw()));
      const wait = h("input", { class: "input input-num", type: "number", min: 1, max: PLAY_WAIT_DAYS_MAX, step: 1, value: String(p.useWithinDays ?? PLAY_WAIT_DAYS), inputmode: "numeric", "aria-label": `Days a credit of ${p.name} waits` });
      wait.addEventListener("change", () => ((p.useWithinDays = Number(wait.value)), redraw()));
      const remove = h("button", { class: "btn btn-small btn-quiet", type: "button", onclick: () => ((draft = draft.filter((x) => x !== p)), redraw()) }, "Remove");
      return h(
        "article",
        { class: "round-card is-editing", "data-play": p.id },
        h("div", { class: "round-top" }, h("code", {}, p.id), locked ? h("span", { class: "fine" }, "id kept") : h("span", { class: "mark mark-new" }, "New")),
        field("Name", name),
        field("Price in US dollars", price),
        field("What it buys", use),
        field("Days a credit waits", wait),
        remove,
      );
    });
    const add = h(
      "button",
      {
        class: "btn",
        type: "button",
        onclick: () => {
          const taken = [...draft.map((x) => x.id), ...looks.map((l) => l.id), ...PLAYS.map((x) => x.id)];
          draft = [...draft, { id: slugId("Extra round", taken), name: "Extra round", priceUsd: 0.05, use: "round" }];
          redraw();
        },
      },
      icon("plus", 18),
      "Add a round",
    );
    const parts: (HTMLElement | null)[] = [
      h("p", { class: "fine" }, "Change a round here to see what it would be. This page changes nothing in your game: copy the new plays.json into your repository and push it."),
      h("div", { class: "rounds-grid" }, ...forms),
      add,
      bad.length ? h("div", { class: "late-note", role: "alert" }, h("strong", {}, "Fix these first"), h("ul", {}, ...bad.map((m) => h("li", {}, m)))) : null,
      h(
        "div",
        { class: "foot-keys" },
        h("button", { class: "btn btn-primary", type: "button", disabled: !ready, onclick: (e: Event) => void copy(text, e.currentTarget as HTMLButtonElement) }, "Copy plays.json"),
        h("button", { class: "btn", type: "button", disabled: !ready, onclick: (e: Event) => void copy(playsPrompt(text, diff, sold()), e.currentTarget as HTMLButtonElement) }, "Copy for my AI"),
        h("button", { class: "btn btn-small btn-quiet", type: "button", disabled: !changed, onclick: () => ((draft = PLAYS.map((p) => ({ ...p }))), redraw()) }, "Start over"),
      ),
      h("p", { class: "fine", role: "status" }, changed ? `${diff.added.length} added, ${diff.changed.length} changed, ${diff.removed.length} removed` : "No change yet"),
      ready ? h("details", { class: "foot-more" }, h("summary", {}, "Show the new plays.json"), h("pre", {}, text)) : null,
    ];
    return parts.filter((n): n is HTMLElement => n !== null);
  }

  redraw();
  return {
    el,
    update(s) {
      stats = s.plays;
      redraw();
    },
  };
}
