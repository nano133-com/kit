// The owner's passkeys in the browser (since 0.12.0): the "Passkey" way of the admin's sign-in, and the "Owner passkeys" card for /admin (`ownerPasskeys()`,
// a card for `mountAdmin`'s `cards`). A passkey is only a key to /admin: the money stays in the owner's wallet.
//
//   - Sign in: the passkey purse (the game's FROZEN scheme, the player sheet's) signs "ADMIN of <host>: sign in as <address> at <ms>"; the server lets it in
//     only while the passkey is linked to the game's address.
//   - Add: only with a WALLET admin session. A new passkey is made (or one the owner has is used), and it signs "Link this passkey to the ADMIN of <host>:
//     ...": the server writes the link only with both proofs, the wallet session and this signature.
//   - Remove: only with a wallet admin session; the passkey's admin sessions end too.
//
// The passkey code (@nano133/signin/passkey) and the purse's signing code (@nano133/signin/purse) are loaded only when a passkey is used: a game without
// passkeys never loads them. The seed lives in local variables of one press only: never in storage, a log, an error text or an address.

import type { NewPasskey, PasskeyScheme, PasskeySetup } from "@nano133/signin/passkey";
import { ApiError, createApi, type Api } from "../../admin/panel/api.js";
import { h, shortAddress } from "../../admin/panel/dom.js";
import { icon } from "../../admin/panel/icons.js";
import type { AdminCard } from "../../admin/panel/card.js";
import { checkScheme } from "../../player-signin/scheme-check.js";
import { ADMIN_SIGNIN_BASE, adminLinkDomain, adminPasskeyDomain, type AdminPasskey } from "../types.js";

export type AdminPasskeyOptions = {
  /** The game's FROZEN passkey scheme: the same one the player sheet takes (see "/player-signin": checkScheme, schemeVector). */
  scheme: PasskeyScheme;
  /** The game's name: the device shows it next to a new passkey ("Coin Bees admin · 1 Nov 2026"). */
  name: string;
  /** The passkeys' relying party id: the game's domain. Default: the page's host name. */
  rpId?: string;
  /** Where the admin sign-in's routes are. Default "/api/admin-signin" (ADMIN_SIGNIN_BASE). */
  base?: string;
  /** The `fetch` to use (default: the page's). */
  fetch?: typeof fetch;
};

/** The answer of `POST {base}/passkeys` (and of a link or a removal). */
export type PasskeyList = { passkeys: AdminPasskey[]; limit: number; via: string; canChange: boolean; you: string };

/** What the owner reads when a passkey prompt fails, by the fault's code (@nano133/signin/passkey's PasskeyFault). */
export function passkeyFaultText(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const name = (e as { name?: unknown } | null)?.name;
  const c = typeof code === "string" ? code : name === "NotAllowedError" || name === "AbortError" ? "cancelled" : name === "SecurityError" ? "wrong-host" : name === "NotSupportedError" ? "unsupported" : name === "InvalidStateError" ? "exists" : "failed";
  if (c === "cancelled") return "The passkey was closed. Try again.";
  if (c === "no-prf" || c === "other-form" || c === "unsupported") return "This browser or device cannot use a passkey here. Use your wallet.";
  if (c === "not-a-purse") return "That passkey is not one of this game's. Choose another one.";
  if (c === "wrong-host") return "A passkey works only on the game's own address.";
  if (c === "exists") return "This device has a passkey for this game already. Press Use a passkey I have.";
  return "The passkey did not work. Try again.";
}

const dayText = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function setupOf(o: AdminPasskeyOptions): PasskeySetup {
  return { rpId: o.rpId ?? location.hostname, rpName: o.name, scheme: o.scheme, userName: `${o.name} admin · ${dayText(Date.now())}`, exclude: [] };
}

const apiOf = (o: Pick<AdminPasskeyOptions, "base" | "fetch">): Api => createApi(o.base ?? ADMIN_SIGNIN_BASE, o.fetch ?? ((...a) => fetch(...a)));

