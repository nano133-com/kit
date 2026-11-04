---
name: add-shop
description: Add a shop that sells looks (cosmetics) for Nano (XNO) to a Nanoterra game with @nano133/nanoterra/shop - payments go straight from the player's wallet to the creator's address with no key on the server, a unique clean amount for each order matched exactly on the ledger, D1 or Firestore stores, a Worker setup from the game starter's settings, and a ready Looks sheet and pay sheet (QR code, TEST MODE stamp). Use when the user asks to sell looks, skins, outfits or items, add a shop or a store, take Nano payments for cosmetics, or move the game starter's shop onto the package, in a game made with the Nanoterra kit or the game starter.
---

# Add a shop

Follow step 13 of the package's `ai/SPEC.md` (https://nano133.com/build/nanoterra, or
`node_modules/@nano133/nanoterra/ai/SPEC.md`) and the README section "The shop".

1. **Ask** for the creator's own Nano address (it receives every payment) and where the game runs:
   a Cloudflare Worker with D1 (the starter's way: `createShop` from `/shop/worker`) or another
   server (`createShopHandler` from `/shop` with `createFirestoreShop` or a store of its own).
   Keep `TEST_MODE` on until the owner says sell.
2. **Never add a key.** The server holds no seed and sends nothing: it reads the ledger. Install
   the shop; do not copy the starter's orders, match, sweep, price or nodes files.
3. D1: add `@nano133/nanoterra/shop/d1.sql` to the migrations (a game from the starter needs none).
   A store of your own passes `shopStoreConformance` first (each case its own test).
4. `player(req)` reads the game's PLAYER sign-in, never the admin's. The shop draws no sign-in:
   give the panel `signIn()`, which opens the game's own sign-in.
5. Add the cron (`*/10 * * * *`: `shop.scan()`), the admin's `check: (at) => shop.scan(at)`,
   `owned` in the game's `/api/me` (`shop.owned(player)`) and `testMode` in its config.
6. Mount `mountShop(el, { looks, owned, signedIn, signIn, worn, wear, onOwned })` with the
   stylesheet `@nano133/nanoterra/shop/style.css`; `key: false` and `open()` for the game's own key.
   The game's own words go in `words` (`ShopWords`), never in the kit's files; a shop in its own
   modal `<dialog>` closes it in `signIn` before the sign-in sheet opens.
7. Merge `SHOP_CSP` into the game's policy with `mergeCsp`. Never replace the game's policy.
8. Call `store.forget(player, now)` from "Delete my data".
9. Test on a phone first (upright and sideways), then a tablet, then a computer, in TEST MODE:
   the stamp "TEST MODE: DO NOT PAY", no QR code, no address, the wallet key off.

Never show a pay screen that pays an address nobody holds the key for without the stamp. A look
only changes how the character looks: nothing random, no score. Finish with the SPEC's step 13 check.
To charge for a round (a play bought and used once), use the skill `add-paid-rounds` after this one.
