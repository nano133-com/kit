# Nano for Three.js: implementation spec

Follow these steps in order. Each step ends with a check. Ask the owner
when a step says "ask". Package: `@nano133/three`, version 0.1.0.

The package replays inputs and coordinates a prize. It contains no wallet,
private key, Nano RPC client, renderer, HTTP server or rate limiter.
Read the package README's 10 rules before you integrate it.

## 0. What the owner decides (ask)

1. The fixed prize amount in raw, the per-player daily prize count and the
   total daily count. Keep the prize and wallet balance small.
2. How the server authenticates a player and verifies their Nano address.
   A request must not choose the player or payee.
3. The owner's Nano node, prize wallet and secret manager. Ask where the
   signer gets its key. Never ask the owner to paste a key into the chat.
   Never print, log or commit a key or secret.
4. The rate limits, allowed round lifetime and database retention policy.
5. The law that applies to the owner and players. A money prize can fall
   under prize promotion or gambling rules. This is not legal advice.

**Check:** the owner chooses the policy and confirms that the signer uses
their secret manager. No real money is needed to implement or test it.

## 1. Install and separate the browser from the server

```sh
npm install @nano133/three
```

The browser imports `defineRules` and `play` from `@nano133/three`.
The server imports `startRound`, `checkRound` and `payPrize` from
`@nano133/three/server`. Never import server files or a signer in the browser.
Three.js is optional. Install it in the app if that app uses it.

**Check:** the browser bundle has no server, database or signer code.

## 2. Write one pure rule file

Use `defineRules({ version, hz, maxSteps, maxInputs, start, step, done, valid })`.
See `examples/coin-run/run.js` for a complete rule shape.

- `start(seed)` returns fresh state. The server supplies the seed.
- `step(state, pressed)` advances exactly one step.
- `valid(state, pressed)` refuses an impossible action.
- `done(state)` returns null until the end, then JSON data with `won`.
- Use no Three.js, clock, network, mutable global state or `Math.random()`
  in the rule. Use a deterministic algorithm if the seed controls chance.
- Give every rule change a new version string. Keep old versions available.

The replay accepts button presses as whole step numbers in strictly rising
order. It refuses excess entries, unused inputs and rounds that do not end.
Do not submit or trust a browser score. Other input types need another pattern.

**Check:** repeat `play(rules, seed, inputs)` and compare the complete
results. Test invalid and impossible inputs and the known win and loss.

## 3. Make the store

For tests, use `memoryStore({ rules: [rules], now? })` from
`@nano133/three/memory`. Never use it for real prizes.

For Firestore, use `firestoreStore(db, { rules: [rules, oldRules], rounds,
usage, wallet })` from `@nano133/three/firestore`. Install `firebase-admin`
in the server app. Use three different collection names. Every process for
one prize wallet uses those same collections. Block all browser access.

For another database, implement `RoundStore` and `RoundTransaction`:

- Resolve each stored rule version and supply the server clock.
- Atomically read, create or set a round, read or set usage counts, and
  read or set the active prize wallet slot.
- Refuse an existing round id on `createRound`. Roll back failed writes.
- Read before writing. A transaction callback can run more than once.
  Never sign or publish from it.

Do not delete unpaid rounds, signed sends or their wallet slot. Retain daily
usage while it can still limit a prize. The package has no automatic expiry.

**Check:** concurrent checks count one round once. Concurrent payments
reserve one prize once. Failed transactions change no record.

## 4. Implement the sender

Implement `PrizeSender` in the server with the owner's wallet code:

1. `sign({ roundId, payee, amountRaw })` validates the Nano destination and
   amount, reads the wallet's chain and funds, creates work, and signs a send.
   Return `{ hash, block }` with the complete Nano state block. Do not publish.
2. Return null for insufficient funds only when no block is signed. This
   produces `{ state: "no-prize", won: true, reason: "empty" }`.
3. `publish(send)` publishes that exact saved block to the owner's node.
   Treat an identical hash already on the ledger as success. On an uncertain
   answer, check that hash. Never construct a replacement block.
4. Keep a durable signing record indexed by round id for recovery. Never
   log a key. Public signed state blocks contain no private key.

The package holds one wallet slot through signing and publication. No other
app or receive worker may change that wallet's chain outside the same
coordination. The caller supplies Nano cryptography and RPC validation.

**Check:** a fake sender loses a publication answer. A retry publishes the
same saved block, with one signature and one ledger payment.

## 5. Start and draw a round

In an authenticated, rate-limited POST route:

```ts
const player = await signedInPlayer(request); // trusted { id, payee }
return startRound(store, { rulesVersion: rules.version, player });
```

The server saves the time, seed, version and player. A server-owned seed can
be supplied explicitly. Never accept a seed, start time, player or address
from this request. Return only the public round answer.

The browser starts the same rules with the returned seed. It draws the
state and advances whole steps. Record an input only when the action is
valid. See `examples/coin-run/game.js`. Submit `{ inputs }` with the round id.

**Check:** a request cannot choose a seed or change the trusted address.

## 6. Check and pay

In the authenticated, rate-limited route that ends a round:

1. Load the round on the server. Check that the authenticated player owns
   it. Check ownership on status and retry routes too.
2. If the round is open, call `checkRound(store, { roundId, inputs })`.
   Never pass a request's time or rule version. The helper replays the
   stored version and seed.
3. For `soon`, return `waitMs`. The browser waits and submits again. There
   is no early clock allowance. The round stays open.
4. A missing old version returns `rules-unavailable`. Restore that rule.
   A loss or invalid input closes the round with no prize.
5. For a checked win, call `payPrize(store, sender, { roundId,
   payee: player.payee, amountRaw: PRIZE_RAW, limits })`. The amount and
   limits come from server configuration. Never take the payee from the body.
6. For `used`, continue only with the saved check and authenticated owner.
   Do not replace the inputs, result or saved send. See the server example.

`payPrize` binds the payee to the trusted address stored at start. An address
or reserved amount change throws before signing or publication. Daily limits
are prize counts, grouped by UTC day. Retries keep the reserved day.

**Check:** a too-fast replay stays open. A forged payee is refused. Player
and total limits give a normal win with no prize and do not call the signer.

## 7. Show the result and handle recovery

Show a win with no prize for `empty`, `player-limit` and `day-limit`.
For `pending`, show that the prize waits. A worker can retry a saved send
after an outage with `payPrize`. Limit worker and route retries.

If signing throws or the server stops before the signed send is saved, the
round stays `signing`. Its counts and wallet slot stay reserved. Automatic
retries never sign it again. Reconcile the sender's durable signing record
and the ledger before an operator repairs the saved record. Never clear an
uncertain reservation to sign anew. A saved send can always be republished.

Rate-limit start, end, retry and status routes per visitor and player.
Limit request body size. Use stable player identities. A successful replay
or verified wallet address does not prove that a person played.

**Check:** an uncertain signature remains reserved. A saved send survives
a process restart and publishes without a second signature.

## 8. Test with no real money first

Run the package tests, then run tests in the app with a fake sender and a
test database. Never connect that database to a real wallet key. Cover the
known game results, bad inputs, exact duration, old rules, route ownership,
daily limits, insufficient funds and interrupted signing and publication.

**Check:** the app's tests use no real money and include every item above.
Any real payment is a separate owner-controlled step after these checks.
