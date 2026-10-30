// The "Game" card of /admin: two switches, "Players can play as their Nanoterra character" and "Players can sign in with Nanoterra", and one three-way
// choice, "Friends list: Nanoterra / The game's own / Off". A press saves at once (POST {api}/game, behind the same admin guard as every admin call) and
// the game reads the setting at run time, so the creator pushes and deploys nothing. The words are in ../switches.ts. The card changes ONLY these three
// settings: never a look, a price or an order.

import { CHARACTER_NEEDS_SIGNIN, CHARACTER_SIGNIN_OFF, FRIENDS_CHOICES, FRIENDS_TITLE, REVIEW_LINK, REVIEW_NOTE, SWITCHES, pressOf, signinOn, stateOf, type Friends, type GameState, type SwitchId } from "../switches.js";
import { ApiError, type Api } from "./api.js";
import { h } from "./dom.js";

/**
 * The card for the settings `initial`. It keeps its own state: a press shows "Saving…", then "Saved." or the server's words. `defaultsFile` is where the game's defaults are
 * written ("game.config.json"). `onChange` hears each saved state (the panel's Overview shows the switches too).
 */
export function gameCard(api: Api, initial: GameState, defaultsFile = "the game's own settings", onChange?: (state: GameState) => void): HTMLElement {
  let state = initial;
  const rows = new Map<SwitchId, { button: HTMLButtonElement; sentence: HTMLElement; status: HTMLElement }>();
  /** Under the character switch: it works only through sign-in, so it says so, and says what a player gets while sign-in is Off. */
  const needs = h("p", { class: "fine switch-needs" });
  const card = h("section", { class: "admin-card game-card", "aria-labelledby": "game-title" }, h("div", { class: "card-head" }, h("h2", { id: "game-title" }, "Game")));
  card.append(h("p", { class: "fine card-intro" }, `Three choices about your game. A press saves at once: you push nothing and deploy nothing. They start from ${defaultsFile}, and a press here wins.`));
  /** The friends choice: a radio group of three keys (arrow keys move between them, as a radio group does). */
  const friendsKeys = new Map<Friends, HTMLButtonElement>();
  const friendsNote = h("p", { class: "switch-note", id: "switch-friends-note" });
  const friendsStatus = h("span", { class: "fine", role: "status", "aria-live": "polite" });

  const draw = () => {
    for (const [id, row] of rows) {
      const on = stateOf(id, state);
      row.button.setAttribute("aria-checked", on ? "true" : "false");
      row.button.classList.toggle("switch-on", on);
      row.button.querySelector(".switch-word")!.textContent = on ? "On" : "Off";
      row.sentence.textContent = on ? SWITCHES[id].on : SWITCHES[id].off;
    }
    needs.hidden = !stateOf("character", state);
    needs.textContent = signinOn(state.signin) ? CHARACTER_NEEDS_SIGNIN : CHARACTER_SIGNIN_OFF;
    for (const [id, key] of friendsKeys) {
      const on = state.friends === id;
      key.setAttribute("aria-checked", on ? "true" : "false");
      key.tabIndex = on ? 0 : -1;
      key.classList.toggle("is-on", on);
    }
    friendsNote.textContent = FRIENDS_CHOICES[state.friends]?.note ?? "";
  };

  const choose = async (id: Friends) => {
    if (state.friends === id) return;
    for (const key of friendsKeys.values()) key.disabled = true;
    friendsStatus.textContent = "Saving…";
    try {
      state = await api.post<GameState>("/game", { friends: id });
      friendsStatus.textContent = "Saved.";
      draw();
      onChange?.(state);
    } catch (e) {
      friendsStatus.textContent = e instanceof ApiError ? e.message : "The game's server did not answer. Nothing was changed.";
    } finally {
      for (const key of friendsKeys.values()) key.disabled = false;
    }
  };

  const press = async (id: SwitchId) => {
    const row = rows.get(id)!;
    row.button.disabled = true;
    row.status.textContent = "Saving…";
    try {
      state = await api.post<GameState>("/game", pressOf(id, state));
      row.status.textContent = "Saved.";
      draw();
      onChange?.(state);
    } catch (e) {
      row.status.textContent = e instanceof ApiError ? e.message : "The game's server did not answer. Nothing was changed.";
    } finally {
      row.button.disabled = false;
    }
  };

  for (const id of ["character", "signin"] as const) {
    const label = h("span", { class: "switch-title", id: `switch-${id}-label` }, SWITCHES[id].title);
    const button = h(
      "button",
      { class: "switch", type: "button", role: "switch", "aria-checked": "false", "aria-labelledby": `switch-${id}-label`, "aria-describedby": `switch-${id}-note` },
      h("span", { class: "switch-word" }, "Off"),
      h("span", { class: "switch-knob", "aria-hidden": "true" }),
    );
    const sentence = h("p", { class: "switch-note", id: `switch-${id}-note` });
    const status = h("span", { class: "fine", role: "status", "aria-live": "polite" });
    button.addEventListener("click", () => void press(id));
    rows.set(id, { button, sentence, status });
    card.append(h("div", { class: "switch-row" }, h("div", { class: "switch-head" }, label, button), sentence, id === "character" ? needs : null, status));
    // The sign-in word is part of the listing file: Nanoterra's review decides what Nanoterra shows. This page cannot see that review.
    if (id === "signin") card.append(h("p", { class: "fine switch-review" }, REVIEW_NOTE, " ", h("a", { href: REVIEW_LINK, target: "_blank", rel: "noopener noreferrer" }, "Open the launch page")));
  }

  const order = Object.keys(FRIENDS_CHOICES) as Friends[];
  const group = h("div", { class: "seg friends-choice", role: "radiogroup", "aria-labelledby": "switch-friends-label", "aria-describedby": "switch-friends-note" });
  for (const id of order) {
    const key = h("button", { class: "seg-btn", type: "button", role: "radio", "aria-checked": "false", "data-friends": id }, FRIENDS_CHOICES[id].name);
    key.addEventListener("click", () => void choose(id));
    key.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = order[(order.indexOf(id) + step + order.length) % order.length];
      friendsKeys.get(next)!.focus();
      void choose(next);
    });
    friendsKeys.set(id, key);
    group.append(key);
  }
  card.append(h("div", { class: "switch-row friends-row" }, h("div", { class: "switch-head" }, h("span", { class: "switch-title", id: "switch-friends-label" }, FRIENDS_TITLE), group), friendsNote, friendsStatus));
  draw();
  return card;
}
