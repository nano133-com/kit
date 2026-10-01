---
name: add-late-payment-return
description: Add Late Payment Return to a website that takes Nano (XNO) payments - payments no checkout claimed go back to their sender automatically, exactly once, with @nano133/late-returns. Use when the user asks to refund late, stray or unmatched Nano payments, or to add Late Payment Return.
---

# Add Late Payment Return

Goal: Nano payments that no checkout claimed go back to their sender,
exactly once, using the npm package `@nano133/late-returns`.

Follow the package's `ai/SPEC.md` step by step
(https://nano133.com/build/late-payment-return/SPEC.md, or
`node_modules/@nano133/late-returns/ai/SPEC.md` after install). Its steps:

1. Confirm the site fits: it pays into a wallet whose key the server holds,
   uses unique checkout amounts, and records claimed payments by block hash.
   If not, stop and explain why.
2. Install the package.
3. **Ask the user where the wallet seed lives.** Read it from a secret
   store. Never print, log or commit it, not even partly.
4. Build `rpc` for the user's own node.
5. Pick or write the store (Firestore adapter, or `ReturnStore` for their database).
6. Make the claim refuse used hashes and record its own, in one transaction.
7. Write `isClaimable` from the site's open checkouts and their grace period.
8. Fill `never` with the owner's top-up address and the site's other wallets.
9. Schedule `runLateReturns` every 5 minutes; never against test data.
10. Test with the package's mock ledger, then one 0.001 XNO real test.

Rules:

- This moves real money from a hot wallet. Say so in the pull request, and
  recommend keeping only small amounts in that wallet.
- Do not change the defaults (2 hours, 0.001 XNO, 3 per run, 30 per day)
  without the user's reason.
- Finish with the SPEC's "Done when" checklist, item by item.