/**
 * Signs in to /admin with a linked passkey: the device asks for the passkey, the purse signs the ADMIN text, the server checks the link. Resolves with the
 * passkey's address; throws an ApiError (the server's words) or a passkey fault (`passkeyFaultText`).
 */
export async function passkeyAdminSignIn(o: AdminPasskeyOptions & { turnstile?: string | null; signal?: AbortSignal }): Promise<{ address: string; linkedTo: string }> {
  checkScheme(o.scheme);
  const { openPasskey } = await import("@nano133/signin/passkey");
  const p = await openPasskey(setupOf(o), o.signal);
  const { signinBody } = await import("@nano133/signin/purse");
  return apiOf(o).post<{ address: string; linkedTo: string }>("/passkey", { ...signinBody(adminPasskeyDomain(location.host), p.seed), ...(o.turnstile ? { turnstile: o.turnstile } : {}) });
}

/**
 * The "Owner passkeys" card for /admin: the passkeys linked to the game's address, "Add a passkey" and Remove (both only with a wallet sign-in). Give it to
 * `mountAdmin`'s `cards`; it reads the list each time the owner signs in.
 *
 *   mountAdmin(el, { looks, signIn: adminSignIn({ passkeys: true, scheme, name }), signOut: adminSignOut(), cards: [ownerPasskeys({ scheme, name })] });
 */
