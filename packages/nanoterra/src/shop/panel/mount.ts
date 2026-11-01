// The Looks key and the shop's sheet: `mountShop(element, options)`. Plain DOM, no framework, no Three.js. The sheet holds the looks (wear or buy) and,
// after Buy, the pay sheet of the order. It talks to the shop's routes ("@nano133/nanoterra/shop", `base`), and to the game only through its hooks:
//
//   owned()      the looks the player owns (the game's GET /api/me gives them)    signedIn()  whether a player is signed in
//   signIn()     the game's own sign-in (the kit's sign-in path, or the game's): true when the player is signed in after it. The shop draws no sign-in.
//   worn/wear    what the player wears; `onOwned(lookId)` when a paid order gave a look (wear it)
//   onSignInCancel(lookId)  the game's own Buy (`buy(lookId)`) asked for a sign-in and the player closed it: the game shows its own sheet again
//
// `key: false` draws no key: the game opens the sheet from its own key with `open()`, as the options panel allows. `buy(lookId)` starts on the next frame:
// a game's own <dialog> that closed just before has had its `close` event by then (Chromium fires it at the frame), so its handler cannot take the focus.
// The sheet is a <dialog>: it rises from the bottom on a phone held upright and stands in the middle on a wide screen; on a phone held sideways the pay
// sheet puts the QR code beside the words. Phone first: text 16 px, every key 48 px or more each way.
//
// `words` changes any word of the two sheets (./words.ts: SHOP_WORDS are the defaults), for a game's own words or language.

import { ApiError, createApi } from "../../admin/panel/api.js";
import { h, releaseFocus } from "../../admin/panel/dom.js";
import { icon } from "../../admin/panel/icons.js";
import { checkLooks, wearOf, type Look } from "../../looks/look.js";
import type { PayView } from "../handler.js";
import { looksView, slotsOf, type SlotWords } from "./looks.js";
import { payPanel } from "./pay.js";
import { shopWords, type ShopWords } from "./words.js";

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
  /**
   * The game's own Buy (`buy(lookId)`) asked for a sign-in, and the player closed it without signing in: the game shows its own looks sheet again.
   * The kit's list does not open then (the kit's sheet closes if it was open). A Buy in the kit's own list goes back to that list, as before.
   */
  onSignInCancel?: (lookId: string, look: Look) => void;
  /**
   * The server refused an order with 401: the player's session ended, though `signedIn()` said yes. The game marks the player signed out. The sheet's
   * "Sign in" key then calls `signIn()` without asking `signedIn()` first, so a stale "yes" cannot post the same refused order again.
   */
  onSessionEnd?: () => void;
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
  /** The sheet's title. Default: `words.title` ("Looks"). */
  title?: string;
  /** The game's words for the two sheets, over the defaults (SHOP_WORDS): `{ buyTitle: (look) => look, sendExactly: "Pay exactly" }`. */
  words?: Partial<ShopWords>;
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
  /**
   * Opens the sheet on Buy for one look (the game's own "Buy" elsewhere), on the next frame: close the game's own <dialog> first. A sign-in closed
   * without a sign-in calls `onSignInCancel` and opens nothing.
   */
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
  const words = shopWords(options.words);
  const sheetTitle = options.title ?? words.title;

  const title = h("h2", { class: "n133s-title", tabindex: "-1" });
  const closeKey = h("button", { class: "n133s-close", type: "button", "aria-label": words.close }, icon("close", 20));
  const body = h("div", { class: "n133s-body" });
  const dialog = h("dialog", { class: "n133s-sheet", "aria-label": sheetTitle }, h("header", { class: "n133s-head" }, title, closeKey), body);
  const key = options.key === false ? null : h("button", { class: "n133s-key", type: "button", "aria-haspopup": "dialog" }, icon("shirt", 20), h("span", { class: "n133s-key-word" }, sheetTitle));
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
      sheetTitle,
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
        buy: (l) => void buy(l, false),
        picture: options.picture,
        slots: options.slots,
        words,
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
    h("div", { class: "n133s-message" }, h("p", { class: "n133s-status" }, message), extra ?? null, h("button", { class: "n133s-btn n133s-wide", type: "button", onclick: () => showLooks() }, words.back));

  /**
   * `game`: the game's own Buy started it (`buy(lookId)`), not the kit's list: a closed sign-in goes back to the game, not to the list.
   * `ended`: the server said the session ended (401): sign in again whatever `signedIn()` says.
   */
  async function buy(look: Look, game: boolean, ended = false) {
    if (destroyed) return;
    tab = slotsOf(looks).length > 1 ? wearOf(look) : undefined;
    if (ended || !options.signedIn()) {
      if (!options.signIn) return show(words.buyTitle(look.name), back(words.signInFirst));
      let ok = false;
      try {
        ok = await options.signIn();
      } catch {
        ok = false;
      }
      if (!ok || !options.signedIn()) {
        if (!game) return showLooks();
        close();
        return options.onSignInCancel?.(look.id, look);
      }
    }
    const box = h("div", { class: "n133s-turnstile", hidden: true });
    show(words.buyTitle(look.name), h("div", {}, h("p", { class: "n133s-status" }, words.making), box));
    try {
      const turnstile = options.personCheck ? await options.personCheck(box) : null;
      const order = await api.post<PayView>("", { lookId: look.id, turnstile });
      if (destroyed) return;
      const pay = payPanel(order, {
        lookName: look.name,
        check: (id) => api.post<PayView>(`/${id}/check`),
        errorText: (e) => (e instanceof ApiError ? words.refusal(e.message, e.status) : null),
        words,
        onPaid: () => {
          bought.add(look.id);
          options.onOwned?.(look.id, look);
        },
      });
      show(words.buyTitle(look.name), pay.node);
      stopPay = pay.stop;
    } catch (e) {
      const message = e instanceof ApiError ? words.refusal(e.message, e.status) : e instanceof Error && e.message ? words.refusal(e.message, 0) : words.orderFailed;
      const gone = e instanceof ApiError && e.status === 401;
      if (gone) options.onSessionEnd?.();
      const again = gone && options.signIn ? h("button", { class: "n133s-btn n133s-primary n133s-wide", type: "button", onclick: () => void buy(look, game, true) }, words.signIn) : null;
      show(words.buyTitle(look.name), back(message, again));
    }
  }

  return {
    open: showLooks,
    close,
    buy(lookId) {
      const look = looks.find((l) => l.id === lookId);
      // On the next frame (rAF; a hidden page has none): a <dialog> of the game's that closed just before has had its `close` event by then.
      if (!look) return;
      const go = () => void buy(look, true);
      if (typeof requestAnimationFrame === "function" && !globalThis.document?.hidden) requestAnimationFrame(go);
      else setTimeout(go, 0);
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
