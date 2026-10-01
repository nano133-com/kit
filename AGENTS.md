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

## Working in this repository

- `npm test` runs every package's tests (mock ledger; no network, no money).
- Packages have no runtime dependencies; keep it that way.
- Code comments and docs: plain, direct English.
