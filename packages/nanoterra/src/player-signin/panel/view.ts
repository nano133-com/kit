// The player's sign-in, ready to put in a sheet: `signInView(options)` gives { node, stop, reset }. Plain DOM, no framework, no browser dialog.
//
//   1. The ways: "Use a passkey" first (Face ID, Touch ID or the device PIN), then the wallet apps as tiles. A browser that reports no passkey PRF
//      shows the passkey last, with "Not on this browser".
//   2. The passkey: "Use my passkey" and "Make a passkey" (the main key is "Use" when this browser made or used one before). A new passkey is made,
//      then used at once (its seed comes from a USE, never from the answer at create: @nano133/signin/passkey); where the browser allows one prompt
//      per press, one key "Open my passkey" finishes it. A NEW account then shows "Keep a spare key" (it can be skipped, not missed). The purse signs
//      the game's sign-in text in the page (@nano133/signin/purse, loaded only then) and the server checks it ({base}/passkey).
//   3. A wallet app: on a touch screen one key that opens the app; with a mouse its QR code (the game's `qr` hook) for the phone. The page asks every
//      2 seconds until the wallet has signed (5 minutes at most).
//
// The seed lives in local variables of one sign-in only: never in storage, a log, an error text or an address. The page remembers only the passkeys'
// ids and the last way (./memo.ts).

import { firstUse, makePasskey, openPasskey, PasskeyError, passkeyFault, passkeySupport, type NewPasskey, type PasskeyScheme, type PasskeySetup } from "@nano133/signin/passkey";
import { ApiError, createApi } from "../../admin/panel/api.js";
import { h, shortAddress } from "../../admin/panel/dom.js";
import { icon } from "../../admin/panel/icons.js";
import { checkScheme } from "../scheme-check.js";
import { previewHost } from "../host.js";
import { WAYS, type Way } from "../types.js";
import { readMemo, rememberLast, rememberMade, rememberOpened } from "./memo.js";
import { faultWords } from "./words.js";

export type SignedIn = { address: string; via: "wallet" | "passkey" };

export type PlayerSigninViewOptions = {
  /** The game's name: the device shows it next to the passkey ("Coin Bees · 1 Nov 2026"). */
  name: string;
  /** The game's FROZEN passkey scheme (see "/player-signin": checkScheme, schemeVector). Needed while the passkey is offered. */
  scheme?: PasskeyScheme;
  /** Offer the passkey. Default: on, except on a preview address (`*.workers.dev`, see `previewHost`): a passkey made there is lost when the game
   *  moves to its own domain. `true` offers it there too. */
  passkey?: boolean;
  /** The passkeys' relying party id: the game's domain. Default: the page's host name. The passkey is offered on this host and its subdomains only. */
  rpId?: string;
  /** The wallet apps, in the sheet's order. Default: Berry Wallet, NanChat, Nautilus. */
  ways?: readonly Way[];
  /** Where the handler's routes are. Default "/api/signin". */
  base?: string;
  /** Show "Keep a spare key" after a new passkey. Default true. */
  spareKey?: boolean;
  /** The person check (Turnstile): fills `box` and gives its token, before a wallet start and a passkey sign-in. No hook: no check. */
  personCheck?: (box: HTMLElement) => Promise<string | null | undefined>;
  /** Draws a QR code of `text` (a wallet's link), for a screen with a mouse. No hook: the link is shown as a link. */
  qr?: (text: string) => HTMLElement;
  /** The player signed in. */
  onSignedIn?: (player: SignedIn) => void;
  /** The `fetch` to use (default: the page's). */
  fetch?: typeof fetch;
  /** A touch screen (one key that opens the app) or not (a QR code). Default: `(pointer: coarse)`. */
  touch?: boolean;
};

export type PlayerSigninView = {
  node: HTMLElement;
  /** Ends the waiting and any device prompt (the sheet closed). */
  stop(): void;
  /** Starts again at the ways (the sheet opens again). */
  reset(): void;
};

type Start = { way: Way; id: string; link: string; walletLink?: string; code?: string; expiresAt: number };

