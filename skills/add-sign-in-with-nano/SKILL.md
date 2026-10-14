---
name: add-sign-in-with-nano
description: Add "Sign in with Nano" to a website with @nano133/signin - people sign in with a passkey purse, or with a Nano (XNO) wallet that signs (Nautilus, NanChat), with no payment, password or email. Use when the user asks for Nano or XNO login, wallet sign-in, passkey sign-in with Nano, or Sign in with Nano.
---

# Add Sign in with Nano

Follow the package's `ai/SPEC.md` step by step
(https://nano133.com/build/sign-in-with-nano/SPEC.md, or
`node_modules/@nano133/signin/ai/SPEC.md`).

1. **Ask** which ways (passkey purse, Nautilus, NanChat, a key in the page),
   the site's domain, and for Nautilus the site's own Nano address.
2. Install; pick or write the stores (once-only, and requests for the apps).
3. Passkey purse: freeze the scheme in code with a vector test; make, first
   use, open; offer a spare key; post `signinBody` to the signature route.
4. Signature route: the domain in the message, once-only keys, rate-limited.
5. Nautilus and NanChat: the starter cookie; start, answer and check routes;
   their replies; NanChat's answer limited by total and nonce.
6. Sessions: a new id, "Signed in as nano_…", an Origin check.
7. Test with the memory stores, then one real sign-in with each way.

Never print, log or commit a key or secret. Finish with the SPEC's "Done when" list.
