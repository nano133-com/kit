// The Looks key and the shop's sheet: `mountShop(element, options)`. Plain DOM, no framework, no Three.js. The sheet holds the looks (wear or buy) and,
// after Buy, the pay sheet of the order. It talks to the shop's routes ("@nano133/nanoterra/shop", `base`), and to the game only through its hooks:
//
//   owned()      the looks the player owns (the game's GET /api/me gives them)    signedIn()  whether a player is signed in
//   signIn()     the game's own sign-in (the kit's sign-in path, or the game's): true when the player is signed in after it. The shop draws no sign-in.
//   worn/wear    what the player wears; `onOwned(lookId)` when a paid order gave a look (wear it)
//
// `key: false` draws no key: the game opens the sheet from its own key with `open()`, as the options panel allows. The sheet is a <dialog>: it rises from
// the bottom on a phone held upright and stands in the middle on a wide screen; on a phone held sideways the pay sheet puts the QR code beside the words.

import { ApiError, createApi } from "../../admin/panel/api.js";
import { h, releaseFocus } from "../../admin/panel/dom.js";
import { icon } from "../../admin/panel/icons.js";
import { checkLooks, wearOf, type Look } from "../../looks/look.js";
import type { PayView } from "../handler.js";
import { looksView, slotsOf, type SlotWords } from "./looks.js";
import { payPanel } from "./pay.js";

export type ShopMountOptions = {
  /** The game's looks (looks.json as it was read). The server decides every price; these are for the list. */
  looks: unknown;
  /** Where the shop's routes are. Default "/api/orders" (the starter's). */
  base?: string;
  /** The ids of the looks the player owns (free looks need not be listed). Read each time the sheet draws. */
  owned(): readonly string[];
  signedIn(): boolean;
  /** The game's sign-in: true when a player is signed in after it. With none, Buy asks the player to sign in and stops. */
  signIn?: () => Promise<boolean>;
  /** Whether the player wears this look now. */
  worn(look: Look): boolean;
  /** Wear a look the player owns. */
  wear(look: Look): void;
  /** Take off the item of a wear slot (back to the plain tool, or none). */
  takeOff?: (slot: string) => void;
  /** A paid order gave this look: the game adds it to the player's looks (and wears it). */
  onOwned?: (lookId: string, look: Look) => void;
  /** The person check (Turnstile): draws the check in `box` and gives its token, or null when the game has none. */
  personCheck?: (box: HTMLElement) => Promise<string | null>;
  /** The game's own picture of a look, or null for the kit's swatch. */
  picture?: (look: Look) => HTMLElement | null;
  /** Words for the tabs of the wear slots. */
  slots?: Record<string, SlotWords>;
  /** The sheet's title. Default "Looks". */
  title?: string;
  /** Draw the Looks key. Default true; false: the game calls `open()` from its own key. */
  key?: boolean;
  /** "light", "dark", or "device" (the default): the page's `data-n133-theme` when it has one, else the device's setting. */
  theme?: "light" | "dark" | "device";
  onOpen?: () => void;
  onClose?: () => void;
  /** Where the keyboard focus goes when the sheet closes: "game" (the default: out of the sheet, to the page) or "key". */
  focusAfterClose?: "game" | "key";
  /** The `fetch` to use (default: the page's). */
  fetch?: typeof fetch;
};

export type MountedShop = {
  /** Opens the sheet on the looks. */
  open(): void;
  close(): void;
  /** Opens the sheet on Buy for one look (the game's own "Buy" elsewhere). */
  buy(lookId: string): void;
  /** Draws the looks again (after the player signed in, or wore something). */
  refresh(): void;
  readonly isOpen: boolean;
  /** Removes the key and the sheet, and stops every timer. */
  destroy(): void;
};

