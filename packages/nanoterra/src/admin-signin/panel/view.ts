// The ADMIN's sign-in in the browser (/admin), with Berry Wallet or Nautilus (and NanChat only when the game turned it on). The game starter's
// src/client/ui/signin.ts, moved into the package: first the wallets as tiles (Berry Wallet first); then, for the chosen one, one key that opens it (a
// phone) or a QR code to scan with it (a computer). The page asks the game every 2 seconds until the wallet has signed. It makes the ADMIN login (its
// own cookie, on the fixed route "/api/admin-signin"), so the game and /admin can have different people signed in at once.
//
// Plain DOM, no framework, no package. The tiles show letters, not logos: no wallet's licence clearly allows its logo. Phone first: text 16 px, every
// key and tile 48 px or more each way. It uses the player sheet's stylesheet ("@nano133/nanoterra/admin-signin/style.css" is the same file).

import { ApiError, createApi } from "../../admin/panel/api.js";
import { h, shortAddress } from "../../admin/panel/dom.js";
import { icon } from "../../admin/panel/icons.js";
import { qrSvg } from "../../shop/panel/qr.js";
import { ADMIN_SIGNIN_BASE, type AdminWay } from "../types.js";

export type AdminSigninViewOptions = {
  /** Where the sign-in's routes are. Default "/api/admin-signin" (ADMIN_SIGNIN_BASE). */
  base?: string;
  /**
   * Offer NanChat too (the server's `nanchat: true`). Default false. NanChat's text cannot name the ADMIN ("Login to <host>"), so the owner cannot tell an
   * admin sign-in from a game sign-in in it: it is off unless the game turns it on on the server and here.
   */
  nanchat?: boolean;
  /** The person check (Turnstile): fills `box` and gives its token, before a start. No hook: no check. */
  personCheck?: (box: HTMLElement) => Promise<string | null | undefined>;
  /** Draws a QR code of `text` (a wallet's link), for a screen with a mouse. Default: the package's own QR code; a link too long for it is shown as a link. */
  qr?: (text: string) => HTMLElement | SVGElement;
  /** A touch screen (one key that opens the app) or not (a QR code). Default: `(pointer: coarse)`. */
  touch?: boolean;
  /** The `fetch` to use (default: the page's). */
  fetch?: typeof fetch;
  /** The owner signed in (the address that signed). */
  onSignedIn?: (address: string) => void;
};

export type AdminSigninView = {
  node: HTMLElement;
  /** Ends the waiting (the gate closed). */
  stop(): void;
  /** Starts again at the tiles. */
  reset(): void;
};

type Start = { way: AdminWay; id: string; link: string; walletLink?: string; code?: string; expiresAt: number };

/** The wallets, in every list's order: Berry Wallet first. */
const WALLETS: { way: AdminWay; name: string; mark: string }[] = [
  { way: "berry", name: "Berry Wallet", mark: "B" },
  { way: "nautilus", name: "Nautilus", mark: "N" },
  { way: "nanchat", name: "NanChat", mark: "NC" },
];
const nameOf = (way: AdminWay) => WALLETS.find((w) => w.way === way)!.name;

/** The admin's words: the starter's. */
export const ADMIN_SIGNIN_INTRO = "No password and no payment. This signs in to the ADMIN of this game: your wallet signs a short message that says so. If you did not start this yourself, do not sign.";
/** What NanChat's sign-in says, when it is on: its text cannot say "admin". */
export const ADMIN_NANCHAT_NOTE = "NanChat shows a plain sign-in to this game: its text cannot say ADMIN. Sign only a request that you started here, just now.";

