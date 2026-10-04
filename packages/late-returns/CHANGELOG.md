# Changelog

## 0.3.0

- `perSenderPerDay` (off by default): at most that many returns per sender per
  UTC day. Later payments from that sender that day are recorded as "kept"
  (reason "limit"), marked used, and never sent; they don't count toward
  `perDay`. For a site that doesn't want a flood of payments from one address
  to cost it a return each.
- `releaseKept({ rpc, store }, hash, by)`: sends a kept payment back after all
  (once, with the next run). The sender is read again from your node.
- `ReturnStore`: `record()` takes an optional `SenderLimit`, a store says
  `senderLimit: true` and has `release()`. `memoryStore` and `firestoreStore`
  have both; a store of your own without them works as before, unless you turn
  `perSenderPerDay` on (then the run stops with a clear error).
- `firestoreStore`: a sender's daily counter is `sender-<day>-<hash>` in `days`
  (or `meta`): no address in it, and a `deleteAt` for a TTL policy.

## 0.2.0

- `firestoreStore`: `mark` names every collection that gets a return's "used"
  mark (default: the first `used` collection), and `days` puts the daily
  counters in their own collection (default: `meta`).

## 0.1.0

- First version: `runLateReturns`, `findLateReturns`, `settleReturns`,
  `sendOnce`, `memoryStore`, `firestoreStore`.
