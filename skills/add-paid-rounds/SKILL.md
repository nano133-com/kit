---
name: add-paid-rounds
description: Charge for a round in a Nanoterra game with @nano133/nanoterra/shop - one-time purchases ("plays": a round, a level, a life or a continue that a player buys and uses once), pay to play only, paid in Nano (XNO) straight to the creator's address with no key on the server; plays.json, the plays' routes, the round's start that uses one credit once, the "I am 18 or older" step, the creator's Legal card in /admin, and refunds by hand. Use when the user asks to charge for a round, a turn, a level, an extra life or a continue, to sell plays or attempts, or to add pay to play, in a game made with the Nanoterra kit or the game starter that already has the kit's shop.
---

# Add paid rounds

Follow step 15 of the package's `ai/SPEC.md` (https://nano133.com/build/nanoterra, or
`node_modules/@nano133/nanoterra/ai/SPEC.md`) and the README parts "Plays: charge for a round" and
"Pay to play: the rules". The game needs the kit's shop (skill `add-shop`) and /admin first. If it has
neither, say so and stop.

1. **Tell the owner the rule, in plain words.** "A player pays for a turn at your game, and for nothing
   else. A paid turn never wins money or a prize that is worth money. Nothing that a player buys is random.
   Nothing that a player buys makes the game easier to win. Some places have laws about paid games. Ask a
   lawyer before you turn test mode off." Give no legal advice.
2. **Ask, one question at a time:** what a player pays for (a round, a level, a life or a continue; give
   two ideas that fit the game), the price of each, whether the free game stays free (the admin's "Free
   play"), and how long a bought round waits (default 30 days). Then ask what a round gives at its end.
   **Stop** if the owner names money, a prize of value (an item to trade, tickets, tokens, crypto, a gift
   card), tickets or anything random, and say why in plain words.
3. Write `plays.json` beside `looks.json` (`id`, `name`, `priceUsd`, `use`, optional `useWithinDays`; no
   other field; never a look's id) and check it with `checkPlays`. Tell the owner that a price under
   about 5¢ has few free amounts and can be busy.
4. D1: add `@nano133/nanoterra/shop/d1-plays.sql` as the next migration, and apply it BEFORE the Worker
   that sells plays. Firestore needs none.
5. The server: `createShop(env, { catalogue: looks, plays, legal: () => loadLegal(adminStore), player })`,
   with `adminStore = createD1Store(env.DB, { plays: true })` on D1. The admin handler gets `plays` and
   `unmatched: shop.unmatched`; `mountAdmin` gets `plays`. Never change the Legal card's defaults (18 and
   up on, a life or a continue off, 14 days of refunds) and never press the owner's confirmation.
6. The page: `mountShop` with `plays` and `onCredit`; place `shop.playKey(playId, start)` and call
   `shop.ready()` after the sign-in. `start` makes a NEW round id, posts `{ playId, ref }` to
   `/api/plays/use`, and starts the round only after `{ used: true }`, once for each ref. The credit is
   used at the round's start, never at the buy. Never put a Play key on a page for children.
7. A paid round never pauses (leave `pauseWhenLeft` out of it). A round that used a paid life or
   continue posts no board score and earns nothing. A paid round gives no ticket, prize or reward.
8. Refunds are by hand: the admin lists them ("To send back", "Unmatched payments"). Never add a key, a
   seed or a send to return money.
9. The listing file gets `"paidRounds": paidRoundsOn(plays)` beside `"freePlay"`.
10. Test with no money: keep `TEST_MODE` on. Test on a phone first (upright and sideways), then a tablet,
    then a computer: the Play key shows its price, the "18 or older" step comes first, the pay sheet says
    "TEST MODE: DO NOT PAY" with no QR code and shows the refund words before any step. A use with no
    credit answers 402; the same ref twice answers `again: true`. A pretend payment exists only in tests:
    the memory store's `settle`, or a mock node on 127.0.0.1 (the README part "The paid state: in your tests
    only" has the example). Never make a screen that a person could pay for a test address or a mock node,
    and never turn test mode off to see "Paid". /admin has no local sign-in: in a test give
    `createAdminHandler` its own `session`; to see the real panel, the owner deploys a preview with test
    mode on and signs in with the wallet (README part "On your own computer").

Never deploy, and never turn test mode off: the owner does both. Finish with the SPEC's step 15 check.
