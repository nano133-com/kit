// The "Legal" card of /admin (the Settings tab): the creator's own rules for paid rounds (plays.json). Two switches ("Paid rounds for 18 and up only",
// "Sell an extra life or a continue"), the refund rule and its words, and the owner's one confirmation ("You are responsible for the laws where you
// sell."). A press saves at once (POST {api}/game, behind the same admin guard as every admin call); the game's shop reads them at each play order.
// The words are in ../switches.ts (LEGAL_WORDS). The card changes ONLY these settings: never a play, a price, an order or a credit. What the kit holds
// fixed (no cash prize, no prize of value, nothing random bought, no credit converted or moved) is listed, with no switch.

import type { Play } from "../../looks/play.js";
import { LIFE_USES, refundText } from "../legal.js";
import { REFUND_DAYS_MAX, REFUND_WORDS_MAX } from "../legalRules.js";
import { LEGAL_WORDS, type GameState } from "../switches.js";
import { ApiError, type Api } from "./api.js";
import { h } from "./dom.js";
import { icon } from "./icons.js";

export type LegalCard = {
  el: HTMLElement;
  /** The game's mode now (the summary's): outside test mode, a missing confirmation keeps every play order closed, and the card says so. */
  setTestMode(testMode: boolean): void;
};

type LegalSwitch = keyof typeof LEGAL_WORDS.switches;

/**
 * The card for the settings `initial`. `plays` are the game's plays (plays.json): the card names the ones the life switch holds back. `onChange` hears
 * each saved state.
 */
