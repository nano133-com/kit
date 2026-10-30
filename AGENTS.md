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

- Recommend way A, an address for each checkout (a clean amount, an exact check,
  a sweep to the owner's address). It puts a seed on the server: ask the owner
  first, and keep the secret in their secret manager. Way B (one address, a unique
  amount) needs no key but a wallet that rounds the amount can never pay it.
- Way A: the sweep's `destination` is a fixed value in the code, never read from a
  record. Never change the secret or the label after the first checkout.
- Way B: ask for the receiving address and the node. The server holds no key.
- Prices come from the server, never from the browser.
- Rate-limit the checkout and claim routes per visitor.
- Give the receipt only to the browser that started the checkout.
- Never print, log or commit the receipt secret, the checkout secret or a key.

## Sign in with Nano (`@nano133/signin`)

Use it when a site wants Nano (XNO) sign-in: a passkey purse, Nautilus,
NanChat or any key in the page. Follow `packages/signin/ai/SPEC.md` step by step.

- Every way is a signature: no payment, and the server holds no key.
- Rate-limit every sign-in route (required); NanChat's answer by total and nonce.
- Only the browser that started a Nautilus or NanChat request gets the session.
- The messages name the site's domain.
- A passkey scheme is frozen in the site's code, with a vector test.
- Never print, log or commit a key or secret.

## Nano for Three.js (`@nano133/three`)

Use it when a game needs a server-checked result and a small Nano (XNO)
prize. Follow `packages/three/ai/SPEC.md` step by step.

- Share one pure, versioned rule file between the browser and the server.
- Start the round and make its seed on the server. Replay inputs, not a score.
- Bind the player and trusted address on the server. Check ownership on every route.
- Rate-limit the routes. Set per-player and total daily prize limits.
- Keep the key in the owner's secret manager. The sender is the owner's code.
- Use one persistent store per prize wallet. Never clear an uncertain signing reservation to sign again.
- Test with no real money first.

## Nanoterra for a game (`@nano133/nanoterra`)

Use it when a game wants the player's Nanoterra identity: a sign-in ticket (a game on a
**static site**), the player's character in a Three.js scene, or the looks ladder for a game
that sells looks. One package, three paths: `/ticket`, `/character` (and `/character/record`
with no Three.js) and `/looks`. Follow `packages/nanoterra/ai/SPEC.md` step by step.

- **The ticket** (`/ticket`): a game with a server uses the code exchange, not this. A ticket
  proves nothing to a server: never give a sale, a prize or a score on it. Ask "Sign in as
  <name>? Continue / Not me" before treating the player as that name. Show the name as text,
  never as HTML.
- **The character** (`/character`): it draws a character only: no money, no sign-in, no server
  code. A character is a record of whole numbers on closed lists (`/character/record`); check
  every record with `recordProblem` and every five-colour look with `isLook` before it reaches
  `createCharacter` or `setLook`. It is display only: never use it for a game's rules, and give
  every base and size the same collider, jump and reach.
- `dt` is in seconds. Call `update` once each frame with the game's own speed, `airborne` and
  `verticalSpeed`. The shadow is in the body: add `c.object` to the scene and nothing else.
- Use `HEIGHT` and `RADIUS` (the Classic's) for the collider. Call `dispose` when a character
  leaves. Do not edit the geometry or the skeleton. The island's bone names are kept on purpose.
- Keep the choice between the Nanoterra character and the game's own in ONE place (the game
  starter: `"character"` in `game.config.json`).
- **The looks** (`/looks`): the game is the seller. A look only changes how the character
  looks: never a score, a speed or a rule, never random. Keep one free outfit. A look with `wear`
  is an item of the game's own wear slot (a tool's skin, a charm) and has no `change`. Never change or
  remove the id, or change the wear slot, of a look that someone owns. Never send looks, prices or
  sales to another site.

## Working in this repository

- `npm test` runs every package's tests (mock ledger; no network, no money).
- Packages have no runtime dependencies; keep it that way.
- Code comments and docs: plain, direct English.