export function adminSigninView(options: AdminSigninViewOptions = {}): AdminSigninView {
  const base = options.base ?? ADMIN_SIGNIN_BASE;
  const api = createApi(base, options.fetch ?? ((...a) => fetch(...a)));
  const wallets = WALLETS.filter((w) => w.way !== "nanchat" || options.nanchat === true);
  const touch = () => options.touch ?? (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The request that is waiting. Back keeps it: the person may have approved it already. */
  let current: Start | null = null;

  const status = h("p", { class: "n133s-status", role: "status", "aria-live": "polite" });
  const check = h("div", { class: "n133s-check" });
  const area = h("div", { class: "n133s-area" });
  const node = h("div", { class: "n133-signin n133s-view n133-admin-signin" }, h("p", { class: "n133s-lead" }, ADMIN_SIGNIN_INTRO), check, area, status);

  const say = (text: string) => (status.textContent = text);
  const key = (text: string, onclick: () => void, kind: "primary" | "plain" = "plain") => h("button", { class: `n133s-btn n133s-${kind}`, type: "button", onclick }, text);
  const focusFirst = () => (area.querySelector<HTMLElement>("h3, button:not([disabled])") ?? area).focus?.({ preventScroll: true });

  function stopWaiting() {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  function showTiles() {
    stopWaiting();
    const tiles = wallets.map((w) =>
      h("button", { class: "n133s-tile", type: "button", "data-way": w.way, onclick: () => void choose(w.way) }, h("span", { class: "n133s-mark", "aria-hidden": "true" }, w.mark), h("span", { class: "n133s-name" }, w.name)),
    );
    area.replaceChildren(h("p", { class: "n133s-or" }, "Choose your wallet"), h("div", { class: "n133s-tiles", "data-count": String(tiles.length) }, ...tiles));
  }

  async function choose(way: AdminWay) {
    if (current?.way === way && Date.now() < current.expiresAt) return showWallet(current);
    stopWaiting();
    current = null;
    for (const b of Array.from(area.querySelectorAll("button"))) b.disabled = true;
    say("Starting…");
    try {
      const turnstile = options.personCheck ? await options.personCheck(check) : undefined;
      const s = await api.post<Start>("/start", { way, ...(turnstile ? { turnstile } : {}) });
      if (stopped) return;
      current = s;
      showWallet(s);
      void poll(s);
    } catch (e) {
      showTiles();
      say(e instanceof Error && e.message ? e.message : "Sign-in did not start. Try again.");
    }
  }

  function showWallet(s: Start) {
    const name = nameOf(s.way);
    const back = h("button", { class: "n133s-back", type: "button", onclick: () => showTiles() }, icon("back", 18), h("span", {}, "Back"));
    area.replaceChildren(back, h("h3", { class: "n133s-step", tabindex: "-1" }, name), ...walletSteps(s, name));
    say(`Waiting for ${name}…`);
    focusFirst();
  }

  /** A QR code of the link, or the link alone when the code cannot hold it (Nautilus's link is longer than the package's QR code holds). */
  function qrOf(text: string, name: string): HTMLElement {
    try {
      const code = options.qr ? options.qr(text) : qrSvg(text, `QR code to sign in with ${name}`);
      code.setAttribute("aria-label", `QR code to sign in with ${name}`);
      return h("div", { class: "n133s-qr" }, code);
    } catch {
      return h("p", { class: "n133s-fine" }, `Open this page on your phone to sign in with ${name}, or `, h("a", { href: text }, `open ${name} on this computer`), ".");
    }
  }

  /** What the person does with the wallet: on a phone, one key; on a computer, a QR code for the phone. */
  function walletSteps(s: Start, name: string): Node[] {
    const open = (text: string, href: string, newTab = false) => h("a", { class: "n133s-btn n133s-primary", href, target: newTab ? "_blank" : undefined, rel: newTab ? "noopener" : undefined }, text);
    const only = h("p", { class: "n133s-fine" }, `Only approve a sign-in that you started yourself, on ${location.host}.`);
    const comeBack = h("p", { class: "n133s-fine" }, `Approve the sign-in in ${s.way === "berry" ? "your wallet" : name}, then come back to this page.`);
    if (s.way === "nautilus") {
      const code = h("p", { class: "n133s-text" }, "Check that Nautilus shows the code ", h("strong", { class: "n133s-signcode" }, s.code ?? ""), ".");
      return touch() ? [code, open("Open Nautilus", s.link), comeBack] : [qrOf(s.link, name), h("p", { class: "n133s-text" }, "Scan this with Nautilus on your phone, then approve the sign-in."), code, only];
    }
    if (s.way === "nanchat") {
      const note = h("p", { class: "n133s-text n133s-fault" }, ADMIN_NANCHAT_NOTE);
      const here = h("p", { class: "n133s-fine" }, "On this computer: ", h("a", { href: s.link, target: "_blank", rel: "noopener" }, "open NanChat"), ".");
      return touch() ? [note, open("Open NanChat", s.link, true), comeBack, only] : [note, qrOf(s.link, name), h("p", { class: "n133s-text" }, "Scan this with your phone's camera, then approve the sign-in in NanChat."), only, here];
    }
    const other = h("a", { class: "n133s-btn n133s-plain", href: s.walletLink ?? s.link }, "Another wallet");
    const here = h("p", { class: "n133s-fine" }, "On this computer: ", h("a", { href: s.walletLink ?? s.link }, "open a wallet"), ".");
    return touch() ? [open("Open Berry Wallet", s.link), other, comeBack] : [qrOf(s.link, name), h("p", { class: "n133s-text" }, "Scan this with Berry Wallet on your phone, then approve the sign-in."), only, here];
  }

  /** The request ended without a sign-in: say why, and offer a new one. */
  function again(s: Start, words: string) {
    current = null;
    area.replaceChildren(h("div", { class: "n133s-keys" }, key("Try again", () => void choose(s.way), "primary"), key("Choose another wallet", () => showTiles())));
    say(words);
  }

  async function poll(s: Start) {
    if (stopped || current !== s) return;
    if (Date.now() > s.expiresAt + 5000) return again(s, "This sign-in expired.");
    try {
      const r = await api.post<{ status: string; address?: string }>("/check", { id: s.id, way: s.way });
      if (stopped || current !== s) return;
      if (r.status === "signedin" && r.address) {
        current = null;
        area.replaceChildren(h("p", { class: "n133s-done" }, icon("check", 22), h("span", {}, `Signed in as ${shortAddress(r.address)}`)));
        say("");
        options.onSignedIn?.(r.address);
        return;
      }
      if (r.status === "elsewhere" || r.status === "used") return again(s, "This sign-in was used in another browser. Start again.");
      if (r.status === "not_owner") return again(s, "That wallet is not this game's address. Choose the wallet that holds it.");
      if (r.status === "expired") return again(s, "This sign-in expired.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) say("Too many checks. Waiting a moment…");
    }
    timer = setTimeout(() => void poll(s), 2000);
  }

  showTiles();
  return {
    node,
    stop() {
      stopped = true;
      stopWaiting();
    },
    reset() {
      stopped = false;
      current = null;
      showTiles();
      say("");
    },
  };
}

/**
 * The admin's sign-in for `mountAdmin`'s `signIn(into, done)` hook: it draws the view into `into` and calls `done()` once the owner has signed in. A new
 * call (the gate shows again) stops the view that was drawn before.
 *
 *   mountAdmin(el, { looks, signIn: adminSignIn(), signOut: adminSignOut() });
 */
export function adminSignIn(options: AdminSigninViewOptions = {}): (into: HTMLElement, done: () => void) => void {
  let last: AdminSigninView | null = null;
  return (into, done) => {
    last?.stop();
    const view = adminSigninView({
      ...options,
      onSignedIn(address) {
        options.onSignedIn?.(address);
        done();
      },
    });
    last = view;
    into.append(view.node);
  };
}

/** `mountAdmin`'s `signOut`: ends the ADMIN login only (`POST {base}/signout`); the game's own login, another person's perhaps, stays. */
export function adminSignOut(options: Pick<AdminSigninViewOptions, "base" | "fetch"> = {}): () => Promise<unknown> {
  return () => createApi(options.base ?? ADMIN_SIGNIN_BASE, options.fetch ?? ((...a) => fetch(...a))).post("/signout", {});
}
