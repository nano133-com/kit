# Changelog

## 0.1.0

- First version: `defineRules`, `play`, `startRound`, `checkRound`, `payPrize`,
  `memoryStore` and `firestoreStore`.
- Pure, versioned rules and bounded input replay. The server stores each
  round's seed, start time and trusted player address.
- Pay-once prizes with saved signed blocks, daily limits and one active send
  per wallet. Retries publish the saved block without signing again.
- Coin Run rules and examples for Three.js and a server. No runtime dependencies.
- The save of a signed block is tried up to 3 times. Those tries do not sign again.
- `retryActivePrize(store, sender)` republishes the saved block in the wallet slot and does not sign.
- A `done()` result must not hold arrays inside arrays. Firestore refuses them.