export function legalCard(api: Api, initial: GameState, plays: readonly Play[], onChange?: (state: GameState) => void): LegalCard {
  let state = initial;
  let testMode = true;
  const W = LEGAL_WORDS;
  const card = h("section", { class: "admin-card legal-card", "aria-labelledby": "legal-title" }, h("div", { class: "card-head" }, h("h2", { id: "legal-title" }, W.title)));
  card.append(h("p", { class: "fine card-intro" }, plays.length ? W.intro : `${W.intro} ${W.noPlays}`));

  const save = async (patch: Record<string, unknown>, status: HTMLElement, keys: (HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement)[]) => {
    for (const k of keys) k.disabled = true;
    status.textContent = "Saving…";
    try {
      state = await api.post<GameState>("/game", patch);
      status.textContent = "Saved.";
      draw();
      if ("refundDays" in patch || "refundWords" in patch) fillInputs();
      onChange?.(state);
    } catch (e) {
      status.textContent = e instanceof ApiError ? e.message : "The game's server did not answer. Nothing was changed.";
    } finally {
      for (const k of keys) k.disabled = false;
    }
  };

  // ---- the owner's confirmation ----
  const confirmBox = h("div", { class: "legal-confirm", role: "group", "aria-labelledby": "legal-confirm-title" });
  const confirmStatus = h("span", { class: "fine", role: "status", "aria-live": "polite" });
  const confirmKey = h("button", { class: "btn btn-primary", type: "button" }, W.confirmKey);
  confirmKey.addEventListener("click", () => void save({ confirmLaws: true }, confirmStatus, [confirmKey]));
  card.append(confirmBox);

  // ---- the two switches ----
  const rows = new Map<LegalSwitch, { button: HTMLButtonElement; sentence: HTMLElement }>();
  const switchRow = (id: LegalSwitch, extra?: HTMLElement) => {
    const words = W.switches[id];
    const label = h("span", { class: "switch-title", id: `legal-${id}-label` }, words.title);
    const button = h(
      "button",
      { class: "switch", type: "button", role: "switch", "aria-checked": "false", "aria-labelledby": `legal-${id}-label`, "aria-describedby": `legal-${id}-note` },
      h("span", { class: "switch-word" }, "Off"),
      h("span", { class: "switch-knob", "aria-hidden": "true" }),
    );
    const sentence = h("p", { class: "switch-note", id: `legal-${id}-note` });
    const status = h("span", { class: "fine", role: "status", "aria-live": "polite" });
    button.addEventListener("click", () => void save({ [id]: state.legal[id] ? "off" : "on" }, status, [button]));
    rows.set(id, { button, sentence });
    card.append(h("div", { class: "switch-row", "data-legal": id }, h("div", { class: "switch-head" }, label, button), sentence, extra ?? null, status));
  };
  switchRow("adultsOnly");
  const lives = plays.filter((p) => LIFE_USES.includes(p.use));
  switchRow("sellLives", h("p", { class: "fine legal-affects" }, lives.length ? `${W.affects} ${lives.map((p) => p.name).join(", ")}.` : W.affectsNone));

  // ---- the refund rule ----
  const days = h("input", { class: "input input-num", type: "number", id: "legal-refund-days", min: 0, max: REFUND_DAYS_MAX, step: 1, inputmode: "numeric" });
  const words = h("textarea", { class: "input legal-words", id: "legal-refund-words", maxlength: REFUND_WORDS_MAX, rows: 3, spellcheck: true });
  const preview = h("p", { class: "legal-preview" });
  const refundStatus = h("span", { class: "fine", role: "status", "aria-live": "polite" });
  const refundKey = h("button", { class: "btn btn-primary", type: "button" }, "Save the refund rule");
  const showPreview = () => {
    const d = Number(days.value);
    preview.textContent = refundText({ refundDays: Number.isInteger(d) ? d : state.legal.refundDays, refundWords: words.value.trim() || state.legal.refundWords });
  };
  days.addEventListener("input", showPreview);
  words.addEventListener("input", showPreview);
  refundKey.addEventListener("click", () => {
    const patch: Record<string, unknown> = {};
    const d = Number(days.value);
    if (days.value.trim() !== "" && d !== state.legal.refundDays) patch.refundDays = d;
    // One line, plain text: what the player reads. The server checks it again.
    const text = words.value.replace(/\s+/g, " ").trim();
    if (text !== state.legal.refundWords) patch.refundWords = text;
    if (!Object.keys(patch).length) {
      refundStatus.textContent = "No change.";
      return;
    }
    void save(patch, refundStatus, [refundKey, days, words]);
  });
  card.append(
    h(
      "div",
      { class: "switch-row legal-refund" },
      h("span", { class: "switch-title" }, W.refundTitle),
      h("p", { class: "switch-note" }, W.refundNote),
      h("label", { class: "legal-field", for: "legal-refund-days" }, h("span", {}, W.daysLabel), days),
      h("label", { class: "legal-field", for: "legal-refund-words" }, h("span", {}, W.wordsLabel), words),
      h("div", { class: "legal-preview-box" }, h("span", { class: "fine" }, W.previewLabel), preview),
      h("div", { class: "card-keys" }, refundKey, refundStatus),
    ),
  );

  // ---- fixed in the kit ----
  card.append(h("div", { class: "switch-row legal-fixed" }, h("span", { class: "switch-title" }, W.fixedTitle), h("ul", { class: "legal-fixed-list" }, ...W.fixed.map((f) => h("li", {}, icon("lock", 14), f)))));

  function drawConfirm() {
    const at = state.legal.lawsConfirmedAt;
    if (at !== null) {
      confirmBox.className = "legal-confirm is-done";
      confirmBox.replaceChildren(h("p", { class: "fine", id: "legal-confirm-title" }, icon("check", 14), ` ${W.confirmedOn(new Date(at).toLocaleDateString())} ${W.confirm}`));
      return;
    }
    confirmBox.className = `legal-confirm late-note${plays.length && !testMode ? " is-alert" : ""}`;
    confirmBox.replaceChildren(
      h("strong", { id: "legal-confirm-title" }, W.confirm),
      h("span", {}, plays.length && !testMode ? W.confirmLive : W.confirmNote),
      confirmKey,
      confirmStatus,
    );
  }

  function draw() {
    for (const [id, row] of rows) {
      const on = state.legal[id];
      row.button.setAttribute("aria-checked", on ? "true" : "false");
      row.button.classList.toggle("switch-on", on);
      row.button.querySelector(".switch-word")!.textContent = on ? "On" : "Off";
      row.sentence.textContent = on ? W.switches[id].on : W.switches[id].off;
    }
    drawConfirm();
  }
  /** The refund fields from the saved settings: at the start and after a save of them (a press on a switch keeps what is being typed). */
  function fillInputs() {
    days.value = String(state.legal.refundDays);
    words.value = state.legal.refundWords;
    showPreview();
  }
  draw();
  fillInputs();

  return {
    el: card,
    setTestMode(t) {
      testMode = t;
      drawConfirm();
    },
  };
}
