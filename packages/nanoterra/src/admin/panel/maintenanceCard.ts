// The "Maintenance" card of /admin (the Settings tab, first): one switch, "Under maintenance". A press saves at once on the game's own server (POST
// {api}/game { maintenance }), so the game's site shows players "Back soon" at once ("@nano133/nanoterra/maintenance"); the server then tells
// nano133.com. The card says whether nano133.com was told. While it was not, the card tells it again by itself every 30 seconds (at most 10 times while
// the page is open), and "Tell Nanoterra again" does it now: a press of the state the game already has. No silent mismatch: the card always says.

import { MAINTENANCE_CARD, type GameState, type MaintenanceState } from "../switches.js";
import { ApiError, type Api } from "./api.js";
import { h } from "./dom.js";

/** How often the card tells nano133.com again while it was not told, and how many times at most while the page is open. */
export const RETELL_MS = 30_000;
export const RETELL_MAX = 10;

export type MaintenanceCard = { el: HTMLElement; set(state: GameState): void };

/** The card for the settings `initial`. `onChange` hears each saved state (the top bar shows "Under maintenance" too). */
export function maintenanceCard(api: Api, initial: GameState, onChange?: (state: GameState) => void): MaintenanceCard {
  let state = initial;
  let busy = false;
  let retells = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const W = MAINTENANCE_CARD;
  /** The state now (the panel makes the card only for a state that has it). */
  const ms = (): MaintenanceState => state.maintenance ?? { on: false, at: null, told: true, canTell: false };
  const label = h("span", { class: "switch-title", id: "switch-maintenance-label" }, W.switchTitle);
  const button = h(
    "button",
    { class: "switch", type: "button", role: "switch", "aria-checked": "false", "aria-labelledby": "switch-maintenance-label", "aria-describedby": "switch-maintenance-note" },
    h("span", { class: "switch-word" }, "Off"),
    h("span", { class: "switch-knob", "aria-hidden": "true" }),
  );
  const sentence = h("p", { class: "switch-note", id: "switch-maintenance-note" });
  const told = h("p", { class: "maint-told", role: "status", "aria-live": "polite" });
  const why = h("span", { class: "fine maint-why" });
  const again = h("button", { class: "btn btn-small", type: "button" }, W.retry);
  const status = h("span", { class: "fine", role: "status", "aria-live": "polite" });
  const el = h(
    "section",
    { class: "admin-card maint-card", "aria-labelledby": "maint-title" },
    h("div", { class: "card-head" }, h("h2", { id: "maint-title" }, W.title)),
    h("div", { class: "switch-row" }, h("div", { class: "switch-head" }, label, button), sentence, told, h("div", { class: "maint-again" }, why, again), status),
  );

  const draw = () => {
    const m = ms();
    button.setAttribute("aria-checked", m.on ? "true" : "false");
    button.classList.toggle("switch-on", m.on);
    button.querySelector(".switch-word")!.textContent = m.on ? "On" : "Off";
    sentence.textContent = m.on ? W.on : W.off;
    el.classList.toggle("is-on", m.on);
    const cannot = m.canTell === false && m.at !== null;
    told.textContent = cannot ? W.cannotTell : m.told ? W.told : W.notTold;
    told.classList.toggle("is-warn", cannot || !m.told);
    // Never pressed: nothing to tell, so the line stays quiet.
    told.hidden = m.at === null;
    why.textContent = !m.told && m.error ? m.error : "";
    again.hidden = m.told || m.canTell === false;
  };

  const schedule = () => {
    clearTimeout(timer);
    if (ms().told || ms().canTell === false || retells >= RETELL_MAX) return;
    timer = setTimeout(() => {
      // A card that left the page (a new sign-in builds a new panel) tells nothing more.
      if (!el.isConnected) return;
      retells++;
      void retell(true);
    }, RETELL_MS);
    // In Node (a test of the panel) the wait never holds the process open; a browser has no `unref`.
    (timer as { unref?: () => void }).unref?.();
  };

  async function send(to: "on" | "off", quiet = false) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    again.disabled = true;
    status.textContent = quiet ? W.retrying : "Saving…";
    try {
      state = await api.post<GameState>("/game", { maintenance: to });
      status.textContent = quiet ? "" : "Saved.";
      onChange?.(state);
    } catch (e) {
      status.textContent = e instanceof ApiError ? e.message : "The game's server did not answer. Nothing was changed.";
    } finally {
      busy = false;
      button.disabled = false;
      again.disabled = false;
      draw();
      schedule();
    }
  }

  /**
   * Tells nano133.com again: a press of the state the game has NOW. The card reads the server's state first: another tab (or another device) may have
   * pressed since this card last drew, and a retry of the state this card still shows would turn that press back. A newer press, or one that was told,
   * is only drawn.
   */
  async function retell(quiet = false) {
    if (busy) return;
    const seen = ms().at;
    let now: GameState;
    try {
      now = await api.get<GameState>("/game");
    } catch {
      return void send(ms().on ? "on" : "off", quiet);
    }
    if (now.maintenance && (now.maintenance.at !== seen || now.maintenance.told)) {
      state = now;
      onChange?.(state);
      draw();
      schedule();
      return;
    }
    await send(ms().on ? "on" : "off", quiet);
  }

  button.addEventListener("click", () => void send(ms().on ? "off" : "on"));
  again.addEventListener("click", () => {
    retells = 0;
    void retell();
  });
  draw();
  // A page opened while Nanoterra was not told starts its tries.
  schedule();
  return {
    el,
    set(next) {
      state = next;
      draw();
      schedule();
    },
  };
}
