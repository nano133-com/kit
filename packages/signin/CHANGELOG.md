# Changelog

## 0.2.1

- An address must be whole: its shape and its checksum. `checkSignatureSignin`,
  `verifyMessage` and `checkConfig` refuse one that is not. `validAddress`
  (`@nano133/signin/signature`) is the test. Update to this version.

## 0.2.0

- Refunds: a store with `returns` records each sign-in's return in the claim
  itself; `settleSigninRefunds` (`@nano133/signin/refunds`) sends them, and
  refuses to run against the Firestore emulator.
- `mine` holds only for `deliverMs` (default 10 minutes) after the sign-in.
- A payment that was already waiting when a sign-in began never counts for
  it, and one first seen more than `earlyMs` (default 30 s) before the start
  doesn't either.
- The search reads up to 1,000 waiting sends; the docs ask sites to receive
  waiting sends regularly and to pass the block hash when they have it.
- `mockLedger` on `settleSigninRefunds` works only with `NODE_ENV=test`.
- `checkConfig` also checks `ttlMs`, `graceMs`, `deliverMs`, `earlyMs`, and a
  margin longer than the checkout package's `CLOCK_SLACK_MS`.
- Firestore documents carry `deleteAt` for a TTL policy; an empty domain is
  refused for signature sign-ins.

## 0.1.0

- First version: `startSignin`, `checkSignin` (payment sign-in), `checkSignatureSignin`
  and `verifyMessage` (signature sign-in), `signinMessage`, `checkConfig`,
  `memoryStore`, `memoryOnce`, `firestoreStore`, `firestoreOnce`.