export function ownerPasskeys(options: AdminPasskeyOptions): AdminCard {
  checkScheme(options.scheme);
  const api = apiOf(options);
  let list: PasskeyList | null = null;
  let prompt: AbortController | null = null;

  const status = h("p", { class: "fine passkey-status", role: "status", "aria-live": "polite" });
  const items = h("ul", { class: "signin-list passkey-list" });
  const note = h("p", { class: "fine" });
  const add = h("div", { class: "passkey-add" });
  const el = h(
    "section",
    { class: "admin-card owner-passkeys", "aria-labelledby": "n133-passkeys-title" },
    h("h2", { id: "n133-passkeys-title" }, "Owner passkeys"),
    h("p", { class: "fine" }, "A passkey opens this admin page with Face ID, Touch ID or your device PIN, without your wallet. It cannot move money: your money stays in your wallet."),
    items,
    note,
    add,
    status,
  );
  el.hidden = true;

  const say = (text: string) => (status.textContent = text);
  const key = (text: string, onclick: () => void, kind: "primary" | "plain" = "plain") => h("button", { class: `btn${kind === "primary" ? " btn-primary" : ""}`, type: "button", onclick }, text);
  const busy = (on: boolean) => {
    for (const b of Array.from(el.querySelectorAll("button"))) b.disabled = on;
    el.toggleAttribute("aria-busy", on);
  };
  const words = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : e && typeof e === "object" && ("code" in e || "name" in e) ? passkeyFaultText(e) : fallback);

  function draw() {
    if (!list) return;
    const l = list;
    items.replaceChildren(
      ...l.passkeys.map((p) => {
        const row = h("li", { class: "passkey-row" });
        const what = h("span", { class: "passkey-what" }, icon("key", 18), h("strong", {}, h("code", { title: p.address }, shortAddress(p.address))), h("span", {}, ` · added ${dayText(p.createdAt)}`), p.address === l.you && l.via === "passkey" ? h("span", { class: "chip" }, "This passkey") : null);
        row.append(what);
        if (l.canChange) row.append(key("Remove", () => confirmRemove(row, p.address)));
        return row;
      }),
    );
    if (!l.passkeys.length) items.append(h("li", { class: "fine" }, "No passkey is linked yet."));
    note.textContent = l.canChange ? `You can link up to ${l.limit} passkeys. Each one proves its key when you add it.` : "You signed in with a passkey. Sign in with your wallet to add or remove a passkey.";
    showAdd();
  }

  function showAdd() {
    if (!list?.canChange) return add.replaceChildren();
    const full = list.passkeys.length >= list.limit;
    const b = key("Add a passkey", () => chooseAdd(), "primary");
    b.disabled = full;
    add.replaceChildren(b, full ? h("p", { class: "fine" }, `You have ${list.limit} passkeys. Remove one to add another.`) : "");
  }

  function chooseAdd() {
    say("");
    add.replaceChildren(
      h("p", {}, "Make a new passkey on this device, or use a passkey you have for this game."),
      h("div", { class: "passkey-keys" }, key("Make a new passkey", () => void makeNew(), "primary"), key("Use a passkey I have", () => void useMine()), key("Cancel", () => showAdd())),
    );
    add.querySelector("button")?.focus({ preventScroll: true });
  }

  /** Links the passkey of `seed`: it signs the LINK text, and the server writes the link with this wallet session. */
  async function linkSeed(seed: string) {
    const { signinBody } = await import("@nano133/signin/purse");
    list = await api.post<PasskeyList>("/passkey/link", signinBody(adminLinkDomain(location.host), seed));
    draw();
    say("Passkey added. It opens this admin page from now on.");
  }

  async function makeNew() {
    busy(true);
    say("Making a passkey… Follow your device.");
    prompt = new AbortController();
    try {
      const pk = await import("@nano133/signin/passkey");
      const made = await pk.makePasskey(setupOf(options), prompt.signal);
      await firstOpen(made, false);
    } catch (e) {
      busy(false);
      showAdd();
      say(words(e, "The passkey was not added. Try again."));
    }
  }

  /** The first use of a new passkey gives its seed. Where the browser allows one prompt per press, one more key finishes it. */
  async function firstOpen(made: NewPasskey, pick: boolean): Promise<void> {
    busy(true);
    say("Opening the new passkey…");
    prompt = new AbortController();
    const pk = await import("@nano133/signin/passkey");
    try {
      const p = await pk.firstUse(setupOf(options), made, prompt.signal, pick);
      await linkSeed(p.seed);
      busy(false);
    } catch (e) {
      busy(false);
      const code = (e as { code?: unknown } | null)?.code;
      if (code !== "cancelled" && code !== "failed") throw e;
      add.replaceChildren(h("p", {}, "Your passkey is made. Open it once to add it."), h("div", { class: "passkey-keys" }, key("Open the new passkey", () => void firstOpen(made, true).catch(fault), "primary"), key("Cancel", () => showAdd())));
      say("");
    }
  }

  function fault(e: unknown) {
    busy(false);
    showAdd();
    say(words(e, "The passkey was not added. Try again."));
  }

  async function useMine() {
    busy(true);
    say("Waiting for your passkey…");
    prompt = new AbortController();
    try {
      const pk = await import("@nano133/signin/passkey");
      const p = await pk.openPasskey(setupOf(options), prompt.signal);
      await linkSeed(p.seed);
      busy(false);
    } catch (e) {
      fault(e);
    }
  }

  function confirmRemove(row: HTMLElement, address: string) {
    const keys = h(
      "div",
      { class: "passkey-confirm" },
      h("p", {}, "Remove this passkey? It cannot open this page any more, and its sign-ins end now."),
      key("Yes, remove", () => void remove(address), "primary"),
      key("Cancel", () => draw()),
    );
    row.replaceChildren(row.firstChild!, keys);
    keys.querySelector("button")?.focus({ preventScroll: true });
  }

  async function remove(address: string) {
    busy(true);
    say("Removing…");
    try {
      list = await api.post<PasskeyList>("/passkey/unlink", { address });
      busy(false);
      draw();
      say("Passkey removed.");
    } catch (e) {
      busy(false);
      draw();
      say(words(e, "The game's server did not answer. Nothing was changed."));
    }
  }

  async function refresh(): Promise<void> {
    prompt?.abort();
    prompt = null;
    try {
      list = await api.post<PasskeyList>("/passkeys");
      el.hidden = false;
      say("");
      draw();
    } catch {
      // No passkeys on this game (the route is off), or no session that may read them: the card does not show.
      list = null;
      el.hidden = true;
    }
  }

  return { el, refresh };
}
