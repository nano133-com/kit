# Changelog

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
