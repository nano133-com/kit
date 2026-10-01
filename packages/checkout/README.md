# @nano133/checkout

Take Nano (XNO) payments on your own site: a checkout with a unique amount,
a payment check on your own node, and a signed receipt.

No key on your server: you only need the address that receives the money.
The money goes straight to your wallet.

## How it works

1. **`createCheckout`** asks for the price plus a random tail of 1 to 999999
   raw (at most 0.000000000000000000000001 XNO). That exact amount is locked
   until the checkout's expiry plus its grace, so no other checkout asks for
   it while a payment of it can still count. The amount is the receipt:
   no memo is needed.
2. The buyer pays that exact amount: a QR code of `nanoUri(address, amount)`
   or an "Open in wallet" link.
3. **`claimCheckout`** asks your node for a **confirmed** send of **exactly**
   that amount **to your address**, first seen **inside the checkout's
   window**. An older payment of the same amount is skipped. One payment
   pays one checkout, once. When the node doesn't answer, it throws, and
   nothing is credited.
4. On success you get a **receipt** (HMAC-signed with your secret) for a
   cookie or a restore link. `verifyReceipt` checks it offline.

| Default | Value |
|---|---|
| A checkout is open | 15 minutes (`ttlMs`) |
| A late payment still counts | 1 hour after that (`graceMs`) |
| Prices round up to | 0.0001 XNO |
| A receipt is valid | 30 days (`receiptTtlSec`) |

## Install

```sh
npm install @nano133/checkout
```

No runtime dependencies. You bring:

| You provide | What it is |
|---|---|
| `rpc` | A function that calls your Nano node and rejects on `{ error }`. Use your own node: its answers decide what you credit. |
| `store` | `memoryStore()` (tests) or `firestoreStore(db, …)`, or your own `CheckoutStore` (any database with transactions). |
| `to` | Your address. |
| `receiptSecret` | A long random secret, from your secret manager. Optional. |

## Use

```ts
import { createCheckout, claimCheckout, priceRaw, nanoUri, xnoUsdRate, verifyReceipt } from "@nano133/checkout";
import { firestoreStore } from "@nano133/checkout/firestore";

const options = {
  rpc,
  store: firestoreStore(db, { checkouts: "checkouts", amounts: "checkout_amounts", payments: "payments" }),
  to: "nano_…your address…",
  receiptSecret: process.env.RECEIPT_SECRET,
};

// POST /checkout
const rate = await xnoUsdRate();                    // cache it a few minutes
const c = await createCheckout(options, { item: "article:42", price: priceRaw(0.05, rate!.usd) });
// → show nanoUri(c.to, c.amount) as a QR code and a link; poll the claim

// POST /claim  { id, hash? }
const r = await claimCheckout(options, id, hash ?? null);
if (r.state === "paid") setCookie("receipt", r.receipt);   // only for the browser that started it

// On the paid page
const ok = verifyReceipt(process.env.RECEIPT_SECRET!, cookie, { item: "article:42" });
```

`claimCheckout` answers `paid`, `waiting`, `pending` (seen, not confirmed),
`expired`, `wrong` (that block isn't this payment), `invalid`, `used`
(another checkout's payment) or `unknown`.

### With Late Payment Return

A payment that arrives after the grace matches nothing.
[`@nano133/late-returns`](../late-returns) can send it back. Use the same
`payments` collection for both, and the store's `claimable(amount, now)` as
its `isClaimable`.

## Security

- Keep your checkouts' claim route rate-limited per visitor. Each claim may
  ask your node a few questions.
- Give the receipt only to the browser that started the checkout (a cookie
  you set when the checkout is created).
- Show the exact amount to pay. Never round it on the payment screen.
- Prices in USD use a rate. Take the median of several feeds (`xnoUsdRate`)
  and keep the last good rate for when all feeds fail.

## Test

```sh
npm test                                          # the mock ledger
FIRESTORE_EMULATOR_HOST=localhost:8080 npm test   # also the Firestore store, on an emulator
npm run example
```

MIT. From [nano133.com](https://nano133.com).
