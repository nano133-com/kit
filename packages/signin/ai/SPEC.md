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
random value. Pass `sha256(value)` as `starter`. Only that browser gets the
session.

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

Only with the wallet's key on the server. When `checkSignin` returns
`signedin` the first time (`again === false`), record a return for
`{ hash, amount, to: account }` in `@nano133/late-returns`' store, and run
`runLateReturns` every few minutes. Never let it run against a test or
emulator database with the real key. Keep the wallet nearly empty.

## 8. Test before money

1. `npm run example` in the package.
2. A site test with `MockLedger` and `memoryStore()`.
3. One real sign-in from the owner's wallet.

## Done when

- [ ] The sign-in address is a wallet used for nothing else.
- [ ] start, check and signature routes are rate-limited (required).
- [ ] Only the starter browser gets the session.
- [ ] A node that doesn't answer gives 503; nobody is signed in.
- [ ] The signature message uses the site's real domain.
- [ ] Keys and secrets are in a secret store, never logged.
- [ ] The screen tells users to pay from their own wallet.
