---
name: add-player-signin
description: Add the PLAYER sign-in to a game made with the Nanoterra kit or the game starter, with @nano133/nanoterra/player-signin - a passkey (Face ID, Touch ID or the device PIN, made into a Nano account in the browser) or a wallet app (Berry Wallet, NanChat, Nautilus), with sessions, a ready sign-in sheet and the shop's player hook. Use when the user asks for player login, passkey sign-in for players, "players without a wallet cannot buy", or sign-in for a game's shop.
---

# Add the player's sign-in

Follow step 12 of the package's `ai/SPEC.md` (https://nano133.com/build/nanoterra, or
`node_modules/@nano133/nanoterra/ai/SPEC.md`) and the README section "The player's sign-in".

1. **Ask** the owner: which ways (the passkey and the three wallet apps by default), the game's
   domain for good (a passkey belongs to one domain), and whether to offer the spare key.
2. `npm install @nano133/nanoterra @nano133/signin`.
3. **Write the frozen scheme once** in one file, with the game's domain in its texts:
   `{ input: "<domain> player v1", salt: "<domain>", info: "<domain> player seed v1", versionByte: 1 }`.
   Ask the owner to approve the texts: they can never change. Add a test with two FIXED vectors
   from `schemeVector(SCHEME, prfHex)`; run it once, write the seed and the address in, and never
   change them. Never use a default scheme, and never edit one after the first player.
4. The store: D1 adds `@nano133/nanoterra/player-signin/d1.sql` to the migrations (the starter's
   tables and sessions stay) and `createD1PlayerSignin(env.DB)`; Firestore uses
   `createFirestorePlayerSignin(db)` with a TTL policy on `deleteAt`. A store of your own passes
   `playerSigninStoreConformance` first.
5. The server: `createPlayerSignin({ store, siteAddress, limit, visitor, personCheck })`, and
   `handle(request)` first under `/api/`. The starter passes `sharedPaths: true` (its admin signs in
   on the same paths); a game that uses the package's admin sign-in (`@nano133/nanoterra/admin-signin`,
   on `/api/admin-signin`, SPEC step 14) does not. The shop's and the friends' `player` hook is `signin.player(request)`.
6. "Delete my data" calls `signin.forget(player)`; a cron calls `signin.clean()`.
7. The page: `mountPlayerSignin(document.body, { name, scheme, qr, onSignedIn })` with
   `@nano133/nanoterra/player-signin/style.css`; the account key and the shop call `open()`.

Never print, log, store or send the seed. Never write your own passkey or signature code. Test the
passkey on the game's real https address with a phone; a wallet needs a public https address too.
Finish with the SPEC's step 12 check.
