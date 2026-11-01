// The sign-in sheet of a game: `mountPlayerSignin(element, options)`. It draws no key of its own: the game's account key, the shop's "sign in
// first" and anything else call `open()`, which resolves with the player once they are signed in, or null when the sheet closes. Plain DOM; a
// modal sheet with a scrim: from the bottom on a phone held upright, in the middle on a wide or sideways screen. Escape, the close key and a press
// on the scrim close it. Every key is 44 px or more.

import { h, releaseFocus } from "../../admin/panel/dom.js";
import { icon } from "../../admin/panel/icons.js";
import { signInView, type PlayerSigninViewOptions, type SignedIn } from "./view.js";

export type PlayerSigninMountOptions = PlayerSigninViewOptions & {
  /** The sheet's title. Default "Sign in". */
  title?: string;
  /** How long "Signed in as …" shows before the sheet closes, in ms. Default 900. */
  closeAfterMs?: number;
  /**
   * Where the keyboard focus goes when the sheet closes. "game" (the default): out of the sheet, to the page, so the game's keys reach the game. "back":
   * to the element that had it when the sheet opened (a page with keys of its own).
   */
  focusAfterClose?: "game" | "back";
};

export type MountedPlayerSignin = {
  /** Opens the sheet. Resolves with the player when they sign in, or null when the sheet closes first. A second call while it is open gets the same promise. */
  open(): Promise<SignedIn | null>;
  close(): void;
  readonly isOpen: boolean;
  /** Removes the sheet and stops every wait. */
  destroy(): void;
};

let mounts = 0;

export function mountPlayerSignin(root: HTMLElement, options: PlayerSigninMountOptions): MountedPlayerSignin {
  const n = ++mounts;
  let isOpen = false;
  let pending: { promise: Promise<SignedIn | null>; resolve: (p: SignedIn | null) => void } | null = null;
  let before: Element | null = null;
  let closing: ReturnType<typeof setTimeout> | undefined;

  const settle = (p: SignedIn | null) => {
    const was = pending;
    pending = null;
    was?.resolve(p);
  };

  const view = signInView({
    ...options,
    onSignedIn(player) {
      options.onSignedIn?.(player);
      settle(player);
      closing = setTimeout(close, Math.max(0, options.closeAfterMs ?? 900));
    },
  });

  const titleEl = h("h2", { class: "n133s-title", id: `n133s-title-${n}` }, options.title ?? "Sign in");
  const closeKey = h("button", { class: "n133s-close", type: "button", "aria-label": "Close" }, icon("close", 20));
  const scrim = h("div", { class: "n133s-scrim" });
  const panel = h("section", { class: "n133s-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": `n133s-title-${n}` }, h("header", { class: "n133s-head" }, titleEl, closeKey), h("div", { class: "n133s-body" }, view.node));
  const wrap = h("div", { class: "n133-signin n133s-sheet", "data-open": "false" }, scrim, panel);
  wrap.hidden = true;
  root.append(wrap);

  function close() {
    if (closing) clearTimeout(closing);
    closing = undefined;
    if (!isOpen) return;
    isOpen = false;
    view.stop();
    wrap.dataset.open = "false";
    wrap.hidden = true;
    settle(null);
    if (options.focusAfterClose === "back" && before instanceof HTMLElement) before.focus();
    else releaseFocus(wrap);
  }

  function open(): Promise<SignedIn | null> {
    if (isOpen && pending) return pending.promise;
    if (closing) clearTimeout(closing);
    let resolve!: (p: SignedIn | null) => void;
    const promise = new Promise<SignedIn | null>((r) => (resolve = r));
    pending = { promise, resolve };
    before = document.activeElement;
    isOpen = true;
    view.reset();
    wrap.hidden = false;
    wrap.dataset.open = "true";
    (panel.querySelector<HTMLElement>(".n133s-area button") ?? closeKey).focus({ preventScroll: true });
    return promise;
  }

  closeKey.addEventListener("click", close);
  scrim.addEventListener("click", close);
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    // The focus stays in the sheet while it is open.
    const keys = Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")).filter((el) => !el.closest("[hidden]"));
    if (!keys.length) return;
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  return {
    open,
    close,
    get isOpen() {
      return isOpen;
    },
    destroy() {
      close();
      view.stop();
      wrap.remove();
    },
  };
}
