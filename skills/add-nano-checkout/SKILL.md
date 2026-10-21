---
name: add-nano-checkout
description: Add Nano (XNO) payments to a website with @nano133/checkout - an address for each checkout (or one address and a unique amount), a payment check on a Nano node, a sweep, and a signed receipt. Use when the user asks to accept Nano or XNO payments, sell something for Nano, or add Nano Checkout.
---

# Add Nano Checkout

Follow the package's `ai/SPEC.md` step by step
(https://nano133.com/build/nano-checkout/SPEC.md, or
`node_modules/@nano133/checkout/ai/SPEC.md` after install).

1. **Ask** which way. Way A: an address for each checkout, a clean amount and a
   sweep to the owner's address. It puts a seed on the server, so ask whether
   that is acceptable, and recommend it when the owner has a server. Way B, the
   keyless way (one address, a unique amount), needs no key and fits a Worker or
   a site with no server, but a wallet that cuts or rounds the amount (Cake
   Wallet) can never pay it.
2. **Ask** for the owner's receiving address (way A: the sweep's `destination`, fixed
   in code), the node, and what is sold at what price.
3. Install `@nano133/checkout` (way A also `nanocurrency-web` and `@noble/hashes`);
   build `rpc`; pick or write the store.
4. **Ask** where secrets live; create `RECEIPT_SECRET` (and way A's `CHECKOUT_SECRET`)
   there. Never print them. Never change `CHECKOUT_SECRET` or the label later.
5. Checkout route: the price from the server, `createDerivedCheckout` (A) or
   `createCheckout` (B), a starter cookie, rate-limited.
6. Payment screen: QR code, wallet link, the exact amount, the address, time left.
7. Claim route: `claimCheckout`; map each state to its answer; 503 when the node doesn't answer.
8. Way A: a timer runs `sweepPaid` with the fixed `destination`.
9. Receipts: verify on the server before showing paid content.
10. Offer Late Payment Return for late and wrong payments (way A: `derivedReturns`;
    needs the server-held key).
11. Test with the mock ledger, then one real payment.

Finish with the SPEC's "Done when" list, item by item.
