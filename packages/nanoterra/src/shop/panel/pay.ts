// The pay sheet for one order (the game starter's src/client/ui/pay.ts). It shows the exact amount, a QR code and a "nano:" link for the wallet, and asks
// the game every 5 seconds whether the payment arrived, for 2 minutes per check.
//
// TEST MODE: the server sends no address and no link, and this sheet shows a large "TEST MODE: DO NOT PAY" stamp where the QR code would be, with the
// wallet key off. Never change that: a payment to an address that nobody holds the key for is lost for good. The sheet decides it from the ORDER (its
// `test`, a missing `uri` or a missing `address`), never from a setting of the page.

import { copy, h } from "../../admin/panel/dom.js";
import { usdText } from "../../looks/look.js";
import type { PayView } from "../handler.js";
import { qrSvg } from "./qr.js";

export const PAY_TIMING = { pollMs: 5000, checkForMs: 2 * 60_000 } as const;

export type PayOptions = {
  /** The look's name, for the line at the top. */
  lookName: string;
  /** POST {base}/{id}/check: the order again, after a payment scan. */
  check(id: string): Promise<PayView>;
  /** The order is paid: the look is the player's now. */
  onPaid(order: PayView): void;
  /** Words of a failed check (an ApiError's message), or null for "No connection". */
  errorText?(e: unknown): string | null;
  /** The time now in ms (a test gives its own). */
  now?: () => number;
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

  const status = h("p", { class: "n133s-status", role: "status", "aria-live": "polite" });
  const again = h("button", { class: "n133s-btn n133s-wide", type: "button", hidden: true }, "Check again");
  const left = h("span", { class: "n133s-time-left" });
  const amount = h("div", { class: "n133s-amount" }, h("strong", {}, `${order.xno} XNO`), h("span", {}, ` = ${usdText(Number(order.usd))}`));

  let payArea: HTMLElement;
  /** The main key (the wallet link; off in test mode): it stands in a foot that stays in view, so a phone on its side never hides it. */
  let wallet: HTMLElement;
  const test = isTestOrder(order);
  if (test) {
    payArea = h(
      "div",
      { class: "n133s-test-pay" },
      h("div", { class: "n133s-qr n133s-qr-blocked", "aria-hidden": "true" }, h("div", { class: "n133s-qr-fake" })),
      h("div", { class: "n133s-stamp", role: "alert" }, h("span", {}, "TEST MODE:"), " ", h("span", {}, "DO NOT PAY")),
      h("p", { class: "n133s-fine" }, "This game is in test mode, so nothing can be paid here. To sell for real, the creator sets their own receive address and turns test mode off."),
    );
    wallet = h("button", { class: "n133s-btn n133s-primary n133s-wide", type: "button", disabled: true }, "Open wallet (off in test mode)");
  } else {
    const copyAmount = h("button", { class: "n133s-btn n133s-small", type: "button" }, "Copy");
    copyAmount.addEventListener("click", () => copy(order.xno, copyAmount));
    const copyAddress = h("button", { class: "n133s-btn n133s-small", type: "button" }, "Copy");
    copyAddress.addEventListener("click", () => copy(order.address!, copyAddress));
    payArea = h(
      "div",
      { class: "n133s-live-pay" },
      h("div", { class: "n133s-qr" }, qrSvg(order.uri!, `QR code to pay ${order.xno} XNO`)),
      h(
        "details",
        { class: "n133s-by-hand" },
        h("summary", {}, "Enter it by hand"),
        h("div", { class: "n133s-row" }, h("span", { class: "n133s-label" }, "Amount"), h("code", {}, `${order.xno} XNO`), copyAmount),
        h("div", { class: "n133s-row" }, h("span", { class: "n133s-label" }, "To"), h("code", { class: "n133s-address" }, order.address!), copyAddress),
        h("p", { class: "n133s-fine" }, "Send exactly this amount, with every digit. Another amount does not match this order."),
      ),
    );
    wallet = h("a", { class: "n133s-btn n133s-primary n133s-wide", href: order.uri! }, "Open wallet");
  }

  const node = h(
    "div",
    { class: `n133s-pay${test ? " n133s-is-test" : ""}` },
    h(
      "div",
      { class: "n133s-pay-main" },
      h("p", { class: "n133s-pay-what" }, `${options.lookName}: a look for your character. It changes how you look, not how you play.`),
      amount,
      payArea,
    ),
    h(
      "div",
      { class: "n133s-pay-side" },
      h("p", { class: "n133s-fine" }, "This order ends in ", left, "."),
      status,
      again,
      h("p", { class: "n133s-fine n133s-prices" }, `Price in XNO from ${order.prices.join(", ")}. Powered by CoinGecko.`),
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
    left.textContent = `${m}:${String(s).padStart(2, "0")}`;
  };
  tick();
  clockTimer = setInterval(tick, 1000);

  function show(o: PayView): boolean {
    order = o;
    if (o.status === "paid") {
      stop();
      payArea.replaceChildren(h("div", { class: "n133s-paid" }, h("strong", {}, "Paid. Thank you!"), h("p", {}, `${options.lookName} is yours now.`)));
      wallet.hidden = true;
      status.textContent = "";
      again.hidden = true;
      options.onPaid(o);
      return true;
    }
    if (o.status === "paid_late") {
      stop();
      status.textContent = "This payment came after the order ended. The look was not given. The creator sees it and can send it back.";
      again.hidden = true;
      return true;
    }
    if (o.status === "expired") {
      stop();
      status.textContent = "This order ended. If you already paid, wait here: a payment sent in time still counts.";
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
      if (o.status === "open") status.textContent = test ? "Test mode: the game does not wait for a payment." : "Waiting for your payment…";
    } catch (e) {
      status.textContent = options.errorText?.(e) ?? "No connection. Trying again…";
    }
    if (now() < checkingUntil) timer = setTimeout(poll, PAY_TIMING.pollMs);
    else if (!stopped) {
      status.textContent = "Still waiting. Already paid? Press Check again.";
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
  if (!test) startChecking();
  else status.textContent = "Test mode: the game does not wait for a payment.";

  return { node, stop };
}
