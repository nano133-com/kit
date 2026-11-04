// The pay sheet for one order (the game starter's src/client/ui/pay.ts). It shows the exact amount, a QR code and a "nano:" link for the wallet, and asks
// the game every 5 seconds whether the payment arrived, for 2 minutes per check.
//
// The same sheet pays a play (a round, a level, a life or a continue: `play`): its line says one use, used once, and the creator's refund words (`refund`,
// from the order's answer) stand before any step (above the QR code, the address and the wallet key).
//
// TEST MODE: the server sends no address and no link, and this sheet shows a large "TEST MODE: DO NOT PAY" stamp where the QR code would be, with the
// wallet key off. Never change that: a payment to an address that nobody holds the key for is lost for good. The sheet decides it from the ORDER (its
// `test`, a missing `uri` or a missing `address`), never from a setting of the page. The stamp's words are not among the game's words (./words.ts).

import { h } from "../../admin/panel/dom.js";
import { usdText } from "../../looks/look.js";
import type { PayView } from "../handler.js";
import { qrSvg } from "./qr.js";
import { priceLine, shopWords, type ShopWords } from "./words.js";

export const PAY_TIMING = { pollMs: 5000, checkForMs: 2 * 60_000 } as const;

export type PayOptions = {
  /** The look's name (or the play's), for the line at the top. */
  lookName: string;
  /** The order sells a play: its use ("round", "level", "life", "continue"). The sheet then says one use, used once, and the paid words of a play. */
  play?: { use: string };
  /** The creator's refund words (a play's order answer: `refund.text`), shown before any step. Plain text, never HTML. */
  refund?: string;
  /** POST {base}/{id}/check: the order again, after a payment scan. */
  check(id: string): Promise<PayView>;
  /** The order is paid: the look is the player's now (a play: its credit is ready). */
  onPaid(order: PayView): void;
  /** Words of a failed check (an ApiError's message), or null for "No connection". */
  errorText?(e: unknown): string | null;
  /** The time now in ms (a test gives its own). */
  now?: () => number;
  /** The game's words (./words.ts): the keys it leaves out keep the defaults. */
  words?: Partial<ShopWords>;
};

export type PayPanel = { node: HTMLElement; stop(): void };

/** True when this order must show the test stamp: the server said test mode, or it sent no address or no link. */
export const isTestOrder = (o: Pick<PayView, "test" | "uri" | "address">): boolean => o.test || !o.uri || !o.address;

