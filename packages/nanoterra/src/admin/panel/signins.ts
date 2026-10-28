// The "Sign-ins" card of /admin: the last admin sign-ins (when, the rough country, a short browser name) and "Sign out everywhere". It shows only what the store gave for a
// sign-in: the three things of `AdminLogin`. The sign-out is two presses, so that one slip does not end every login.

import type { AdminSummary } from "../store.js";
import { ApiError, type Api } from "./api.js";
import { h } from "./dom.js";

/** What the card says about what is kept, unless the game says its own (its retention). */
export const DEFAULT_LOGINS_NOTE = "For each sign-in only the time, the rough country and a short browser name are kept: no address and no full browser text.";

/** "United States (US)", or "US" when the name is not known, or "unknown country". */
function countryText(code: string | null): string {
  if (!code) return "unknown country";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

/** The card, or null when the store lists no sign-ins and cannot sign out. `done` runs after a sign-out everywhere (the panel loads again and asks for a sign-in). */
export function signinsCard(s: AdminSummary, api: Api, done: () => void, note: string = DEFAULT_LOGINS_NOTE): HTMLElement | null {
  if (!s.logins && !s.canSignOutEverywhere) return null;
  const card = h("section", { class: "admin-card signins", "aria-labelledby": "signins-title" }, h("h2", { id: "signins-title" }, "Sign-ins"));
  if (s.logins) {
    card.append(h("p", { class: "fine" }, "The last sign-ins to this admin, newest first. If one is not yours, press Sign out everywhere."));
    const list = h("ul", { class: "signin-list" });
    for (const l of s.logins) list.append(h("li", {}, h("strong", {}, new Date(l.at).toLocaleString()), h("span", {}, ` · ${countryText(l.country)} · ${l.browser}`)));
    if (!s.logins.length) list.append(h("li", { class: "fine" }, "No sign-in is listed yet."));
    card.append(list, h("p", { class: "fine" }, note));
  }
  if (s.canSignOutEverywhere) {
    const box = h("div", { class: "signout-box" });
    const status = h("span", { class: "fine", role: "status" });
    const first = h("button", { class: "btn", type: "button" }, "Sign out everywhere");
    const confirm = h("div", { class: "signout-confirm" });
    confirm.hidden = true;
    const yes = h("button", { class: "btn btn-primary", type: "button" }, "Yes, sign out everywhere");
    const cancel = h("button", { class: "btn", type: "button" }, "Cancel");
    confirm.append(h("p", {}, "This ends every admin sign-in, in every browser, this one too. You will sign in again."), yes, " ", cancel);
    first.addEventListener("click", () => {
      first.hidden = true;
      confirm.hidden = false;
      status.textContent = "";
    });
    cancel.addEventListener("click", () => {
      confirm.hidden = true;
      first.hidden = false;
    });
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      cancel.disabled = true;
      status.textContent = "Signing out…";
      try {
        await api.post("/signout-all");
        done();
      } catch (e) {
        status.textContent = e instanceof ApiError ? e.message : "The game's server did not answer. Nothing was changed.";
        yes.disabled = false;
        cancel.disabled = false;
      }
    });
    box.append(first, confirm, status);
    card.append(box);
  }
  return card;
}
