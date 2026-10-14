# AGENTS.md

Instructions for AI coding agents (Codex, Gemini, Claude Code and others)
that use the nano133 Kit in a website.

## Late Payment Return (`@nano133/late-returns`)

Use it when a site that takes Nano (XNO) needs payments that no checkout
claimed to go back to their sender. Follow
`packages/late-returns/ai/SPEC.md` step by step.

- Ask the owner where the wallet seed lives. Never print, log or commit it.
- Use the owner's own Nano node for `rpc`.
- The claim must refuse a used payment hash and record its own in the same
  transaction.
- Never run returns against a test database with the real key.
- Test with the mock ledger (`packages/late-returns/test/mockLedger.ts`)
  before any real payment.

## Nano Checkout (`@nano133/checkout`)

Use it when a site wants to take Nano (XNO) payments. Follow
`packages/checkout/ai/SPEC.md` step by step.

- Ask for the receiving address and the node. The server holds no key.
- Prices come from the server, never from the browser.
- Rate-limit the checkout and claim routes per visitor.
- Give the receipt only to the browser that started the checkout.
- Never print, log or commit the receipt secret.

## Sign in with Nano (`@nano133/signin`)

Use it when a site wants Nano (XNO) sign-in: a passkey purse, Nautilus,
NanChat or any key in the page. Follow `packages/signin/ai/SPEC.md` step by step.

- Every way is a signature: no payment, and the server holds no key.
- Rate-limit every sign-in route (required); NanChat's answer by total and nonce.
- Only the browser that started a Nautilus or NanChat request gets the session.
- The messages name the site's domain.
- A passkey scheme is frozen in the site's code, with a vector test.
- Never print, log or commit a key or secret.

## Working in this repository

- `npm test` runs every package's tests (mock ledger; no network, no money).
- Packages have no runtime dependencies; keep it that way.
- Code comments and docs: plain, direct English.
