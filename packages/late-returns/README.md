# @nano133/late-returns

Send Nano (XNO) payments that nothing claimed back to their sender, exactly once.

> [!WARNING]
> **This package sends real money from a wallet whose key is on your server.**
> A key on a server is a hot wallet: anyone who gets into the server can
> empty it. Keep only small amounts in it (what your late payments and
> refunds need, nothing more), keep the key in your secret manager (never in
> code or in the database), and use your own Nano node. Test everything
> against a mock ledger or with tiny amounts first. The software comes with
> no warranty (MIT license).

## What it does

A site that takes Nano gives each checkout a unique amount and matches the
payment that arrives. Some payments match nothing: they arrive after the
checkout closed, or someone sends the wrong amount. Without this package
that money stays in your wallet, and the buyer has to ask for it back.

With it, a run every few minutes finds such payments and sends each one back
to its sender:

| Rule | Default |
|---|---|
| Only payments of at least | 0.001 XNO (`minRaw`) |
| Only payments first seen at least | 2 hours ago (`minAgeSec`) |
| Only confirmed sends to the wallet | always |
| Never a payment your site already used | `store.isUsed()` |
| Never a payment an open checkout can still claim | your `isClaimable()` |
| Never a payment from these senders | `never` (your own wallets, an admin's top-ups) |
| At most | 3 new returns per run (`perRun`), 30 per day (`perDay`) |

Each return is recorded together with a "used" mark for the payment, so a
late claim can't also take it. The wallet then receives exactly that payment
and sends exactly its amount back.

### Exactly once

Every send is recorded **before** it is published: its hash, the frontier it
builds on, and the signed block. A later run checks the ledger first: if the
block is there, the return is done; if not and the wallet hasn't changed, the
same block is published again (it can only land once); a new block is made
only when the old one can never be valid. All writes happen under a lock
that each write proves it still holds. This is the code nano133.com runs for
its till, extracted.

## Install

```sh
npm install @nano133/late-returns
```

No runtime dependencies. You bring four things:

| You provide | What it is |
|---|---|
| `rpc` | A function that calls your Nano node and rejects on `{ error }`. |
| `signer` | Signs blocks for the wallet. See `examples/signer.ts` (nanocurrency-web). The package never sees the key. |
| `store` | Where returns are kept: `memoryStore()` (tests) or `firestoreStore(db, …)`, or your own `ReturnStore`. |
| `isClaimable` | Your answer to "can one of my open checkouts still claim this amount?" |

## Use

```ts
import { runLateReturns } from "@nano133/late-returns";
import { firestoreStore } from "@nano133/late-returns/firestore";

const store = firestoreStore(db, {
  returns: "late_returns",          // the return records
  used: ["payments"],               // where your checkouts record a claimed payment (by block hash)
  meta: "late_returns_meta",        // the lock and the daily counters
});

// Every few minutes (a cron job, or a page load with your own throttle):
await runLateReturns({
  rpc,                               // your node
  store,
  signer,                            // from your secret manager
  never: [OWNER_ADDRESS],            // top-ups from you never go back
  isClaimable: async ({ amount }) =>
    (await db.collection("checkouts").where("amount", "==", amount).where("status", "==", "waiting").get())
      .docs.some((d) => d.data().expiresAt + GRACE_MS > Date.now()),
});
```

Your claim code must refuse a payment whose hash is already in a `used`
collection; then a payment that went back can never also pay a checkout.

### Your own database

Implement `ReturnStore` (see `src/types.ts`). The one hard rule: `record()`
must be atomic (create the return, mark the payment used, count the day, or
do none of it), and every `update()` made under a lock must fail with
`LockLost` when the lock is gone.

## Cost

Each return is two blocks for your wallet: one receive and one send. Each
needs proof of work, which `work_generate` on your node computes (or pass
your own `work`). Nano has no fees. The caps keep a flood of small payments
from turning into work: someone who sends you 0.001 XNO gets it back, and
costs your node two blocks of work, at most 30 times a day.

## Test

```sh
npm test                                          # the mock ledger
FIRESTORE_EMULATOR_HOST=localhost:8080 npm test   # also the Firestore store, on an emulator
npm run example                                   # a walk-through on the mock ledger
```

## License

MIT. From [nano133.com](https://nano133.com).
