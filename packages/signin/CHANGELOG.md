# Changelog

## 0.2.0

- Refunds: a store with `returns` records each sign-in's return in the claim
  itself; `settleSigninRefunds` (`@nano133/signin/refunds`) sends them, and
  refuses to run against the Firestore emulator.
- `mine` holds only for `deliverMs` (default 10 minutes) after the sign-in.
- A payment that was already waiting when a sign-in began never counts for
  it, and one first seen more than `earlyMs` (default 10 s) before the start
  doesn't either.
- The search reads up to 1,000 waiting payments.
- `checkConfig` also checks `ttlMs`, `graceMs`, `deliverMs`, `earlyMs`, and a
  margin longer than the checkout package's `CLOCK_SLACK_MS`.
- Firestore documents carry `deleteAt` for a TTL policy; an empty domain is
  refused for signature sign-ins.

## 0.1.0

- First version: `startSignin`, `checkSignin` (payment sign-in), `checkSignatureSignin`
  and `verifyMessage` (signature sign-in), `signinMessage`, `checkConfig`,
  `memoryStore`, `memoryOnce`, `firestoreStore`, `firestoreOnce`.
