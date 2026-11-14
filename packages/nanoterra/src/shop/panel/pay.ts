// The pay sheet for one order (the game starter's src/client/ui/pay.ts). It shows the exact amount, a QR code and a "nano:" link for the wallet, and asks
// the game every 5 seconds whether the payment arrived, for 2 minutes per check.
//
// The same sheet pays a play (a round, a level, a life or a continue: `play`): its line says one use, used once, and the creator's refund words (`refund`,
// from the order's answer) stand before any step (above the QR code, the address and the wallet key).
//
// Since 0.16.0 (Wes, 2026-11-14: design A "Tidy", with the success of design B):
// - The item's picture (`preview`, the game's; else the kit's) stands beside its line, and a thin bar under it shows the time left.
// - The main way to pay goes by the device. A phone or a tablet (a coarse pointer) cannot scan its own screen: "Open wallet" leads, and the QR code and
//   the address wait in the fold "Pay from another device". A computer shows the QR code first, the address in "Enter by hand", and "Open wallet" second.
// - The amount has its own copy key. The state has a dot that pulses while the sheet waits (still with reduced motion).
// - When the order ends (the server's `expired` or `paid_late`, or the clock at 0), the ways to pay go: no wallet key, no QR code, no copy key. A wallet
//   opened after the end would only make a late payment. "Check again" stays: a payment sent in time still counts.
// - Paid: the sheet stays open on the success (the item large, a tick, a burst in the creator's colours; still with reduced motion) until the player
//   presses the success's key (`next`). A screen reader hears "Paid." and the focus goes to the success's title.
// - The trust line `TRUST_LINE` ("Paid straight to the creator. No network fee.") is the kit's: a game cannot change or remove it. It shows only on a live
//   order whose link pays the order's own address (`trustShown`), never in test mode.
//
// TEST MODE: the server sends no address and no link, and this sheet shows a large "TEST MODE: DO NOT PAY" stamp where the QR code would be, with the
// wallet key off. Never change that: a payment to an address that nobody holds the key for is lost for good. The sheet decides it from the ORDER (its
// `test`, a missing `uri` or a missing `address`), never from a setting of the page. The stamp's words are not among the game's words (./words.ts).

import { h } from "../../admin/panel/dom.js";
import { icon } from "../../admin/panel/icons.js";
import { usdText } from "../../looks/look.js";
import type { PayView } from "../handler.js";
import { qrSvg } from "./qr.js";
import { TRUST_LINE, priceLine, shopWords, type ShopWords } from "./words.js";

export const PAY_TIMING = { pollMs: 5000, checkForMs: 2 * 60_000 } as const;

/** The success's key: its words, and what it does after the sheet closes (mountShop closes it; a game's own `payPanel` does it in `run`). */
export type PayNext = { label: string; run?: () => void };

export type PayOptions = {
  /** The look's name (or the play's), for the success and the picture. */
  lookName: string;
  /** The order sells a play: its use ("round", "level", "life", "continue"). The sheet then says one use, used once, and the paid words of a play. */
  play?: { use: string };
  /** The creator's refund words (a play's order answer: `refund.text`), shown before any step. Plain text, never HTML. */
  refund?: string;
  /** POST {base}/{id}/check: the order again, after a payment scan. */
  check(id: string): Promise<PayView>;
  /** The order is paid: the look is the player's now (a play: its credit is ready). It runs before the success shows. */
  onPaid(order: PayView): void;
  /** Words of a failed check (an ApiError's message), or null for "No connection". */
  errorText?(e: unknown): string | null;
  /** The time now in ms (a test gives its own). */
  now?: () => number;
  /** The game's words (./words.ts): the keys it leaves out keep the defaults. */
  words?: Partial<ShopWords>;
  /** The item's picture at a size in CSS px (the game's look on the player's own character, a round's day), or null for the kit's own (since 0.16.0). */
  preview?: (size: number) => HTMLElement | null;
  /** The success's key (since 0.16.0). With none, the success has no key (mountShop always gives one: "Keep playing"). */
  next?: PayNext | null;
  /** The success's moment of the game's own (a sound), as the success shows (since 0.16.0). `calm`: reduced motion is on (the device's or the options'). */
  celebrate?: (calm: boolean) => void;
  /** After `onPaid`: whether the player wears the look now. Yes: the success says "You are wearing it now." (since 0.16.0). */
  wearing?: () => boolean;
  /** The main way to pay: "wallet" (the wallet key first) or "qr" (the QR code first). Default: by the device's pointer (since 0.16.0). */
  main?: "wallet" | "qr";
};