export function mountShop(root: HTMLElement, options: ShopMountOptions): MountedShop {
  const looks = checkLooks(options.looks);
  const api = createApi(options.base ?? "/api/orders", options.fetch);
  const bought = new Set<string>();
  let tab: string | undefined;
  let stopPay: (() => void) | null = null;
  let destroyed = false;
  const cleanup: (() => void)[] = [];

  const title = h("h2", { class: "n133s-title", tabindex: "-1" });
  const closeKey = h("button", { class: "n133s-close", type: "button", "aria-label": "Close" }, icon("close", 20));
  const body = h("div", { class: "n133s-body" });
  const dialog = h("dialog", { class: "n133s-sheet", "aria-label": options.title ?? "Looks" }, h("header", { class: "n133s-head" }, title, closeKey), body);
  const key = options.key === false ? null : h("button", { class: "n133s-key", type: "button", "aria-haspopup": "dialog" }, icon("shirt", 20), h("span", { class: "n133s-key-word" }, options.title ?? "Looks"));
  const wrap = h("div", { class: "n133-shop" }, key, dialog);
  root.append(wrap);

  // The theme: the game's word, or the page's (data-n133-theme), or the device's setting.
  let media: MediaQueryList | null = null;
  try {
    media = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(prefers-color-scheme: dark)") : null;
  } catch {
    media = null;
  }
  const drawTheme = () => {
    const want = options.theme ?? "device";
    const page = globalThis.document?.documentElement?.getAttribute("data-n133-theme");
    const dark = want === "device" ? (page === "dark" || page === "light" ? page === "dark" : media?.matches === true) : want === "dark";
    wrap.setAttribute("data-theme", dark ? "dark" : "light");
  };
  drawTheme();
  media?.addEventListener?.("change", drawTheme);
  cleanup.push(() => media?.removeEventListener?.("change", drawTheme));

  const isOpen = () => dialog.open || dialog.hasAttribute("open");
  const stopTimers = () => {
    stopPay?.();
    stopPay = null;
  };
  const show = (heading: string, content: Node) => {
    stopTimers();
    title.textContent = heading;
    body.replaceChildren(content);
    body.scrollTop = 0;
    if (!isOpen()) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      // The first focus is on the title (a screen reader reads it), not on the close key: a ring on Close at every open draws the eye from the looks.
      title.focus();
      key?.setAttribute("aria-expanded", "true");
      options.onOpen?.();
    }
  };
  const closed = () => {
    stopTimers();
    key?.setAttribute("aria-expanded", "false");
    options.onClose?.();
    if (options.focusAfterClose === "key" && key) key.focus();
    else releaseFocus(wrap);
  };
  const close = () => {
    if (!isOpen()) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else {
      dialog.removeAttribute("open");
      closed();
    }
  };
  dialog.addEventListener("close", closed);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });
  closeKey.addEventListener("click", close);
  key?.addEventListener("click", () => (isOpen() ? close() : showLooks()));

  const ownedNow = () => new Set([...options.owned(), ...bought]);

  function showLooks() {
    if (destroyed) return;
    show(
      options.title ?? "Looks",
      looksView({
        looks,
        owned: ownedNow(),
        signedIn: options.signedIn(),
        worn: options.worn,
        wear: (l) => {
          options.wear(l);
          showLooks();
        },
        takeOff: options.takeOff
          ? (slot) => {
              options.takeOff!(slot);
              showLooks();
            }
          : undefined,
        buy: (l) => void buy(l),
        picture: options.picture,
        slots: options.slots,
        tab,
        onTab: (s) => {
          tab = s;
          showLooks();
          body.querySelector<HTMLElement>('.n133s-tab[aria-selected="true"]')?.focus();
        },
      }),
    );
  }

  const back = (message: string, extra?: HTMLElement | null) =>
    h("div", { class: "n133s-message" }, h("p", { class: "n133s-status" }, message), extra ?? null, h("button", { class: "n133s-btn n133s-wide", type: "button", onclick: () => showLooks() }, "Back to looks"));

  async function buy(look: Look) {
    if (destroyed) return;
    tab = slotsOf(looks).length > 1 ? wearOf(look) : undefined;
    if (!options.signedIn()) {
      if (!options.signIn) return show(`Buy ${look.name}`, back("To buy a look, sign in with Nano first: your looks belong to your Nano address."));
      let ok = false;
      try {
        ok = await options.signIn();
      } catch {
        ok = false;
      }
      if (!ok || !options.signedIn()) return showLooks();
    }
    const box = h("div", { class: "n133s-turnstile", hidden: true });
    show(`Buy ${look.name}`, h("div", {}, h("p", { class: "n133s-status" }, "Making your order…"), box));
    try {
      const turnstile = options.personCheck ? await options.personCheck(box) : null;
      const order = await api.post<PayView>("", { lookId: look.id, turnstile });
      if (destroyed) return;
      const pay = payPanel(order, {
        lookName: look.name,
        check: (id) => api.post<PayView>(`/${id}/check`),
        errorText: (e) => (e instanceof ApiError ? e.message : null),
        onPaid: () => {
          bought.add(look.id);
          options.onOwned?.(look.id, look);
        },
      });
      show(`Buy ${look.name}`, pay.node);
      stopPay = pay.stop;
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : "The order did not start. Try again.";
      const again = e instanceof ApiError && e.status === 401 && options.signIn ? h("button", { class: "n133s-btn n133s-primary n133s-wide", type: "button", onclick: () => void buy(look) }, "Sign in") : null;
      show(`Buy ${look.name}`, back(message, again));
    }
  }

  return {
    open: showLooks,
    close,
    buy(lookId) {
      const look = looks.find((l) => l.id === lookId);
      if (look) void buy(look);
    },
    refresh() {
      if (isOpen() && body.querySelector(".n133s-looks-view")) showLooks();
    },
    get isOpen() {
      return isOpen();
    },
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      stopTimers();
      for (const fn of cleanup.splice(0)) fn();
      wrap.remove();
    },
  };
}
