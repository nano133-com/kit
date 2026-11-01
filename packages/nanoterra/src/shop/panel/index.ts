// "@nano133/nanoterra/shop/panel": the Looks key and the shop's sheet, drawn in the browser. Plain DOM, no framework, no Three.js, no QR library.
//
//   import { mountShop } from "@nano133/nanoterra/shop/panel";
//   import "@nano133/nanoterra/shop/style.css";
//   const shop = mountShop(document.getElementById("shop")!, { looks, owned: () => me.owned, signedIn: () => !!me.address, signIn, worn, wear, onOwned });
//
// Every word of the two sheets can be the game's own: `mountShop(el, { ..., words: { sendExactly: "Pay exactly" } })` (ShopWords; SHOP_WORDS are the defaults).
//
// The server part is "@nano133/nanoterra/shop" (the handler and the stores): it must not load this one.

export { mountShop } from "./mount.js";
export type { MountedShop, ShopMountOptions } from "./mount.js";
export { looksView, slotsOf } from "./looks.js";
export type { LooksViewOptions, SlotWords } from "./looks.js";
export { PAY_TIMING, isTestOrder, payPanel } from "./pay.js";
export type { PayOptions, PayPanel } from "./pay.js";
export { qrModules, qrSvg, qrVersionFor } from "./qr.js";
export { COINGECKO_CREDIT, SHOP_WORDS, priceLine, shopWords } from "./words.js";
export type { ShopWords } from "./words.js";