export type PayPanel = { node: HTMLElement; stop(): void };

/** True when this order must show the test stamp: the server said test mode, or it sent no address or no link. */
export const isTestOrder = (o: Pick<PayView, "test" | "uri" | "address">): boolean => o.test || !o.uri || !o.address;

/**
 * Whether the trust line shows for this order: a live order (not a test one) whose `nano:` link pays the order's own address. The line is a claim about
 * money, so it shows only where the kit can see that it is true.
 */
export const trustShown = (o: Pick<PayView, "test" | "uri" | "address">): boolean =>
  !isTestOrder(o) && typeof o.uri === "string" && typeof o.address === "string" && o.uri.startsWith(`nano:${o.address}?`);

/** Reduced motion: the device's setting, or the options' "Less motion" (`reflectOptions(store, ["reducedMotion"])` on the page's <html>). */
export function calmNow(): boolean {
  try {
    if (globalThis.document?.documentElement?.getAttribute("data-n133-opt-reduced-motion") === "true") return true;
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/** A phone or a tablet: its own screen cannot be scanned, so the wallet key leads. */
function coarse(): boolean {
  try {
    return globalThis.matchMedia?.("(pointer: coarse)").matches === true;
  } catch {
    return false;
  }
}

/** The kit's own picture of an item: a disc with its first letter (a game's `preview` is better). */
function plainPicture(name: string): HTMLElement {
  return h("span", { class: "n133s-pic-plain" }, name.trim().charAt(0).toUpperCase());
}

/** The item's picture in its round frame, at `size` CSS px. Decorative: the name is in the words beside it. */
export function itemPicture(name: string, size: number, preview?: (size: number) => HTMLElement | null, cls = ""): HTMLElement {
  let pic: HTMLElement | null = null;
  try {
    pic = preview?.(size) ?? null;
  } catch {
    pic = null;
  }
  const frame = h("span", { class: `n133s-pic ${cls}`.trim(), "aria-hidden": "true" }, pic ?? plainPicture(name));
  frame.style.setProperty("--n133s-pic", `${size}px`);
  return frame;
}

type State = "waiting" | "still" | "offline" | "ended" | "late" | "paid" | "test";

export function payPanel(start: PayView, options: PayOptions): PayPanel {
  let order = start;
  const now = options.now ?? (() => Date.now());
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let checkingUntil = 0;
  const w = shopWords(options.words);
  const test = isTestOrder(order);
  const main: "wallet" | "qr" | "test" = test ? "test" : (options.main ?? (coarse() ? "wallet" : "qr"));
  const total = Math.max(1, order.expiresAt - order.createdAt);

  // ---- the parts ----

  /** The order's state. In test mode nothing is checked, so it has nothing to say and takes no room. */
  const statusText = h("span", { class: "n133s-status-text" });
  const status = h("p", { class: "n133s-status", role: "status", "aria-live": "polite", hidden: test }, h("span", { class: "n133s-dot", "aria-hidden": "true" }), statusText);
  const again = h("button", { class: "n133s-btn n133s-wide n133s-again", type: "button", hidden: true }, w.checkAgain);
  /** The time left, live only: the digits for the eye, the words for a screen reader (read when reached, never announced each second). */
  const clockDigits = h("span", { class: "n133s-clock", "aria-hidden": "true" });
  const clockWords = h("span", { class: "n133s-sr" });
  const ends = h("p", { class: "n133s-time-left", hidden: test }, icon("clock", 18), clockDigits, clockWords);
  const barFill = h("span", { class: "n133s-bar-fill" });
  const bar = h("div", { class: "n133s-bar", "aria-hidden": "true", hidden: test }, barFill);
  /** What a screen reader hears as the payment is seen (a live region of its own: the status goes with the pay parts). */
  const said = h("p", { class: "n133s-sr", role: "status", "aria-live": "polite" });

  const copyKey = (value: string) => {
    const key = h("button", { class: "n133s-btn n133s-small", type: "button" }, w.copy);
    key.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(value);
        key.textContent = w.copied;
      } catch {
        key.textContent = w.copyFailed;
      }
      setTimeout(() => (key.textContent = w.copy), 1500);
    });
    return key;
  };
  /** The amount's own copy key: an icon, 48 by 48, named for a screen reader. Never in test mode (nothing can be paid). */
  const amountCopy = test ? null : h("button", { class: "n133s-btn n133s-copy", type: "button", "aria-label": w.copyAmount, title: w.copyAmount }, icon("copy", 20));
  amountCopy?.addEventListener("click", async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(order.xno);
    } catch {
      ok = false;
    }
    amountCopy.replaceChildren(icon(ok ? "check" : "alert", 20));
    amountCopy.setAttribute("aria-label", ok ? w.copied : w.copyFailed);
    setTimeout(() => {
      amountCopy.replaceChildren(icon("copy", 20));
      amountCopy.setAttribute("aria-label", w.copyAmount);
    }, 1500);
  });
  const amount = h(
    "div",
    { class: "n133s-amount" },
    h("span", { class: "n133s-amount-top" }, test ? null : h("span", { class: "n133s-exact" }, w.sendExactly), h("span", { class: "n133s-usd" }, w.usd(usdText(Number(order.usd))))),
    h("span", { class: "n133s-amount-row" }, h("strong", {}, w.amount(order.xno)), amountCopy),
  );

  const addressRows = () =>
    h(
      "div",
      { class: "n133s-hand" },
      h("div", { class: "n133s-row" }, h("span", { class: "n133s-label" }, w.toLabel), h("code", { class: "n133s-address" }, order.address!), copyKey(order.address!)),
      h("p", { class: "n133s-fine" }, w.byHandNote),
    );

  /** The ways to pay that go when the order ends: the QR code and its folds, the wallet key, the amount's copy key. */
  let payArea: HTMLElement;
  /** The wallet key (the wallet link; off in test mode): it stands in a foot that stays in view, so a phone on its side never hides it. */
  let wallet: HTMLElement;
  if (test) {
    payArea = h(
      "div",
      { class: "n133s-test-pay" },
      h("div", { class: "n133s-qr n133s-qr-blocked", "aria-hidden": "true" }, h("div", { class: "n133s-qr-fake" })),
      h("div", { class: "n133s-stamp", role: "alert" }, h("span", {}, "TEST MODE:"), " ", h("span", {}, "DO NOT PAY")),
      w.testNote ? h("p", { class: "n133s-fine" }, w.testNote) : null,
    );
    wallet = h("button", { class: "n133s-btn n133s-primary n133s-wide", type: "button", disabled: true }, w.walletOff);
  } else {
    const qr = h("div", { class: "n133s-qr" }, qrSvg(order.uri!, w.qrLabel(order.xno)));
    if (main === "wallet") {
      payArea = h("details", { class: "n133s-by-hand n133s-other" }, h("summary", {}, w.otherDevice), h("div", { class: "n133s-live-pay" }, qr), addressRows());
      wallet = h("a", { class: "n133s-btn n133s-primary n133s-wide n133s-wallet", href: order.uri! }, icon("external", 18), h("span", {}, w.wallet));
    } else {
      payArea = h("div", { class: "n133s-live-pay" }, qr, h("details", { class: "n133s-by-hand" }, h("summary", {}, w.byHand), addressRows()));
      wallet = h("a", { class: "n133s-btn n133s-wide n133s-wallet n133s-second", href: order.uri! }, w.wallet);
    }
  }

  const foot = h("div", { class: "n133s-foot" }, wallet);
  const state = h("div", { class: "n133s-state" }, status, ends);
  // The order of the parts: the refund words before any step; then the amount, then the ways to pay (a phone: the wallet key first, the QR code in a
  // fold after the state; a computer: the QR code in its own column, the wallet key second; test mode: the wallet key off, then the stamp).
  const act =
    main === "qr"
      ? h("div", { class: "n133s-pay-act" }, state, foot, again)
      : h("div", { class: "n133s-pay-act" }, foot, state, again, payArea);
  const success = h("div", { class: "n133s-success n133s-paid", hidden: true });
  const node = h(
    "div",
    { class: `n133s-pay${test ? " n133s-is-test" : ""}`, "data-main": main, "data-state": test ? "test" : "waiting" },
    bar,
    h(
      "div",
      { class: "n133s-pay-top" },
      h("div", { class: "n133s-item" }, itemPicture(options.lookName, 64, options.preview, "n133s-item-pic"), h("p", { class: "n133s-pay-what" }, options.play ? w.playLine(options.play.use) : w.lookLine(options.lookName))),
      options.refund ? h("p", { class: "n133s-fine n133s-refund" }, options.refund) : null,
    ),
    h("div", { class: "n133s-pay-body" }, main === "qr" ? h("div", { class: "n133s-pay-qr" }, payArea) : null, h("div", { class: "n133s-pay-words" }, amount, act)),
    h(
      "div",
      { class: "n133s-fine-lines" },
      trustShown(order) ? h("p", { class: "n133s-trust" }, icon("lock", 16), h("span", {}, TRUST_LINE)) : null,
      h("p", { class: "n133s-fine n133s-prices" }, priceLine(w, order.prices)),
    ),
    success,
    said,
  );

  // ---- the state ----

  const setStatus = (kind: "wait" | "note" | "warn", text: string) => {
    status.dataset.kind = kind;
    statusText.textContent = text;
  };
  /** The ways to pay show only while the order can still be paid in time. */
  const payable = (on: boolean) => {
    if (test) return;
    payArea.hidden = !on;
    foot.hidden = !on;
    if (amountCopy) amountCopy.hidden = !on;
    // the link itself goes too: a key that is hidden by a game's CSS mistake still opens no wallet
    if (on) wallet.setAttribute("href", order.uri!);
    else wallet.removeAttribute("href");
  };
  const setState = (s: State) => {
    node.dataset.state = s;
    payable(s === "waiting" || s === "still" || s === "offline");
    // an order that ended has no time left, whatever this device's clock says (the server's answer wins)
    if (s === "ended" || s === "late") {
      clockDigits.textContent = "0:00";
      clockWords.textContent = w.endsIn("0:00");
      barFill.style.setProperty("--n133s-left", "0");
      node.dataset.low = "true";
    }
  };

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = undefined;
  };

  const terminal = () => node.dataset.state === "paid" || node.dataset.state === "late";

  const tick = () => {
    if (node.dataset.state === "ended" || node.dataset.state === "late") return;
    const ms = Math.max(0, order.expiresAt - now());
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const t = `${m}:${String(s).padStart(2, "0")}`;
    clockDigits.textContent = t;
    clockWords.textContent = w.endsIn(t);
    const left = Math.max(0, Math.min(1, ms / total));
    barFill.style.setProperty("--n133s-left", String(left));
    node.dataset.low = left < 0.2 ? "true" : "false";
    // The clock reached the order's end (the server's own expiresAt): no way to pay is offered any more, and one check asks the server.
    if (!test && ms === 0 && !terminal() && node.dataset.state !== "ended") {
      endedHere();
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };

  function endedHere() {
    setState("ended");
    setStatus("warn", w.expired);
    again.hidden = false;
  }

  function showSuccess() {
    setState("paid");
    // the success is the sheet now: the other parts leave it (for a screen reader too), the live region stays
    for (const part of Array.from(node.children)) if (part !== success && part !== said) (part as HTMLElement).hidden = true;
    const burst = h(
      "span",
      { class: "n133s-burst", "aria-hidden": "true" },
      ...Array.from({ length: 14 }, (_, i) => {
        // a Content Security Policy with no 'unsafe-inline' drops a style attribute; the CSSOM is allowed
        const bit = h("i", {});
        bit.style.setProperty("--i", String(i));
        return bit;
      }),
    );
    const title = h("p", { class: "n133s-success-title", tabindex: "-1" }, options.play ? w.playPaid(options.play.use) : w.paidLine(options.lookName));
    let wearing = false;
    try {
      wearing = !options.play && options.wearing?.() === true;
    } catch {
      wearing = false;
    }
    const next = options.next;
    success.replaceChildren(
      h("div", { class: "n133s-stage" }, burst, itemPicture(options.lookName, 128, options.preview, "n133s-success-pic"), h("span", { class: "n133s-tick", "aria-hidden": "true" }, icon("check", 22))),
      title,
    );
    if (wearing) success.append(h("p", { class: "n133s-success-line" }, w.wearingNow));
    if (next) success.append(h("button", { class: "n133s-btn n133s-primary n133s-wide n133s-next", type: "button", onclick: () => next.run?.() }, next.label));
    success.hidden = false;
    said.textContent = w.paid;
    if (node.isConnected && node.contains(globalThis.document?.activeElement ?? null)) title.focus();
    else if (node.closest?.("dialog")?.contains(globalThis.document?.activeElement ?? null)) title.focus();
    try {
      options.celebrate?.(calmNow());
    } catch {
      // the game's moment never stops the success
    }
  }

  tick();
  if (!test) clockTimer = setInterval(tick, 1000);

  function show(o: PayView): boolean {
    order = o;
    if (o.status === "paid") {
      stop();
      setStatus("note", "");
      again.hidden = true;
      options.onPaid(o);
      showSuccess();
      return true;
    }
    if (o.status === "paid_late") {
      stop();
      setState("late");
      setStatus("warn", options.play ? w.playLate(options.play.use) : w.paidLate);
      again.hidden = true;
      return true;
    }
    if (o.status === "expired") {
      stop();
      endedHere();
      return false;
    }
    return false;
  }

  async function poll() {
    if (stopped) return;
    try {
      const o = await options.check(order.id);
      if (stopped) return;
      if (show(o)) return;
      if (o.status === "open") {
        // the server says the order is open: its ways to pay come back (a clock that ran ahead of the server's)
        if (node.dataset.state !== "waiting") setState("waiting");
        setStatus("wait", w.waiting);
      }
    } catch (e) {
      if (stopped) return;
      if (node.dataset.state !== "ended") setState("offline");
      setStatus("warn", options.errorText?.(e) ?? w.noConnection);
    }
    if (stopped) return;
    if (now() < checkingUntil) timer = setTimeout(poll, PAY_TIMING.pollMs);
    else {
      if (node.dataset.state !== "ended") {
        setState("still");
        setStatus("note", w.stillWaiting);
      }
      again.hidden = false;
    }
  }

  function startChecking() {
    stopped = false;
    again.hidden = true;
    checkingUntil = now() + PAY_TIMING.checkForMs;
    if (order.expiresAt > now()) clockTimer ??= setInterval(tick, 1000);
    void poll();
  }
  again.addEventListener("click", startChecking);
  // Test mode makes no checks: nothing can be paid, so nothing is waited for.
  if (!test) {
    setStatus("wait", w.waiting);
    startChecking();
  }

  return { node, stop };
}