export function payPanel(start: PayView, options: PayOptions): PayPanel {
  let order = start;
  const now = options.now ?? (() => Date.now());
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let checkingUntil = 0;
  const w = shopWords(options.words);
  const test = isTestOrder(order);

  /** The order's state. In test mode nothing is checked, so it has nothing to say and takes no room. */
  const status = h("p", { class: "n133s-status", role: "status", "aria-live": "polite", hidden: test });
  const again = h("button", { class: "n133s-btn n133s-wide", type: "button", hidden: true }, w.checkAgain);
  /** The time left, live only: in test mode nothing is paid, so nothing waits for the end. */
  const ends = h("p", { class: "n133s-fine n133s-time-left", hidden: test });
  const amount = h(
    "div",
    { class: "n133s-amount" },
    test ? null : h("span", { class: "n133s-exact" }, w.sendExactly),
    h("strong", {}, w.amount(order.xno)),
    h("span", {}, w.usd(usdText(Number(order.usd)))),
  );
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

  let payArea: HTMLElement;
  /** The main key (the wallet link; off in test mode): it stands in a foot that stays in view, so a phone on its side never hides it. */
  let wallet: HTMLElement;
  if (test) {
    payArea = h(
      "div",
      { class: "n133s-test-pay" },
      h("div", { class: "n133s-qr n133s-qr-blocked", "aria-hidden": "true" }, h("div", { class: "n133s-qr-fake" })),
      h("div", { class: "n133s-stamp", role: "alert" }, h("span", {}, "TEST MODE:"), " ", h("span", {}, "DO NOT PAY")),
      h("p", { class: "n133s-fine" }, w.testNote),
    );
    wallet = h("button", { class: "n133s-btn n133s-primary n133s-wide", type: "button", disabled: true }, w.walletOff);
  } else {
    payArea = h(
      "div",
      { class: "n133s-live-pay" },
      h("div", { class: "n133s-qr" }, qrSvg(order.uri!, w.qrLabel(order.xno))),
      h(
        "details",
        { class: "n133s-by-hand" },
        h("summary", {}, w.byHand),
        h("div", { class: "n133s-row" }, h("span", { class: "n133s-label" }, w.amountLabel), h("code", {}, w.amount(order.xno)), copyKey(order.xno)),
        h("div", { class: "n133s-row" }, h("span", { class: "n133s-label" }, w.toLabel), h("code", { class: "n133s-address" }, order.address!), copyKey(order.address!)),
        h("p", { class: "n133s-fine" }, w.byHandNote),
      ),
    );
    wallet = h("a", { class: "n133s-btn n133s-primary n133s-wide", href: order.uri! }, w.wallet);
  }

  const node = h(
    "div",
    { class: `n133s-pay${test ? " n133s-is-test" : ""}` },
    h(
      "div",
      { class: "n133s-pay-main" },
      h("p", { class: "n133s-pay-what" }, options.play ? w.playLine(options.play.use) : w.lookLine(options.lookName)),
      amount,
      options.refund ? h("p", { class: "n133s-fine n133s-refund" }, options.refund) : null,
      payArea,
    ),
    h(
      "div",
      { class: "n133s-pay-side" },
      ends,
      status,
      again,
      h("p", { class: "n133s-fine n133s-prices" }, priceLine(w, order.prices)),
      h("div", { class: "n133s-foot" }, wallet),
    ),
  );

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = undefined;
  };

  const tick = () => {
    const ms = Math.max(0, order.expiresAt - now());
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    ends.textContent = w.endsIn(`${m}:${String(s).padStart(2, "0")}`);
  };
  tick();
  clockTimer = setInterval(tick, 1000);

  function show(o: PayView): boolean {
    order = o;
    if (o.status === "paid") {
      stop();
      payArea.replaceChildren(h("div", { class: "n133s-paid" }, ...(options.play ? [h("strong", {}, w.playPaid(options.play.use))] : [h("strong", {}, w.paid), h("p", {}, w.paidLine(options.lookName))])));
      wallet.hidden = true;
      status.textContent = "";
      again.hidden = true;
      options.onPaid(o);
      return true;
    }
    if (o.status === "paid_late") {
      stop();
      status.textContent = options.play ? w.playLate(options.play.use) : w.paidLate;
      again.hidden = true;
      return true;
    }
    if (o.status === "expired") {
      stop();
      status.textContent = w.expired;
      again.hidden = false;
      return false;
    }
    return false;
  }

  async function poll() {
    if (stopped) return;
    try {
      const o = await options.check(order.id);
      if (show(o)) return;
      if (o.status === "open") status.textContent = test ? "" : w.waiting;
    } catch (e) {
      status.textContent = options.errorText?.(e) ?? w.noConnection;
    }
    if (now() < checkingUntil) timer = setTimeout(poll, PAY_TIMING.pollMs);
    else if (!stopped) {
      status.textContent = w.stillWaiting;
      again.hidden = false;
    }
  }

  function startChecking() {
    stopped = false;
    again.hidden = true;
    checkingUntil = now() + PAY_TIMING.checkForMs;
    clockTimer ??= setInterval(tick, 1000);
    void poll();
  }
  again.addEventListener("click", startChecking);
  // Test mode makes no checks: nothing can be paid, so nothing is waited for.
  if (!test) startChecking();

  return { node, stop };
}