/** The wallets, with letters, not logos: no wallet's licence clearly allows its logo. */
const WALLETS: Record<Way, { name: string; mark: string }> = {
  berry: { name: "Berry Wallet", mark: "B" },
  nanchat: { name: "NanChat", mark: "NC" },
  nautilus: { name: "Nautilus", mark: "N" },
};

const NS = "http://www.w3.org/2000/svg";
/** A key, the passkey's mark (drawn here: the shared icons have none). */
function keyIcon(size = 26): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 1.9, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, String(v));
  for (const d of ["M14.5 9.5a4.5 4.5 0 1 1-1.3-3.2", "M13.2 6.3 21 6.3M18 6.3v3M21 6.3v2.2"]) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  const c = document.createElementNS(NS, "circle");
  for (const [k, v] of Object.entries({ cx: 10, cy: 9.5, r: 1.4, fill: "currentColor", stroke: "none" })) c.setAttribute(k, String(v));
  svg.append(c);
  return svg;
}

/** True when the page's host may ask for a passkey of `rpId`: the same host, or a subdomain of it. An IP address never may. */
export function hostFits(hostname: string, rpId: string): boolean {
  if (!hostname || /^[\d.]+$/.test(hostname) || hostname.includes(":")) return false;
  return hostname === rpId || hostname.endsWith(`.${rpId}`);
}

