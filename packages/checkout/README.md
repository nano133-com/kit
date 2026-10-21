# @nano133/checkout

Stage: Beta. What this means: https://nano133.com/stages

Take Nano (XNO) payments on your own site: **an address for each checkout**,
a clean amount, an exact payment check on your own node, a sweep that moves
the money on to your wallet, and a signed receipt.

> [!WARNING]
> **The recommended way (an address for each checkout) puts a seed on your
> server.** Every checkout address comes from one secret, so the server can
> sign for all of them: that is a hot wallet. The sweep moves each payment on
> to your own address, so little money waits there, but anyone who gets the
> secret can take what waits and can derive every address. Keep the secret in
> your secret manager (never in code or in the database), use your own Nano
> node, and test with a mock ledger or tiny amounts first. The older way
> (one address, a unique amount) needs no key on your server, and it has a
> limit that the section "The older way" explains. The software comes with no
> warranty (MIT license).

## Why an address for each checkout

The older way gave every checkout the same address and told checkouts apart by a
unique amount: the price plus a tail in the last digits. A wallet that cuts or
rounds the amount before it sends can never be matched. On nano133.com, Cake
Wallet sent 0.0593 XNO for a quote of 0.059300000000000000000000801448 XNO, and
nothing could match that payment.

Here the **address** names the checkout, so the amount can be **clean**: the
price rounded up to a whole 0.0001 XNO, with no tail. A wallet that keeps four
decimals sends exactly that amount. The check is **exact** (no tolerance): any
other amount is not the checkout's payment, and Late Payment Return sends it
back in full.

## How it works

1. **`createDerivedCheckout`** takes the next index from a counter in your store
   (atomic: two checkouts at once never share an index), derives the address of
   that index from your secret, and saves the checkout with its address, its
   index, a clean quote, a window and a grace. There is no unique tail and no
   amount lock.
2. The buyer pays that amount to that address: a QR code of
   `nanoUri(c.to, c.amount)` or an "Open in wallet" link.
3. **`claimCheckout`** (the same function as before) asks your node for a
   **confirmed** send of **exactly** the quote **to the checkout's address**,
   first seen **inside the checkout's window**. One payment pays one checkout,
   once. When the node doesn't answer, it throws, and nothing is credited.
4. **`sweepPaid`** (or `sweepCheckout` for one checkout) receives that one paid
   block at the address and sends **exactly the quote** to **your address**. The
   send is recorded before it is published, so a crash or a second run never
   sends twice.
5. **`derivedReturns`** gives
   [`@nano133/late-returns`](../late-returns) the addresses, a signer for each
   and the claim rule, so a payment of **any other amount** (rounded, short,
   over, a second payment, a late one) goes back to its sender in full, from
   the address that got it.

| Default | Value |
|---|---|
| A checkout is open | 15 minutes (`ttlMs`) |
| A late payment still counts | 1 hour after that (`graceMs`) |
| The quote | the price rounded **up** to 0.0001 XNO; a price below 0.0001 XNO is refused |
| The most addresses | 1,000,000 (`DERIVED_INDEX_CAP`) |
| Late Payment Return watches an address | 7 days after the grace (`keepMs`) |
| A receipt is valid | 30 days (`receiptTtlSec`) |

## Install

```sh
npm install @nano133/checkout nanocurrency-web @noble/hashes
```

The package's main entry has no runtime dependencies. The derived-address mode is
a separate entry, `@nano133/checkout/derived`, and it needs `nanocurrency-web`
and `@noble/hashes` (optional peer dependencies: you install them). You bring:

| You provide | What it is |
|---|---|
| `rpc` | A function that calls your Nano node and rejects on `{ error }`. Use your own node: its answers decide what you credit and what you send. It must allow `receivable`, `block_info`, `account_info`, `account_history`, `work_generate` and `process`. |
| `store` | `memoryStore()` (tests) or `firestoreStore(db, …)` with a `counter`, or your own `DerivedStore`. |
| `secret` | At least 32 characters, from your secret manager: 32 random bytes in hex (`openssl rand -hex 32`). |
| `destination` | **Your** address, where each payment ends. A fixed value in your code. |
| `receiptSecret` | A long random secret for receipts. Optional. |

## Use

