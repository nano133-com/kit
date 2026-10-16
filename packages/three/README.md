# @nano133/three

Stage: Alpha. What this means: https://nano133.com/stages

Check a game's result on the server and pay a small Nano (XNO) prize once.
Use one pure rule file in the browser and on the server. Three.js draws the
game. The server replays the player's inputs and decides the win.

The package is framework-free. It has no runtime dependencies and contains
no wallet or private key. Use any renderer and any database with transactions.

## How it works

1. `defineRules` gives a pure rule file a version and replay bounds.
2. `startRound` stores the server's time, seed, version and trusted player.
3. `checkRound` replays the inputs with that version. It refuses a result
   that arrives before the replay's full length. A too-soon round stays open.
4. `payPrize` reserves a winning round and its daily counts. It calls your
   signer once, then closes the round and saves the signed block in one
   transaction. That save is tried up to 3 times and does not sign again.
   It publishes the saved block. A retry publishes that same block.

## The 10 rules

1. **One pure rule file.** No three.js, no clock, no `Math.random()`:
   `(inputs) -> result`, or `(seed, inputs) -> result` for a game with chance.
   The browser draws with it, the server checks with it. Give it a version,
   and replay a round with the version it started with.
   Use only math that every JavaScript engine computes the same: `+ - * /`,
   `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `min` and `max`, or
   whole numbers. Never `sin`, `cos`, `atan2`, `exp`, `log`, `pow`, `**`, `hypot` or
   `cbrt`: browsers may round them differently, and the server and the page
   then disagree. Compare distances squared (`dx*dx + dy*dy <= r*r`).
2. **The server starts the round** and keeps its start time. A round cannot
   end sooner than its own length: refuse it, or let the game send it again
   later, when it comes too soon. In a game with chance **the server makes
   the seed** and keeps it with the round: a page that chose its own seed
   could choose an easy one.
3. **Inputs, not a score.** The game sends what the player did. The rule file
   must refuse inputs that no player could make (in the example: jumps that
   are not whole step numbers in rising order).
4. **A replay proves the result, not the player.** A script can play well.
   So the prize is small, and limits bound the loss: a prize limit for each
   player and each day, a total for the day, and a rate limit on the routes.
   Decide what a win is worth with that in mind.
5. **The key stays on the server**, in a secret manager. Never in the game's
   code, never printed, logged or committed. Keep only a small balance in
   the prize wallet.
6. **Pay once.** Close the round in one database transaction. Save the signed
   send on the round before you publish it; on a retry, publish the saved
   block again and never sign a second one.
7. **Who is paid.** Use an address your server already trusts for this player
   (for example from [Sign in with Nano](https://nano133.com/build/sign-in-with-nano)).
   Do not take a payee from the request that ends the round.
8. **An empty wallet or a full limit** is a normal answer: the player won
   and gets no prize. Say so in the game.
9. **Check your law first.** A prize of money for a game can fall under rules
   on prize promotions or gambling where you or your players live. This
   package is not legal advice.
10. **Test with no real money first.**

These rules come from the [original spec](https://nano133.com/build/three/SPEC.md).
The site's Coin Run uses its faucet claim and its faucet limits. It has no
game prize wallet. This package lets a caller supply a separate prize sender.

## Install

```sh
npm install @nano133/three
```

| You provide | What it does |
|---|---|
| Rules | Pure `start`, `step`, `done` and `valid` functions, with a stable version. |
| Store | `memoryStore({ rules })` for tests, `firestoreStore(db, options)` for a server, or a `RoundStore` for your database. |
| Player | A stable server identity and a verified Nano address from the authenticated session. |
| Sender | Your server's `sign` and `publish` functions. The key stays in your secret manager. |
| Policy | A fixed prize in raw, daily prize counts and route rate limits. |

Import `defineRules` and `play` from `@nano133/three` in either environment.
Import server helpers from `@nano133/three/server`. The browser entry point
has no Node.js, database or sender imports. Firestore uses the optional
`firebase-admin` peer. Install it in the server app if you use that store.

## Use

This 20-line server example assumes an authenticated, rate-limited route,
an initialized `db`, and your sender. The route body contains only inputs.

```ts
import { defineRules } from "@nano133/three";
import { startRound, checkRound, payPrize } from "@nano133/three/server";
import { firestoreStore } from "@nano133/three/firestore";
import { rules as shape } from "@nano133/three/examples/coin-run/run.js";
const rules = defineRules(shape);
const store = firestoreStore(db, {
  rules: [rules], rounds: "game_rounds", usage: "game_usage", wallet: "game_wallet",
});
const limits = { perPlayerPerDay: 1, totalPerDay: 100 };
const player = await signedInPlayer(request); // { id, payee }, verified on the server
const round = await startRound(store, { rulesVersion: rules.version, player });
// Return round to the browser. Later, in the route that ends this round:
const saved = await store.transaction((tx) => tx.getRound(round.roundId));
if (saved?.player.id !== player.id) throw new Error("Unknown round");
const checked = await checkRound(store, { roundId: round.roundId, inputs });
if (checked.state === "soon") return checked; // retry after waitMs
if (checked.state !== "checked" && checked.state !== "used") return checked;
return payPrize(store, sender, {
  roundId: round.roundId, payee: player.payee, amountRaw: 10n ** 26n, limits,
});
```

`signedInPlayer` is your server code. Never build `player` from a request
body. Check ownership on every end, retry and status route. Never pass a
request's address, amount, seed, rule version or time into the server helpers.
Use the stored round id from the route after you check ownership. The fuller
[server example](examples/coin-run/server.js) also handles payment retries.

### Rule shape

`defineRules({ version, hz, maxSteps, maxInputs, start, step, done, valid })`
returns a frozen rule definition. `version` is a nonempty string.
`hz` is steps per second. `maxSteps` bounds replay work (1 to 1,000,000).
`maxInputs` is 0 to `maxSteps`. `hz` is positive and at most 1,000.

- `start(seed)` returns a new state for each replay.
- `step(state, pressed)` advances one step. It can return a state or change
  the supplied state. A true input is a button press at this step.
- `valid(state, pressed)` refuses an impossible action before the step.
- `done(state)` returns null while playing. At the end it returns plain JSON
  data with `won: boolean`, such as `{ won, coins, hits }`. The result must
  not hold arrays inside arrays: Firestore refuses them.

`play(rules, seed, inputs)` returns `{ valid, won, steps, durationMs, result }`.
An invalid replay returns `{ valid: false, won: false, steps: 0, durationMs: 0 }`.
Inputs are an array of safe, nonnegative whole step numbers in strictly
rising order, below `maxSteps`, with at most `maxInputs` entries. Inputs
after the round ends are refused. A replay that does not end is refused.
`durationMs` is the full replay length, rounded up. There is no clock allowance.

Keep the rules pure. The helper cannot detect a clock or random call hidden
inside a function. Test each rule's determinism. Keep old versions available
until their rounds and unpaid prizes are finished. Never change a version's
meaning. The input format supports one button; encode other game designs in
a separate rule pattern if they need more input data.

### Server answers

`startRound(store, { rulesVersion, player, seed? })` returns
`{ roundId, rulesVersion, seed }`. The optional seed is for trusted server
code. By default the server makes 32 random bytes. The start time stays in
the store. Replays use the stored version and seed.

`checkRound(store, { roundId, inputs, now? })` returns:

| State | Meaning |
|---|---|
| `checked` | `replay` is stored. A winning round can proceed to payment. A loss or invalid input closes it. |
| `soon` | Wait `waitMs`, then submit again. The round stays open. |
| `used` | The round already has a check. Continue only with its saved result. |
| `unknown` | The round does not exist or its id is malformed. |
| `rules-unavailable` | Its old rules are missing. Restore them; the round stays open. |

`now` is server time in milliseconds. It defaults to the store's server clock.
The package has no round expiry. Add an expiry policy in your server if needed.

`payPrize(store, sender, { roundId, payee, amountRaw, limits })` returns:

| State | Meaning |
|---|---|
| `paid` | The saved block is published. Includes `hash` and `again`. Check confirmation in your sender if you require it. |
| `no-prize` | Includes `won` and a reason: `lost`, `invalid`, `player-limit`, `day-limit` or `empty`. The round stays closed. |
| `pending` | A signature is in progress (`signing`), or another prize holds the wallet (`wallet-busy`). |
| `unchecked` | Run the server check first. |
| `unknown` | There is no such round. |

An address that differs from the saved trusted payee throws before signing
or publication. A reserved amount cannot change. These checks also apply on
retries. Amounts are positive bigint values or decimal strings in raw, up to
the Nano 128-bit balance bound. 1 XNO is 10^30 raw.

### Sender and failure recovery

Implement `PrizeSender` in your server. `sign({ roundId, payee, amountRaw })`
returns `{ hash, block }` with the complete signed Nano state block. It must
not publish it. Return null only for insufficient funds, before signing.
The caller validates Nano addresses, block hashes, signatures, amounts and
work. This package checks the stored payee binding and the block shape;
it does not implement Nano cryptography or RPC.

`publish(send)` publishes the exact block. It must also succeed when that
same hash is already on the ledger. Check that hash after an uncertain node
answer. Never replace a saved block or sign a new one for that round.

Use one persistent store per prize wallet across all processes. The store
holds one active prize from reservation through publication. Other rounds
wait. Do not use another sender, receive worker or app to change this
wallet's chain outside the same coordination.

The package never calls a signer in a database callback. Such callbacks can
run more than once. It tries the save of the signed block up to 3 times.
It waits 200 ms, then 1 second, between those tries. Those tries do not
sign again. If signing throws, the process stops, or all
3 saves fail before the signed block is stored, the round stays `signing`.
Its daily counts and wallet slot stay reserved. A retry returns `pending`;
it does not sign again. Keep a durable signing record in your sender for
recovery. Reconcile the original block before an operator repairs the
record. Never clear an uncertain reservation to permit another signature.

If publication fails after the save, call `payPrize` again with the same
round, payee and amount, or call `retryActivePrize(store, sender)`. Both
publish the saved block without signing again.
This also applies if the server stops after publication but before the paid
mark. Retain rounds, signed blocks, usage records and the wallet slot. Do
not set a TTL that can remove an unpaid record or permit a second prize.

### Limits

`perPlayerPerDay` and `totalPerDay` are nonnegative whole **prize counts**,
not raw amounts. Zero closes the limit. Set the amount and limits in server
configuration. Apply one policy to all callers of a wallet. A script can
create identities; a verified address does not prove a person.

Counts are reserved atomically on a UTC day. A retry keeps its original day
and consumes no extra count. An empty wallet closes the round with no prize
and releases its counts. An uncertain signing failure keeps the counts.
Use a stable player id. Changing it can bypass that player's daily limit.

Rate-limit start, end, retry and status routes per visitor and player.
Limit request body size. The package does not provide HTTP or rate limiting.
The total count and a fixed prize amount bound the value reserved each day.
Publication can occur on a later day. Keep only a small wallet balance.

### Stores

`memoryStore({ rules, now? })` from `@nano133/three/memory` is for tests.
It serializes transactions and rolls back on failure. It loses all records
on restart. Never use it for real prizes.

`firestoreStore(db, { rules, rounds, usage, wallet, now? })` uses three
different collections. All processes for a wallet must use the same ones.
It needs no query indexes. Usage document keys contain the UTC day and a
hash of the player id. Round records hold the trusted address. Protect all
three collections from browser reads and writes. Do not return signed block
records or complete round documents to the browser.

For another database, implement `RoundStore` and `RoundTransaction` from
`@nano133/three/server`. The store resolves versions and supplies the server
clock. A transaction reads rounds, usage counts and the active wallet slot,
then creates or writes them atomically. `createRound` must refuse an existing
id. Roll back on failure. Read before writing. A callback may be retried.

## Coin Run and tests

[run.js](examples/coin-run/run.js) preserves the site's course and physics.
It adds the package rule shape and refuses jumps in the air.
[game.js](examples/coin-run/game.js) draws with Three.js and records jump
step numbers. Use a bundler and install `three` in your example app. Supply
a `canvas#game`, an `output#result`, and the two authenticated POST routes
from [server.js](examples/coin-run/server.js). A host worker calls
`retryActivePrize(store, sender)` for the one active prize. It reads the
wallet slot. A saved signed block there is published again, exactly as
saved, and the round is marked paid. It does not sign. No slot: nothing
happens, and it returns `{ state: "none" }`. A slot with no saved block:
nothing is signed, and it returns `{ state: "signing", roundId }`. An
operator must look at that round. A published block returns
`{ state: "paid", hash }`. Poll or refresh a pending prize in your app's
result screen.

```sh
npm test
npm run build
FIRESTORE_EMULATOR_HOST=localhost:8080 npm test
```

The package tests use a fake signer and ledger, with no keys, network or
money. Firestore adapter tests run with a transaction double on every test
run. The optional emulator test never uses a real project.

MIT. From [nano133.com](https://nano133.com).
