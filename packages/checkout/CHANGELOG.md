# Changelog

## 0.3.0

An address for each checkout. Everything is additive: the unique-amount way
(`createCheckout`, `uniqueAmount`, `withTail`) and its defaults work exactly as
before, and the package's main entry still has no runtime dependencies.

- New entry `@nano133/checkout/derived` (it needs `nanocurrency-web` and
  `@noble/hashes`, optional peer dependencies):
  - `createDerivedCheckout`: the next index from the store's counter, the address
    of that index (the Nano seed is HMAC-SHA256 of your secret with a `label`,
    the account is the legacy account of the index), and a **clean quote**:
    the price rounded up to a whole 0.0001 XNO, no tail, no amount lock. A price
    below 0.0001 XNO is refused. The checkout holds its `index` and its address
    (`to`). The check is the existing `claimCheckout`: exactly the quote, at that
    address, first seen in the window, confirmed. No tolerance.
  - `sweepCheckout` and `sweepPaid`: receive the one paid block at the address
    with its own key and send exactly the quote to a `destination` that you pass
    as a fixed value in your code (never read from the checkout record). The send
    is recorded before it is published (exactly once); a lease on the checkout
    and fenced writes make two runs safe; a record whose index does not give its
    address, or a block that is not a confirmed send of the quote to that
    address, moves nothing.
  - `derivedReturns`: `addresses`, `signerFor` and `isClaimable` for
    `@nano133/late-returns` 0.4.0, so a payment of any other amount to a derived
    address goes back in full.
  - `deriveAddress`, `derivedSigner`, `cleanQuote`, `isCleanQuote`,
    `stateBlockHash`, `DERIVED_INDEX_CAP` (1,000,000), `DEFAULT_SEED_LABEL`
    (`"nano133 kit checkout seed v1"`). No function returns, logs or stores a
    seed or a private key. The secret must have at least 32 characters.
- `DerivedStore` (a `CheckoutStore` plus an atomic index counter, `byAddress`,
  the sweep lease and the sweep's records). `memoryStore` and `firestoreStore`
  have all of it; `firestoreStore` takes an optional `counter` document path
  (default `checkout_index/counter`).
- `claimCheckout` takes `ClaimOptions` (no `to`, no `tail`), so a derived-only
  site needs neither. `CheckoutOptions` still has them.
- `store.claimable(amount, now)` skips derived checkouts: a derived checkout is
  claimed by its own address (`derivedReturns().isClaimable`).
- `Checkout` has the optional fields `index`, `scanUntil` and `sweep`.
- README and SPEC teach the address for each checkout first; the unique amount
  is "the older way", with its limit: a wallet that cuts or rounds the amount
  (Cake Wallet) makes a payment that cannot be matched.

## 0.2.1

- Exports `CLOCK_SLACK_MS`, the clock allowance of the payment window.

## 0.2.0

- `uniqueAmount(price, tryLock)`: the unique-amount loop for sites that keep
  checkouts in their own records. `createCheckout` uses it.

## 0.1.0

- First version: `createCheckout`, `claimCheckout`, `checkPayment`,
  `findInWindow`, receipts (`signReceipt`, `verifyReceipt`), amounts
  (`priceRaw`, `toXno`, `nanoUri`), `xnoUsdRate`, `memoryStore`,
  `firestoreStore`.
