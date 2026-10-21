# Nano Checkout: implementation spec

Follow these steps in order. Each step ends with a check. Stop and ask the
site owner when a step says "ask".

Package: `@nano133/checkout` (TypeScript). The main entry has no runtime
dependencies. Way A below uses the entry `@nano133/checkout/derived`, which
needs `nanocurrency-web` and `@noble/hashes`. It works with any Node.js server
(Express, Next.js, React Router, Fastify) and any database that has transactions.

Two ways to take a payment:

- **Way A, an address for each checkout (recommended).** Each checkout gets its
  own receiving address, derived from one secret and an index. The amount is
  clean (the price rounded up to 0.0001 XNO, no tail) and the payment must be
  exactly that amount at exactly that address. A sweep moves each payment on to
  the owner's address. Any other amount goes back to its sender in full. **The
  server holds a seed**: a hot wallet.
- **Way B, one address and a unique amount (the older way).** Every checkout pays
  the owner's one address and gets the price plus a small random tail. The
  server holds no key. **Limit:** a wallet that cuts or rounds the amount before
  it sends (Cake Wallet cut 0.059300000000000000000000801448 XNO to 0.0593) makes
  a payment that can never be matched.

## 0. What the owner decides (ask)

1. **The way.** Explain the two ways above in two sentences. Recommend way A.
   Ask: "Is it acceptable that the server holds a seed that can sign for the
   checkout addresses?" If not, use way B and tell the owner its limit.
2. The owner's receiving address (`nano_…`). In way A it is the sweep's
   `destination`: a fixed value in the code. In way B it is `to`.
3. The node: their own, or a public RPC they trust. Its answers decide what is
   credited (and in way A, what is sent).
4. What is sold, and its price (in USD, or a fixed XNO amount). In way A a price
   below 0.0001 XNO is refused.

**Check:** you have the way, the address, the node URL and a price.

## 1. Install

```sh
npm install @nano133/checkout
npm install nanocurrency-web @noble/hashes   # way A only
```

For late payments (step 9), also `npm install @nano133/late-returns` (0.4.0 or later).

## 2. The node

```ts
const rpc = async <T>(body: Record<string, unknown>, timeoutMs = 10_000): Promise<T> => {
  const res = await fetch(NODE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json as T;
};
```

The node must allow `receivable` and `block_info`. Way A also needs
`account_info`, `account_history`, `work_generate` and `process`.

**Check:** `await rpc({ action: "block_count" })` answers (or another allowed action).

## 3. The store

- **Firestore:** `firestoreStore(db, { checkouts, amounts, payments, counter })`
  from `@nano133/checkout/firestore`. `counter` (way A) is the path of one
  document, default `checkout_index/counter`.
