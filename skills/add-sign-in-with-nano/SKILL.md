---
name: add-sign-in-with-nano
description: Add "Sign in with Nano" to a website with @nano133/signin - people sign in with a Nano (XNO) wallet by a tiny payment or by a signature, with no password or email. Use when the user asks for Nano or XNO login, wallet sign-in, or Sign in with Nano.
---

# Add Sign in with Nano

Follow the package's `ai/SPEC.md` step by step
(https://nano133.com/build/sign-in-with-nano/SPEC.md, or
`node_modules/@nano133/signin/ai/SPEC.md`).

1. **Ask** which ways (payment, signature, both), the sign-in address (a
   wallet used only for sign-ins), the node, and the site's domain.
2. Install; build `rpc`; pick or write the stores.
3. Set the starter cookie; pass its hash as `starter`.
4. Payment routes: start and check, both rate-limited (required).
5. Signature route: the domain in the message, once-only keys, rate-limited.
6. Optional refunds with `@nano133/late-returns` (needs the key; never on test data).
7. Test with the mock ledger, then one real sign-in.

Never print, log or commit a key or secret. Finish with the SPEC's "Done when" list.
