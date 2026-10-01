# Late Payment Return: implementation spec

Follow these steps in order. Each step ends with a check. Stop and ask the
site owner when a step says "ask".

Package: `@nano133/late-returns` (TypeScript, no runtime dependencies).
It works with any Node.js server (Express, Next.js, React Router, Fastify,
Hono on Node) and any database that has transactions.

## 0. When this fits

The site must already:

- take Nano payments into **its own wallet**, whose key the server holds;
- give each checkout a **unique amount** (the price plus a small random tail
  in raw), and match an incoming payment to a checkout by that amount;
- record each claimed payment **by its send block hash**.

If the site pays into a wallet the server has no key for (a phone wallet, an
exchange), stop: returns are impossible. Tell the owner to route payments
through a server wallet first.

**Check:** find the code that creates a checkout, the code that claims a
payment, and the record of claimed payment hashes. Write down their files.

## 1. Install

```sh
npm install @nano133/late-returns
npm install nanocurrency-web blakejs   # only for the example signer
```

**Check:** `import { runLateReturns } from "@nano133/late-returns"` compiles.

## 2. The key and the signer (ask)

Ask the owner where the wallet seed lives: a secret manager (Google Secret
Manager, AWS Secrets Manager, Vercel/Netlify encrypted env vars) or an
environment variable. Never put it in code, in the database, in logs or in a
commit. Never print it, not even partly.

Copy `examples/signer.ts` from the package into the site (for example
`server/nano/signer.ts`) and build the signer at startup:

```ts
const signer = seedSigner(process.env.NANO_WALLET_SEED!, 0);
```

Warn the owner in the pull request: this is a hot wallet; keep only small
amounts in it.

**Check:** `signer.address` equals the address the checkouts ask buyers to pay.

## 3. The node

Use the site's own Nano node if it has one; otherwise a public RPC it trusts.
The answers decide whether money moves.

```ts
const rpc = async <T>(body: Record<string, unknown>, timeoutMs = 10_000): Promise<T> => {
  const res = await fetch(NODE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json as T;
};
```

The node must allow these actions: `receivable`, `account_info`,
`account_history` (raw), `block_info`, `process`, `work_generate` (or pass
your own `work` function). Some public gateways cap `count` at 50; the
package asks for 50.

**Check:** `await rpc({ action: "account_info", account: signer.address })`
answers (or "Account not found" for a new wallet).

## 4. The store

Pick one:

- **Firestore:** `firestoreStore(db, { returns, used, meta })` from
  `@nano133/late-returns/firestore`. `used` lists the collections where the
  site records claimed payments, keyed by block hash. The first one also
  receives the "used" mark of each return.
- **Any other database:** implement `ReturnStore` from the package's
  `src/types.ts`. Rules:
  - `record()` is one transaction: unless a return exists for the hash, the
    payment is used, or today's count reached the limit, create the return
    (status `pending`), mark the payment used, add one to today's count.
  - `lock(ttl)` is one row/document `{ owner, until }`. `take()` succeeds only
    when it is free or expired. Every `update()` runs in a transaction that
    first checks `owner` and `until > now`, and throws `LockLost` otherwise.

For SQL (PostgreSQL shown):

```sql
create table late_returns (
  hash text primary key, amount text not null, "to" text not null,
  status text not null, "by" text not null, created_at bigint not null,
  recv text, send jsonb, return_hash text, error text, tries int default 0
);
create table late_returns_meta (key text primary key, owner text, until bigint, n int);
-- and the site's own table of claimed payments, with the block hash as its key.
```

**Check:** the package's tests pattern: create a store, call
`store.record()` twice for one hash; the second answer is `"exists"`.

## 5. The claim side

In the site's claim code, inside the transaction that marks a checkout paid:

1. refuse the payment when its hash is already in the used records;
2. write the used record for the hash.

Each checkout needs a **grace period** for late payments (for example 1 hour
after it expires) during which its amount stays reserved.

**Check:** two claims with the same hash: the second is refused.

## 6. `isClaimable`

Return `true` when an open checkout, or one still inside its grace period,
asks for exactly `amount`:

```ts
isClaimable: async ({ amount }) => openCheckoutsWithAmount(amount).some((c) => c.expiresAt + GRACE_MS > Date.now())
```

Set `minAgeSec` (default 7200) longer than the checkout's lifetime plus its
grace.

**Check:** with an open checkout for amount X, a payment of X is never returned.

## 7. Never return these

`never`: every address the site itself sends from (other house wallets) and
the owner's top-up address (ask the owner for it). The wallet's own address
is always excluded.

## 8. Run it

Call `runLateReturns(options)` every 5 minutes:

- **Cron:** a scheduler (Vercel Cron, Cloud Scheduler, GitHub Actions, a
  systemd timer) calls a protected route (`POST /internal/late-returns` with a
  shared secret header) that calls it.
- **No cron:** call it from a frequently used route with an in-process
  throttle (`if (Date.now() - last < 5 * 60_000) return; last = Date.now();`),
  without awaiting it in the request.

```ts
// Express
app.post("/internal/late-returns", requireCronSecret, async (_req, res) => res.json(await runLateReturns(options)));
// Next.js (app router): app/api/internal/late-returns/route.ts
export async function POST(req: Request) { if (!isCron(req)) return new Response("no", { status: 401 }); return Response.json(await runLateReturns(options)); }
// React Router: an action in app/routes/internal.late-returns.ts with the same check.
```

Never run it against a test database with the real key: check an
environment flag and skip when the site uses an emulator or a test database.

**Check:** two runs in parallel: one returns `{ ran: false }`.

## 9. Test before money

1. Run the package's mock-ledger example: `npm run example` in the package.
2. Write one test in the site with `MockLedger` and `memoryStore()` (copy
   them from the package's `test/`): a late payment goes back once; a claimed
   one stays.
3. Then one real test with 0.001 XNO: pay a closed checkout from a wallet
   you hold, wait `minAgeSec`, run, and see it come back.

## 10. Done when

- [ ] The key is in a secret store, read at startup, never logged.
- [ ] Claims refuse used hashes and record theirs in the same transaction.
- [ ] `isClaimable` covers open checkouts and their grace period.
- [ ] `never` holds the owner's top-up address and the site's other wallets.
- [ ] A run starts every few minutes and never against test data.
- [ ] The mock-ledger test passes; one real 0.001 XNO return worked.
- [ ] The pull request warns that the wallet is a hot wallet.
