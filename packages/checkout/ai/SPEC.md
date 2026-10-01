# Nano Checkout: implementation spec

Follow these steps in order. Each step ends with a check. Stop and ask the
site owner when a step says "ask".

Package: `@nano133/checkout` (TypeScript, no runtime dependencies). It works
with any Node.js server (Express, Next.js, React Router, Fastify) and any
database that has transactions.

## 0. What the owner decides (ask)

1. The receiving address (`nano_…`). The money goes straight there. The
   server needs no key.
2. The node: their own, or a public RPC they trust. Its answers decide what
   is credited.
3. What is sold, and its price (in USD, or a fixed XNO amount).

**Check:** you have the address, the node URL and a price.

## 1. Install

```sh
npm install @nano133/checkout
```

## 2. The node

```ts
const rpc = async <T>(body: Record<string, unknown>, timeoutMs = 10_000): Promise<T> => {
  const res = await fetch(NODE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json as T;
};
```

The node must allow `receivable` and `block_info`.

**Check:** `await rpc({ action: "block_count" })` answers (or another allowed action).

## 3. The store

- **Firestore:** `firestoreStore(db, { checkouts, amounts, payments })`
  from `@nano133/checkout/firestore`.
- **Any other database:** implement `CheckoutStore` (see `src/types.ts`):
  - `create(checkout, lockUntil)`: in one transaction, refuse when a lock
    row for `checkout.amount` has `until > checkout.createdAt`; otherwise
    upsert the lock `{ amount, checkout, until: lockUntil }` and insert the
    checkout.
  - `markPaid(id, hash, payer, at)`: in one transaction, answer `"used"`
    when a payment row for `hash` names another checkout; `"taken"` when the
    checkout isn't `waiting`; otherwise insert the payment row and set the
    checkout `paid` with `hash`, `payer`, `paidAt`.
  - `claimable(amount, now)`: is a `waiting` checkout with that `amount`
    and `expiresAt + graceMs > now`?

For PostgreSQL:

```sql
create table checkouts (id text primary key, item text not null, amount text not null, "to" text not null,
  status text not null, created_at bigint not null, expires_at bigint not null, grace_ms bigint not null,
  meta jsonb, hash text, payer text, paid_at bigint);
create index on checkouts (amount, status);
create table checkout_amounts (amount text primary key, checkout text not null, until bigint not null);
create table payments (hash text primary key, checkout text);   -- also used by Late Payment Return
```

**Check:** two `create` calls with the same amount: the second answers false.

## 4. The receipt secret (ask)

Ask where secrets live (a secret manager, or encrypted environment
variables). Create a long random secret (`openssl rand -hex 32`) there as
`RECEIPT_SECRET`. Never print, log or commit it.

## 5. The checkout route

`POST /api/checkout { item }`:

1. Look up the item's price on the server. Never take a price from the browser.
2. For a USD price: `const rate = await xnoUsdRate()` (cache 5 minutes; keep
   the last good rate; refuse with 503 when there is none).
3. `const c = await createCheckout(options, { item, price: priceRaw(usd, rate.usd) })`.
4. Set an httpOnly cookie that marks this browser as the one that started it
   (a random value; store its hash on the checkout's `meta`).
5. Answer `{ id: c.id, amount: c.amount, to: c.to, uri: nanoUri(c.to, c.amount), expiresAt: c.expiresAt }`.
6. Rate-limit this route per visitor (for example 20 per 10 minutes): every
   checkout holds an amount for over an hour.

**Check:** two checkouts for one item get different amounts.

## 6. The payment screen

Show: a QR code of `uri`, an "Open in wallet" link (`href={uri}`), the exact
amount with `toXno(amount)` (all digits, with a copy button), the address
(with a copy button), and the time left. Say: "Send the exact amount from a
wallet you control."

## 7. The claim route

`POST /api/claim { id, hash? }` (`hash`: a block the browser saw, or none):

```ts
const r = await claimCheckout(options, id, hash ?? null);
```

Answer by state: `paid` → `{ paid: true }` and, only for the browser that
started it, the receipt cookie; `waiting` → `{ paid: false }`; `pending` →
`{ paid: false, pending: true }`; `expired` → 410; `wrong` / `invalid` → 400;
`used` → 409; `unknown` → 404. When the node doesn't answer, `claimCheckout`
throws: answer 503 ("try again in a moment").

The browser polls every 2 seconds while the screen is open. Rate-limit per
visitor (for example 180 per minute).

**Check:** with the mock ledger, a paid checkout answers paid once and
again on a second call; an older payment of the same amount does not pay it.

## 8. Using the receipt

On the page that shows the paid thing:
`verifyReceipt(RECEIPT_SECRET, cookie, { item })` → show it, or show the
checkout. Render paid content on the server only.

## 9. Late payments

A payment after the grace matches nothing. Add Late Payment Return
(`@nano133/late-returns`), with the same `payments` table and
`store.claimable` as its `isClaimable`. That needs a wallet whose key the
server holds; without it, tell the owner that late payments stay in their
wallet.

## 10. Test before money

1. `npm run example` in the package.
2. A test in the site with `MockLedger` and `memoryStore()` (from the
   package's `test/`): create, pay, claim, receipt.
3. One real payment of the smallest price, to the owner's address.

## Done when

- [ ] Prices come from the server, never the browser.
- [ ] The checkout and claim routes are rate-limited per visitor.
- [ ] The receipt goes only to the browser that started the checkout.
- [ ] The payment screen shows the exact amount, a QR code and a wallet link.
- [ ] A node that doesn't answer gives 503, and nothing is credited.
- [ ] The receipt secret is in a secret store, never logged.
- [ ] The mock-ledger test passes; one real payment worked.