/** The passkey's name in the device's list: the game and the day it was made (the account does not exist yet). */
export const passkeyName = (game: string, now = new Date()) => `${game} · ${now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

export function signInView(options: PlayerSigninViewOptions): PlayerSigninView {
  const base = options.base ?? "/api/signin";
  const api = createApi("", options.fetch ?? ((...a) => fetch(...a)));
  const ways = (options.ways ?? WAYS).filter((w) => WAYS.includes(w));
  const rpId = options.rpId ?? location.hostname;
  const passkeyOn = options.passkey ?? !previewHost(rpId);
  const scheme = passkeyOn ? checkScheme(options.scheme as PasskeyScheme) : null;
  const touch = () => options.touch ?? (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let prompt: AbortController | null = null;
  /** The wallet request that is waiting. Back keeps it: the player may have approved it already. */
  let current: Start | null = null;
  let support: "yes" | "no" | "unknown" = "unknown";

  const status = h("p", { class: "n133s-status", role: "status", "aria-live": "polite" });
  const check = h("div", { class: "n133s-check" });
  check.hidden = true;
  const area = h("div", { class: "n133s-area" });
  const node = h("div", { class: "n133-signin n133s-view" }, area, check, status);

  const say = (text: string) => (status.textContent = text);
  const busy = (on: boolean) => {
    for (const b of Array.from(area.querySelectorAll("button"))) b.disabled = on;
    node.toggleAttribute("aria-busy", on);
  };
  const key = (text: string, onclick: () => void, kind: "primary" | "plain" | "quiet" = "plain") => h("button", { class: `n133s-btn n133s-${kind}`, type: "button", onclick }, text);
  const backKey = () => h("button", { class: "n133s-back", type: "button", onclick: () => showWays() }, icon("back", 18), h("span", {}, "Back"));
  const title = (text: string) => h("h3", { class: "n133s-step", tabindex: "-1" }, text);
  const focusFirst = () => (area.querySelector<HTMLElement>("h3, button:not([disabled])") ?? area).focus?.({ preventScroll: true });
  const setup = (): PasskeySetup => ({ rpId, rpName: options.name, scheme: scheme!, userName: passkeyName(options.name), exclude: readMemo(rpId).ids });
  /** Puts these in the area (a null is left out). */
  const fill = (...parts: (Node | null)[]) => area.replaceChildren(...parts.filter((p): p is Node => p !== null));
  const personToken = async () => (options.personCheck ? options.personCheck(check) : undefined);

  function stopWaiting() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    prompt?.abort();
    prompt = null;
  }

  function done(player: SignedIn) {
    stopWaiting();
    current = null;
    area.replaceChildren(h("p", { class: "n133s-done" }, icon("check", 22), h("span", {}, `Signed in as ${shortAddress(player.address)}`)));
    say("");
    options.onSignedIn?.(player);
  }

  // ---- the ways ----

  function passkeyTile(): HTMLElement {
    const off = support === "no";
    const last = readMemo(rpId).last === "passkey";
    return h(
      "button",
      { class: `n133s-pk${off ? " is-off" : ""}`, type: "button", onclick: () => showPasskey() },
      h("span", { class: "n133s-pk-mark" }, keyIcon()),
      h("span", { class: "n133s-pk-words" }, h("strong", {}, "Use a passkey"), h("small", {}, off ? "Not on this browser" : "Face ID, Touch ID or your device PIN")),
      last ? h("span", { class: "n133s-last" }, "Last used") : null,
    );
  }

  function walletTiles(): HTMLElement {
    const last = readMemo(rpId).last;
    return h(
      "div",
      { class: "n133s-tiles" },
      ...ways.map((w) =>
        h(
          "button",
          { class: "n133s-tile", type: "button", onclick: () => choose(w) },
          h("span", { class: "n133s-mark", "aria-hidden": "true" }, WALLETS[w].mark),
          h("span", { class: "n133s-name" }, WALLETS[w].name),
          last === w ? h("span", { class: "n133s-last" }, "Last used") : null,
        ),
      ),
    );
  }

  function showWays() {
    stopWaiting();
    busy(false);
    const pk = passkeyOn ? passkeyTile() : null;
    const first = pk && support !== "no";
    const walletsPart = ways.length ? [h("p", { class: "n133s-or" }, pk ? "Or a wallet app" : "Choose your wallet"), walletTiles()] : [];
    fill(h("p", { class: "n133s-lead" }, "No password and no payment."), first ? pk : null, ...walletsPart, !first && pk ? h("p", { class: "n133s-or" }, "Or a passkey") : null, !first ? pk : null);
    say("");
  }

  // ---- the passkey ----

  function showFault(e: unknown): void {
    busy(false);
    const f = passkeyFault(e);
    const w = faultWords(f.code, rpId);
    if (w.next === "stay") return showPasskey(w.text);
    fill(
      backKey(),
      title(w.title),
      h("p", { class: "n133s-text n133s-fault", "data-fault": f.code }, w.text),
      ways.length ? h("p", { class: "n133s-or" }, "Sign in with a wallet app") : null,
      ways.length ? walletTiles() : null,
    );
    say("");
    focusFirst();
  }

  function showPasskey(note?: string): void {
    stopWaiting();
    busy(false);
    if (!scheme) return showWays();
    if (typeof window === "undefined" || !window.PublicKeyCredential) return showFault({ name: "NotSupportedError" });
    if (support === "no") return showFault(new PasskeyError("no-prf"));
    if (!hostFits(location.hostname, rpId)) return showFault({ name: "SecurityError" });
    const known = readMemo(rpId).ids.length > 0;
    const use = key("Use my passkey", () => void usePasskey(), known ? "primary" : "plain");
    const make = key("Make a passkey", () => void makeNew(), known ? "plain" : "primary");
    area.replaceChildren(
      backKey(),
      title("Passkey"),
      h("p", { class: "n133s-text" }, "Face ID, Touch ID or your device PIN. The passkey stays on your device: the game never sees it."),
      h("div", { class: "n133s-keys" }, known ? use : make, known ? make : use),
    );
    say(note ?? "");
    focusFirst();
  }

  async function usePasskey() {
    busy(true);
    say("Waiting for your passkey…");
    prompt = new AbortController();
    try {
      const p = await openPasskey(setup(), prompt.signal);
      if (stopped) return;
      await finish(p.seed, p.credentialId, false);
    } catch (e) {
      if (!stopped) showFault(e);
    }
  }

  async function makeNew() {
    busy(true);
    say("Making your passkey…");
    prompt = new AbortController();
    let made: NewPasskey;
    try {
      made = await makePasskey(setup(), prompt.signal);
    } catch (e) {
      if (!stopped) showFault(e);
      return;
    }
    // Remembered now, before its first use: a closed sheet or a reload must not forget it.
    rememberMade(rpId, made.credentialId);
    if (stopped) return;
    await firstOpen(made, false);
  }

  /** The first use of a passkey just made. Where it gives nothing (a browser that allows one prompt per press, a closed sheet), one key finishes it. */
  async function firstOpen(made: NewPasskey, pick: boolean) {
    busy(true);
    say("Opening your passkey…");
    prompt = new AbortController();
    try {
      const p = await firstUse(setup(), made, prompt.signal, pick);
      if (stopped) return;
      await finish(p.seed, p.credentialId, true);
    } catch (e) {
      if (stopped) return;
      const f = passkeyFault(e);
      if (f.code !== "cancelled" && f.code !== "failed") return showFault(f);
      busy(false);
      area.replaceChildren(title("Your passkey is made"), h("p", { class: "n133s-text" }, "Press the key to open it."), h("div", { class: "n133s-keys" }, key("Open my passkey", () => void firstOpen(made, true), "primary")));
      say("");
      focusFirst();
    }
  }

  /** "Keep a spare key": the code shows only at the press, and the player goes on with Continue or Later. */
  function spareKey(seed: string): Promise<void> {
    return new Promise((resolve) => {
      busy(false);
      const code = h("p", { class: "n133s-code", translate: "no" });
      const codeBox = h("div", { class: "n133s-codebox" }, code);
      codeBox.hidden = true;
      const go = key("Later", () => resolve(), "quiet");
      const copyBtn = key("Copy the code", async () => {
        try {
          await navigator.clipboard.writeText(seed);
          copyBtn.textContent = "Copied";
        } catch {
          copyBtn.textContent = "Copy failed: write it down";
        }
      });
      codeBox.append(copyBtn);
      const show = key("Show my code", () => {
        code.textContent = seed.match(/.{1,16}/g)!.join("\n");
        codeBox.hidden = false;
        show.remove();
        go.textContent = "Continue";
        go.className = "n133s-btn n133s-primary";
      }, "primary");
      area.replaceChildren(
        title("Keep a spare key"),
        h("p", { class: "n133s-text" }, "Your looks belong to this passkey. If you lose it, this code brings them back."),
        codeBox,
        h("p", { class: "n133s-fine" }, "Keep it secret: whoever has it can sign in as you. To use it, import it as a seed in a Nano wallet such as Nautilus, then sign in with that wallet."),
        h("div", { class: "n133s-keys" }, show, go),
      );
      say("");
      focusFirst();
    });
  }

  async function finish(seed: string, credentialId: string, made: boolean) {
    const fresh = made || readMemo(rpId).unopened.includes(credentialId);
    if (fresh && options.spareKey !== false) await spareKey(seed);
    if (stopped) return;
    busy(true);
    say("Signing in…");
    try {
      const { signinBody } = await import("@nano133/signin/purse");
      const turnstile = await personToken();
      const r = await api.post<{ status: string; address: string }>(`${base}/passkey`, { ...signinBody(location.host, seed), ...(turnstile ? { turnstile } : {}) });
      rememberOpened(rpId, credentialId);
      if (!stopped) done({ address: r.address, via: "passkey" });
    } catch (e) {
      if (!stopped) showPasskey(e instanceof ApiError ? e.message : "Sign-in did not work. Try again.");
    }
  }

  // ---- a wallet app ----

  async function choose(way: Way) {
    if (current?.way === way && Date.now() < current.expiresAt) return showWallet(current);
    stopWaiting();
    current = null;
    busy(true);
    say("Starting…");
    try {
      const turnstile = await personToken();
      const s = await api.post<Start>(`${base}/start`, { way, ...(turnstile ? { turnstile } : {}) });
      if (stopped) return;
      current = s;
      rememberLast(rpId, way);
      showWallet(s);
      void poll(s);
    } catch (e) {
      busy(false);
      showWays();
      say(e instanceof Error ? e.message : "Sign-in did not start. Try again.");
    }
  }

  function showWallet(s: Start) {
    const name = WALLETS[s.way].name;
    area.replaceChildren(backKey(), title(name), ...walletSteps(s, name));
    say(`Waiting for ${name}…`);
    focusFirst();
  }

  /** What the player does with the wallet: on a touch screen, one key; with a mouse, a QR code for the phone. */
  function walletSteps(s: Start, name: string): Node[] {
    const open = (text: string, href: string, newTab = false) => h("a", { class: "n133s-btn n133s-primary", href, target: newTab ? "_blank" : undefined, rel: newTab ? "noopener" : undefined }, text);
    const qr = (text: string) => {
      if (!options.qr) return h("p", { class: "n133s-fine" }, "Open this page on your phone to sign in with ", name, ".");
      const c = options.qr(text);
      c.setAttribute("aria-label", `QR code to sign in with ${name}`);
      return h("div", { class: "n133s-qr" }, c);
    };
    const only = h("p", { class: "n133s-fine" }, `Only approve a sign-in that you started yourself, on ${location.host}.`);
    const comeBack = h("p", { class: "n133s-fine" }, `Approve the sign-in in ${s.way === "berry" ? "your wallet" : name}, then come back to this page.`);
    if (s.way === "nautilus") {
      const code = h("p", { class: "n133s-text" }, "Check that Nautilus shows the code ", h("strong", { class: "n133s-signcode" }, s.code ?? ""), ".");
      return touch() ? [code, open("Open Nautilus", s.link), comeBack] : [qr(s.link), h("p", { class: "n133s-text" }, "Scan this with Nautilus on your phone, then approve the sign-in."), code, only];
    }
    if (s.way === "nanchat") {
      const here = h("p", { class: "n133s-fine" }, "On this computer: ", h("a", { href: s.link, target: "_blank", rel: "noopener" }, "open NanChat"), ".");
      return touch() ? [open("Open NanChat", s.link, true), comeBack, only] : [qr(s.link), h("p", { class: "n133s-text" }, "Scan this with your phone's camera to open NanChat, then approve the sign-in."), only, here];
    }
    const other = h("a", { class: "n133s-btn n133s-plain", href: s.walletLink ?? s.link }, "Another wallet");
    const here = h("p", { class: "n133s-fine" }, "On this computer: ", h("a", { href: s.walletLink ?? s.link }, "open a wallet"), ".");
    return touch() ? [open("Open Berry Wallet", s.link), other, comeBack] : [qr(s.link), h("p", { class: "n133s-text" }, "Scan this with Berry Wallet on your phone, then approve the sign-in."), only, here];
  }

  /** The request ended without a sign-in: say why, and offer a new one. */
  function again(s: Start, words: string) {
    current = null;
    area.replaceChildren(backKey(), title(WALLETS[s.way].name), h("div", { class: "n133s-keys" }, key("Try again", () => void choose(s.way), "primary"), key("Choose another way", () => showWays())));
    say(words);
  }

  async function poll(s: Start) {
    if (stopped || current !== s) return;
    if (Date.now() > s.expiresAt + 5000) return again(s, "This sign-in expired.");
    try {
      const r = await api.post<{ status: string; address?: string }>(`${base}/check`, { id: s.id, way: s.way });
      if (stopped || current !== s) return;
      if (r.status === "signedin" && r.address) return done({ address: r.address, via: "wallet" });
      if (r.status === "elsewhere" || r.status === "used") return again(s, "This sign-in was used in another browser. Start again.");
      if (r.status === "expired") return again(s, "This sign-in expired.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) say("Too many checks. Waiting a moment…");
    }
    timer = setTimeout(() => void poll(s), 2000);
  }

  function reset() {
    stopped = false;
    current = null;
    showWays();
  }

  showWays();
  if (passkeyOn)
    void passkeySupport().then((s) => {
      support = s;
      // Only the ways' screen depends on it: redraw it when it shows.
      if (!stopped && area.querySelector(".n133s-pk")) showWays();
    });

  return {
    node,
    stop() {
      stopped = true;
      stopWaiting();
    },
    reset,
  };
}
