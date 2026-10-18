# Changelog

## 0.3.0

A breaking release: nano133.com's own sign-in moved into the package, and the
payment way left it.

- **Removed: the sign-in by payment** (`startSignin`, `checkSignin`,
  `checkConfig`, `memoryStore`, `firestoreStore`, `settleSigninRefunds` and
  `@nano133/signin/refunds`). No dependency on `@nano133/checkout` or
  `@nano133/late-returns` any more. Every way is a signature.
- **Nautilus** (`startNautilus`, `answerNautilus`, `checkNautilus`,
  `nautilusReply`): its `nanoauth:` request, as read in the app's source.
- **NanChat** (`startNanchat`, `answerNanchat`, `checkNanchat`,
  `nanchatReply`, `nanchatNonce`): its `nanauth` request.
- **Berry Wallet** (`startNanoSignin`, `readNanoSignin`, `answerNanoSignin`,
  `checkNanoSignin`, `nanoSigninMessage`, `nanoSigninReply`,
  `nanoSigninRefusal`; `@nano133/signin/nanosignin`): its `nano-signin-v1`
  request, read from the real app. A request lives 5 minutes at most. A
  `WalletRequest` may carry `nonce` and `issuedAt`, and `firestoreRequests`
  keeps them.
- **A request store** for the apps (`RequestStore`; `memoryRequests`,
  `firestoreRequests`), and `WalletRefused` for refusals with words.
- **The passkey purse** in the browser (`@nano133/signin/passkey`): the
  passkey calls, a strict reading of the PRF answer, and the seed by the
  site's own frozen scheme. **`@nano133/signin/purse`**: account 0 of a seed,
  and `signinBody` for the signature route.
- **Strict checks for each form** (`@nano133/signin/verify`): `verifyMessage`
  (the text as hex), `verifyText` (NanChat), `verifyBytes` (Nautilus).
- `useOnce(key, ttlMs, address)` now gets the account; `firestoreOnce` keeps
  it on the row. `checkSignatureSignin` takes `onceLabel`.

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
