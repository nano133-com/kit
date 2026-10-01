---
name: add-nano-checkout
description: Add Nano (XNO) payments to a website with @nano133/checkout - a unique amount per checkout, a payment check on a Nano node, and a signed receipt. Use when the user asks to accept Nano or XNO payments, sell something for Nano, or add Nano Checkout.
---

# Add Nano Checkout

Follow the package's `ai/SPEC.md` step by step
(https://nano133.com/build/nano-checkout/SPEC.md, or
`node_modules/@nano133/checkout/ai/SPEC.md` after install).

1. **Ask** for the receiving address, the node, and what is sold at what price.
2. Install `@nano133/checkout`; build `rpc`; pick or write the store.
3. **Ask** where secrets live; create `RECEIPT_SECRET` there. Never print it.
4. Checkout route: the price from the server, a unique amount, a starter
   cookie, rate-limited.
5. Payment screen: QR code, wallet link, the exact amount, the address, time left.
6. Claim route: map each state to its answer; 503 when the node doesn't answer.
7. Receipts: verify on the server before showing paid content.
8. Offer Late Payment Return for late payments (needs a server-held key).
9. Test with the mock ledger, then one real payment.

Finish with the SPEC's "Done when" list, item by item.