```ts
import { claimCheckout, priceRaw, nanoUri, xnoUsdRate, verifyReceipt } from "@nano133/checkout";
import { createDerivedCheckout, derivedReturns, sweepPaid } from "@nano133/checkout/derived";
import { firestoreStore } from "@nano133/checkout/firestore";

const store = firestoreStore(db, { checkouts: "checkouts", amounts: "checkout_amounts", payments: "payments", counter: "checkout_index/counter" });
const options = { rpc, store, secret: process.env.CHECKOUT_SECRET!, receiptSecret: process.env.RECEIPT_SECRET };

// POST /checkout
const rate = await xnoUsdRate();                    // cache it a few minutes
const c = await createDerivedCheckout(options, { item: "article:42", price: priceRaw(0.05, rate!.usd) });
// → show nanoUri(c.to, c.amount) as a QR code and a link; poll the claim

// POST /claim  { id, hash? }
const r = await claimCheckout(options, id, hash ?? null);
if (r.state === "paid") setCookie("receipt", r.receipt);   // only for the browser that started it

// On a timer (every few minutes, or once a day: the money waits until then)
const MY_ADDRESS = "nano_…";                        // fixed in your code
await sweepPaid({ ...options, destination: MY_ADDRESS });
```

`claimCheckout` answers `paid`, `waiting`, `pending` (seen, not confirmed),
`expired`, `wrong` (that block isn't this payment), `invalid`, `used` or
`unknown`. A paid derived checkout has `sweep.status` `"due"` until its sweep
ends.

### The sweep

`sweepCheckout(options, id)` and `sweepPaid(options, { max })` receive the paid
block at the checkout's address and send exactly the quote to `destination`.

- **`destination` is a value in your code.** The sweep never reads it from a
  checkout, a request or a database row, so a record, a bug or an attacker
  cannot make it send anywhere else. Never pass `c.meta.something` as the
  destination.
- It stops and moves nothing unless the record is whole: the index must give
  exactly the address (a record whose index gives another address is refused),
  and the stored block must be a **confirmed send of the quote to that
  address**, checked again on your node.
- It receives only that block. A wrong amount that waits at the address is not
  touched: Late Payment Return sends it back.
- **Exactly once.** A lease on the checkout lets one run work. The signed send is
  recorded on the checkout before it is published. A later run checks the
  ledger: if the block is there, the sweep is done; if not and the address has
  not moved, the same block is published again (it can only land once). Run it
  twice, or at the same time from two processes, and one send happens.
- The sweep's own send is marked as a used payment in your `payments`
  collection, so Late Payment Return never sends it back to the address it came
  from.
- It returns `"swept"`, `"already"`, `"waiting"` (not paid), `"busy"` (another run
  has it) or `"unknown"`. It throws when the node doesn't answer or a check
  fails, and writes the error on the checkout (`sweep.error`, `sweep.tries`);
  the next run tries again. Nothing is logged: no key, no seed.
- Work comes from your node's `work_generate`, or from `work(root, kind)` if you
  pass one.

### Late returns: any other amount goes back in full

```ts
import { runLateReturns } from "@nano133/late-returns";   // 0.4.0 or later
import { firestoreStore as returnStore } from "@nano133/late-returns/firestore";

const derived = derivedReturns({ store, secret: process.env.CHECKOUT_SECRET! });
await runLateReturns({
  rpc,
  store: returnStore(db, { returns: "returns", used: ["payments"], meta: "returns_meta" }),
  signer: shopWallet,                  // the wallet Late Payment Return runs for (see below)
  ...derived,                          // addresses, signerFor, isClaimable
  // Your wallet's own rule joins the derived one:
  isClaimable: async (p) => (await derived.isClaimable(p)) || shopRule(p),
});
```

`derivedReturns` gives three things:

- `addresses()`: the addresses of the checkouts that are still watched (open, or
  ended less than `keepMs` ago), newest first, at most 300.
- `signerFor(address)`: a signer for that address, made from the checkout's own
  index. The index must give exactly that address, or the answer is `null` and
  that return waits.
- `isClaimable({ amount, to })`: true only for the **exact quote** of a
  **waiting** checkout, at **its own address**, inside its window and grace. Every
  other payment there is not claimable.

Use the **same `payments` collection** for the checkout store and for Late
Payment Return's `used`: a claimed payment and a sweep's send are marked there,
and Late Payment Return then skips them. A payment goes back after at least 2
hours (its default `minAgeSec`) and at least 0.001 XNO (`minRaw`). Run the
returns and the sweep one after the other: both build blocks on the same address,
and when they meet, one of them fails and tries again on its next run (no money
is lost).

`signer` is the wallet that Late Payment Return runs for first. A shop with no
other wallet key on the server can pass `derivedSigner(secret, 0)`: index 0 is
one of the derived addresses, and an address in `addresses` is never scanned
twice.

### The secret, the label and the index

- Address `n` is the legacy account `n` of the seed `HMAC-SHA256(secret, label)`
  (hex), the way most wallets derive an account from a seed. `label` defaults to
  `DEFAULT_SEED_LABEL` (`"nano133 kit checkout seed v1"`). Pass your own label
  (`label: "…"`, to `createDerivedCheckout`, `sweepCheckout` and `derivedReturns`)
  if you want addresses that no one else's use of this package can share.
  nano133.com keeps its own label for its own checkouts, so the package's
  default never gives the site's addresses.
- **Never change the secret or the label after the first checkout.** Every earlier
  address then has a key that can no longer be derived: its money cannot be swept
  or returned. Back the secret up the way you back up a wallet seed. With it you
  can always recover what waits at any address.
- The counter is one document (`counter`, default `checkout_index/counter`):
  never delete it or lower it. The store refuses to save a checkout whose address
  already has one, but the counter must only grow. The cap is
  1,000,000 addresses (`DERIVED_INDEX_CAP`): a counter that reaches it throws.
- No function returns, logs or stores a seed or a private key. A key exists only
  inside a signer (`derivedSigner`) and inside the sweep. `deriveAddress` gives an
  address and its public key.

### Your own store

`DerivedStore` (see `src/types.ts`) is a `CheckoutStore` plus: `takeIndex(cap)`,
`createDerived`, `byAddress`, `derivedAddresses`, `unswept`, `claimSweep`,
`patchSweep`, `finishSweep` and `releaseSweep`. The hard rules: `takeIndex` is
atomic and never gives a number twice; `createDerived` refuses an address that
has a checkout; `claimSweep`, `patchSweep` and `finishSweep` are atomic and fail
with `SweepLeaseLost` when the lease is not the caller's; `finishSweep` also marks
the send's hash used. `markPaid` must set `sweep.status` to `"due"` for a checkout
that has an `index`, and `claimable(amount, now)` must ignore such checkouts.
`memoryStore` and `firestoreStore` do all of it.

## The older way: one address and a unique amount

> [!NOTE]
> **This way has a limit.** It tells checkouts apart by a tail in the last digits of
> the amount (the price plus 1 to 999,999 raw). A wallet that cuts or rounds the
> amount before it sends makes a payment that matches nothing: the buyer pays and
> gets nothing until someone sends the money back. Cake Wallet did this to a real
> checkout on nano133.com (it sent 0.0593 XNO for 0.059300000000000000000000801448
> XNO). The way above has no tail.

It needs no key on your server, only the address that receives the money, and it
keeps working exactly as before:

1. **`createCheckout`** asks for the price plus a random tail of 1 to 999999 raw
   and locks that exact amount until the checkout's expiry plus its grace.
2. The buyer pays that exact amount to your address.
3. **`claimCheckout`** asks your node for a confirmed send of exactly that amount
   to your address, first seen inside the checkout's window.
4. On success you get a **receipt**; `verifyReceipt` checks it offline.

```ts
import { createCheckout, claimCheckout, priceRaw, nanoUri, xnoUsdRate, verifyReceipt } from "@nano133/checkout";
import { firestoreStore } from "@nano133/checkout/firestore";

const options = {
  rpc,
  store: firestoreStore(db, { checkouts: "checkouts", amounts: "checkout_amounts", payments: "payments" }),
  to: "nano_…your address…",
  receiptSecret: process.env.RECEIPT_SECRET,
};
const c = await createCheckout(options, { item: "article:42", price: priceRaw(0.05, rate!.usd) });
const r = await claimCheckout(options, id, hash ?? null);
```

`npm install @nano133/checkout` is all it needs. For late payments, give
[`@nano133/late-returns`](../late-returns) the same `payments` collection and the
store's `claimable(amount, now)` as its `isClaimable`. `claimable` looks at
checkouts of this way only: a derived checkout is claimed by its own address.

## Security

- Keep your checkouts' claim route rate-limited per visitor. Each claim may
  ask your node a few questions.
- Give the receipt only to the browser that started the checkout (a cookie
  you set when the checkout is created).
- Show the exact amount to pay. Never round it on the payment screen.
- Prices in USD use a rate. Take the median of several feeds (`xnoUsdRate`)
  and keep the last good rate for when all feeds fail.
- With derived addresses: keep the secret out of code, logs and the database;
  fix `destination` in code; run the sweep from a scheduled job, not from a
  visitor's request; keep only small amounts at risk (the sweep moves each paid
  quote on, and returns send strays back).

## Test

```sh
npm test                                          # the mock ledger
FIRESTORE_EMULATOR_HOST=localhost:8080 npm test   # also the Firestore store, on an emulator
npm run example                                   # the older way
npm run example:derived                           # an address for each checkout
```

MIT. From [nano133.com](https://nano133.com).
