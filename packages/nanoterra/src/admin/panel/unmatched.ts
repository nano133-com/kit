// The "Unmatched payments" card of the Overview tab: the payments to the game's address that match no order (a second payment of an amount after its
// order was paid, a wrong amount, a payment with no order). The game holds no key, so it sends nothing back: the creator checks each one, and sends it
// back by hand from their wallet or keeps it. The card reads nothing until the owner presses "Check the address", so the admin's normal load asks no
// node. Text only: nothing the node said is read as HTML.

import type { UnmatchedPayment, UnmatchedResult } from "../../shop/unmatched.js";
import type { AdminSummary } from "../store.js";
import { ApiError, type Api } from "./api.js";
import { ago, copyKey, h, plural, shortAddress } from "./dom.js";
import { icon } from "./icons.js";

export type UnmatchedCard = {
  el: HTMLElement;
  /** Shows the card only when the game gave the read (the summary's canListUnmatched). A new summary keeps the last list. */
  update(s: AdminSummary): void;
};

const when = (ms: number) => new Date(ms).toLocaleString();
const day = (ms: number) => new Date(ms).toLocaleDateString();
/** "A1B2C3D4…E5F6A7" */
const shortHash = (hash: string) => (hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash);

/** One payment: the amount (XNO and raw), where it came from, when, its block, and a mark when a send of the same amount went back to that address. */
function row(p: UnmatchedPayment): HTMLElement {
  return h(
    "li",
    { class: "unmatched-row", "data-hash": p.hash },
    h("div", { class: "unmatched-line" }, h("strong", {}, `${p.xno} XNO`), h("span", { class: "fine", title: when(p.at) }, ago(p.at)), p.sentBack ? h("span", { class: "pill pill-on", title: "A send of the same amount to this address came after it." }, "Looks sent back") : null),
    h("div", { class: "unmatched-line fine" }, h("span", {}, "Raw "), h("code", { class: "unmatched-raw" }, p.amountRaw)),
    h(
      "div",
      { class: "unmatched-line" },
      h("span", { class: "fine" }, "From "),
      p.sender ? h("code", { title: p.sender }, shortAddress(p.sender)) : h("span", {}, "an address the node did not give"),
      p.sender ? copyKey(p.sender, "Copy the address it came from", icon("copy", 14)) : null,
    ),
    h("div", { class: "unmatched-line" }, h("span", { class: "fine" }, "Block "), h("code", { title: p.hash }, shortHash(p.hash)), copyKey(p.hash, "Copy the block hash", icon("copy", 14))),
  );
}

export function unmatchedCard(api: Api): UnmatchedCard {
  const check = h("button", { class: "btn", type: "button" }, icon("search", 18), "Check the address");
  const note = h("p", { class: "fine", role: "status", "aria-live": "polite" });
  const list = h("ul", { class: "send-back-list unmatched-list" });
  const foot = h("p", { class: "fine" });
  foot.hidden = true;
  const el = h(
    "section",
    { class: "admin-card unmatched-card", "aria-labelledby": "n133-unmatched-title" },
    h("div", { class: "card-head" }, h("h2", { id: "n133-unmatched-title" }, "Unmatched payments"), check),
    h("p", { class: "fine" }, "Payments to your address that match no order. Check each one before you send it back."),
    note,
    list,
    foot,
  );
  el.hidden = true;

  function draw(r: UnmatchedResult) {
    list.replaceChildren();
    foot.hidden = true;
    if (!r.read) {
      note.textContent = "Could not read your address. Nothing is listed. Try again in a moment.";
      return;
    }
    if (r.since === null) {
      note.textContent = "No order yet, so no payment can be compared with one.";
      return;
    }
    note.textContent = r.payments.length ? `${r.payments.length === 1 ? "1 payment matches" : `${r.payments.length} payments match`} no order.` : "No unmatched payment.";
    list.replaceChildren(...r.payments.map(row));
    const parts = [`Read the last ${r.entries} ${r.entries === 1 ? "entry" : "entries"} of your address, since the first order (${day(r.since)}).`];
    if (r.more) parts.push("Older entries were not read.");
    if (r.waiting) parts.push(`${plural(r.waiting, "payment")} may still pay an open order: the payment check decides.`);
    parts.push("The game holds no key, so it sends nothing back.");
    foot.textContent = parts.join(" ");
    foot.hidden = false;
  }

  check.addEventListener("click", async () => {
    check.disabled = true;
    note.textContent = "Reading your address…";
    try {
      const answer = await api.post<{ unmatched: UnmatchedResult }>("/unmatched");
      draw(answer.unmatched && typeof answer.unmatched === "object" ? answer.unmatched : { read: false, error: "no answer" });
    } catch (e) {
      list.replaceChildren();
      foot.hidden = true;
      note.textContent = e instanceof ApiError && e.status === 429 ? e.message : "Could not read your address. Nothing is listed. Try again in a moment.";
    } finally {
      check.disabled = false;
    }
  });

  return {
    el,
    update(s) {
      el.hidden = !s.canListUnmatched;
    },
  };
}