- **Any other database:** implement `CheckoutStore` (way B) or `DerivedStore`
  (way A), see `src/types.ts`:
  - `create(checkout, lockUntil)` (way B): in one transaction, refuse when a
    lock row for `checkout.amount` has `until > checkout.createdAt`; otherwise
    upsert the lock `{ amount, checkout, until: lockUntil }` and insert the
    checkout.
  - `markPaid(id, hash, payer, at)`: in one transaction, answer `"used"`
    when a payment row for `hash` names another checkout; `"taken"` when the
    checkout isn't `waiting`; otherwise insert the payment row and set the
    checkout `paid` with `hash`, `payer`, `paidAt`. In way A also set the
    checkout's `sweep.status` to `"due"` when it has an `index`.
  - `claimable(amount, now)`: is a `waiting` checkout with that `amount`
    and `expiresAt + graceMs > now`? It must ignore checkouts that have an `index`.
  - Way A also: `takeIndex(cap)` (an atomic counter: 0, 1, 2, never a number
    twice, an error at `cap`), `createDerived(checkout)` (save with no amount
    lock; false when the id or the address exists), `byAddress`,
    `derivedAddresses(now, limit)`, `unswept(limit)`, `claimSweep`,
    `patchSweep`, `finishSweep` (also marks the send's hash used) and
    `releaseSweep`. A sweep write fails with `SweepLeaseLost` when the lease is
    not the caller's.

For PostgreSQL, way B:

```sql
create table checkouts (id text primary key, item text not null, amount text not null, "to" text not null,
  status text not null, created_at bigint not null, expires_at bigint not null, grace_ms bigint not null,
  meta jsonb, hash text, payer text, paid_at bigint);
create index on checkouts (amount, status);
create table checkout_amounts (amount text primary key, checkout text not null, until bigint not null);
create table payments (hash text primary key, checkout text);   -- also used by Late Payment Return
```

For way A, add to `checkouts`: `index int, scan_until bigint, sweep jsonb`, an index on `("to")`, and a
one-row counter table that `takeIndex` updates with `update … returning`.

**Check:** way B: two `create` calls with the same amount: the second answers false.
Way A: ten `takeIndex(1_000_000)` calls at once give ten different numbers.

## 4. The secrets (ask)

Ask where secrets live (a secret manager, or encrypted environment variables).

- `RECEIPT_SECRET` (optional): `openssl rand -hex 32`. Never print, log or commit it.
- **Way A: `CHECKOUT_SECRET`**: `openssl rand -hex 32`, at least 32 characters.
  Every checkout address comes from it. **Never change it, and never change the
  `label`, after the first checkout**: every earlier address could then no longer
  be derived, and its money could not be swept or returned. Back it up like a wallet
  seed. Never print, log, return or store it, and never store a private key.

**Check:** the secrets are in the secret store, not in code, not in the repository.

## 5. The checkout route

`POST /api/checkout { item }`:

1. Look up the item's price on the server. Never take a price from the browser.
2. For a USD price: `const rate = await xnoUsdRate()` (cache 5 minutes; keep
   the last good rate; refuse with 503 when there is none).
3. Way A: `const c = await createDerivedCheckout({ rpc, store, secret }, { item, price: priceRaw(usd, rate.usd) })`.
   Way B: `const c = await createCheckout(options, { item, price: priceRaw(usd, rate.usd) })`.
4. Set an httpOnly cookie that marks this browser as the one that started it
   (a random value; store its hash on the checkout's `meta`).
5. Answer `{ id: c.id, amount: c.amount, to: c.to, uri: nanoUri(c.to, c.amount), expiresAt: c.expiresAt }`.
6. Rate-limit this route per visitor (for example 20 per 10 minutes). In way B
   every checkout holds an amount for over an hour; in way A every checkout takes
   one index (the cap is 1,000,000).

**Check:** way A: two checkouts for one item get the same clean amount and two
different addresses. Way B: they get different amounts.

## 6. The payment screen

Show: a QR code of `uri`, an "Open in wallet" link (`href={uri}`), the exact
amount with `toXno(amount)` (all digits, with a copy button), the address
(with a copy button), and the time left. Say: "Send the exact amount from a
wallet you control." Never round the amount on the screen.

## 7. The claim route

`POST /api/claim { id, hash? }` (`hash`: a block the browser saw, or none):

```ts
const r = await claimCheckout(options, id, hash ?? null);   // the same call in both ways
```

Answer by state: `paid` → `{ paid: true }` and, only for the browser that
started it, the receipt cookie; `waiting` → `{ paid: false }`; `pending` →
`{ paid: false, pending: true }`; `expired` → 410; `wrong` / `invalid` → 400;
`used` → 409; `unknown` → 404. When the node doesn't answer, `claimCheckout`
throws: answer 503 ("try again in a moment").

The browser polls every 2 seconds while the screen is open. Rate-limit per
visitor (for example 180 per minute).

**Check:** with the mock ledger, a paid checkout answers paid once and
again on a second call. Way A: one raw short or one raw over is not paid, and the
exact amount at another checkout's address is not paid. Way B: an older payment of
the same amount does not pay it.

## 8. The sweep (way A)

A timer (a scheduler that calls a protected route, or a cron job) runs:

```ts
await sweepPaid({ rpc, store, secret, destination: MY_ADDRESS });   // MY_ADDRESS: a constant in your code
```

- **`destination` is a fixed value in your code.** Never read it from a checkout,
  a request or a database row.
- The sweep receives only the one paid block and sends exactly the quote, once.
  It is safe to run twice or at the same time. It throws, and moves nothing, when
  a record's index does not give its address or the stored block is not a
  confirmed send of the quote to that address.
- Run it every few minutes, or once a day. Money waits at the address until the
  next run.
- A failed run writes `sweep.error` on the checkout. Alert on `failed` in
  the result of `sweepPaid`.

**Check:** with the mock ledger, pay a checkout, claim it, run the sweep: the
ledger shows one send of exactly the quote to `destination`. A second run sends nothing.

## 9. Late payments

A payment that matches nothing (a late one, or a wrong amount) stays in a wallet.
Add Late Payment Return (`@nano133/late-returns` 0.4.0 or later) with the same
`payments` collection as the store.

- **Way A** (needs the seed, which the server holds anyway):

  ```ts
  const derived = derivedReturns({ store, secret });
  await runLateReturns({ rpc, store: returnStore, signer, ...derived, isClaimable: async (p) => (await derived.isClaimable(p)) || myRule(p) });
  ```

  Every payment to a derived address that is not the exact quote of its waiting
  checkout goes back to its sender in full, from its own address, after 2 hours.
  `signer` is the wallet that Late Payment Return runs for; with no other wallet
  key, use `derivedSigner(secret, 0)`.
- **Way B:** the store's `claimable(amount, now)` as `isClaimable`. That needs a
  wallet whose key the server holds; without it, tell the owner that late payments
  stay in their wallet.

**Check:** way A with the mock ledger: a payment of one step less goes back in full
from its own address; the exact quote of a waiting checkout stays; the sweep's own send
is not returned.

## 10. Test before money

1. `npm run example` (way B) and `npm run example:derived` (way A) in the package.
2. A test in the site with `MockLedger` and `memoryStore()` (from the
   package's `test/`): create, pay, claim, receipt (and in way A, sweep).
3. One real payment of the smallest price, to the owner's address (way A: to the
   checkout's own address, and watch the sweep move it on).

## Done when

- [ ] Prices come from the server, never the browser.
- [ ] The checkout and claim routes are rate-limited per visitor.
- [ ] The receipt goes only to the browser that started the checkout.
- [ ] The payment screen shows the exact amount, a QR code and a wallet link.
- [ ] A node that doesn't answer gives 503, and nothing is credited.
- [ ] The secrets are in a secret store, never logged.
- [ ] Way A: `destination` is fixed in code, the sweep runs on a timer, and the secret and label are backed up and never change.
- [ ] The mock-ledger test passes; one real payment worked.
