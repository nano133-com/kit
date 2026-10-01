# Sign in with Nano: implementation spec

Follow these steps in order. Each step ends with a check. Stop and ask the
site owner when a step says "ask".

Package: `@nano133/signin`. It works with any Node.js server and any
database with transactions.

## 0. Decide (ask)

1. Which ways: by payment, by signature, or both (recommended: both; the
   signature way needs no XNO).
2. For payment: a **new wallet used only for sign-ins** (its address). Every
   send of a sign-in amount to it counts as a sign-in. Never reuse a wallet
   that receives other payments.
3. The node (their own, or a public RPC they trust).
4. The site's domain, exactly as users see it (for the signature message).
5. Whether to send sign-in amounts back (needs the wallet's key on the
   server and `@nano133/late-returns`), or keep them.

## 1. Install

```sh
npm install @nano133/signin
```

## 2. The node

A function that POSTs JSON to the node and rejects when the answer has
`error`. When the node doesn't answer, sign-in must fail (never sign anyone
in without the node's answer).

## 3. The stores

- Firestore: `firestoreStore(db, { sessions, amounts, payments })` and
  `firestoreOnce(db, collection)`.
- Other databases: implement `SigninStore` (see `src/types.ts`):
  `create` (lock the amount and insert the sign-in, atomically, refusing an
  amount whose lock `until` is in the future), `get`, `claim` (atomically:
  refuse a payment hash that another sign-in used, refuse a sign-in that
  isn't `waiting`, else record the payment and mark the sign-in done). And a
  `useOnce(key, ttl)` that inserts a row with a unique key and answers false
  when it exists.

**Check:** `create` twice with one amount: the second answers false.

## 4. The starter cookie

On the first sign-in step, set an httpOnly, SameSite=Lax cookie with a
random value and a 30-minute Max-Age. Pass `sha256(value)` as `starter`. Only
that browser gets the session, and only for 10 minutes after the sign-in.

When you create the session: give it a new session id (never reuse one from
before the sign-in), replace the starter cookie, and show "Signed in as
nano_…" with the account.

## 5. Payment sign-in routes

- `POST /signin/start`: `startSignin(options, { starter })` → answer `{ id,
  address, amount, expiresAt }`. **Required:** rate-limit it per visitor (20
  per 10 minutes) and in all (600 per 10 minutes). Each start holds an
  amount for about 20 minutes.
- The screen: "Send exactly <amount in XNO, all digits> to <address>", a QR
  code `nano:<address>?amount=<raw>`, a wallet link, the time left, and:
  "Pay from your own wallet, not an exchange."
- `POST /signin/check { id, hash? }`: `checkSignin(options, id, hash ?? null,
  { starter })`. When `state === "signedin" && mine`, create your session for
  `account`. Map: `waiting`/`pending` → keep polling (every 2 s); `expired`
  → "start again"; `wrong`/`invalid` → 400; `used` → 409; `unknown` → 404;
  a thrown error → 503 "try again". **Required:** rate-limit it per visitor.

**Check:** with the mock ledger, a payment signs in the starter browser;
another browser gets `mine: false`; an older payment of the same amount
doesn't count.

## 6. Signature sign-in route

- The browser signs `signinMessage(domain, address, Date.now())` with the
  wallet's key and posts `{ address, at, signature }`.
- `POST /signin/signature`: `checkSignatureSignin({ domain, useOnce },
  body)` → create the session for the returned address. Map `SigninError`
  status to the answer. **Required:** rate-limit it per visitor.

**Check:** the same signature twice: the second is refused; a signature for
another domain is refused.

## 7. Sending amounts back (optional)

Ask first: it needs the sign-in wallet's key on the server (a hot wallet;
keep it nearly empty). Ask where the key lives; never print, log or commit it.

1. Give the sign-in store a `returns` collection. Each sign-in then records
   its return (pending) in the same transaction as the sign-in.
2. Make `@nano133/late-returns`' store on the same `returns` collection, with
   the sign-in payments collection in `used`.
3. Run `settleSigninRefunds({ rpc, signer, store })` every minute (a
   scheduler). It refuses to run while `FIRESTORE_EMULATOR_HOST` is set.

Without refunds, receive the waiting amounts now and then; a search reads
the newest 1,000 waiting payments.

**Check:** on the emulator with the mock ledger (`mockLedger: true`), one
sign-in sends exactly one return; a second run sends nothing.

## 8. Test before money

1. `npm run example` in the package.
2. A site test with `MockLedger` and `memoryStore()`.
3. One real sign-in from the owner's wallet.

## Done when

- [ ] The sign-in address is a wallet used for nothing else.
- [ ] start, check and signature routes are rate-limited (required).
- [ ] Only the starter browser gets the session; a new session id at sign-in.
- [ ] TTL policies on `deleteAt` (not on the payments collection).
- [ ] A node that doesn't answer gives 503; nobody is signed in.
- [ ] The signature message uses the site's real domain.
- [ ] Keys and secrets are in a secret store, never logged.
- [ ] The screen tells users to pay from their own wallet.
