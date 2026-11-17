// "@nano133/nanoterra/shop/panel": the Looks key and the shop's sheet, drawn in the browser. Plain DOM, no framework, no Three.js, no QR library.
//
//   import { mountShop } from "@nano133/nanoterra/shop/panel";
//   import "@nano133/nanoterra/shop/style.css";
//   const shop = mountShop(document.getElementById("shop")!, { looks, owned: () => me.owned, signedIn: () => !!me.address, signIn, worn, wear, onOwned });
//
// Every word of the two sheets can be the game's own: `mountShop(el, { ..., words: { sendExactly: "Pay exactly" } })` (ShopWords; SHOP_WORDS are the defaults).
// A game that sells plays gives `plays` (plays.json) and `onCredit`, and uses `buyPlay(playId)`, `playKey(playId, start)` and `ready()`.
// The pay sheet's creator part (since 0.16.0): `preview(item, size)`, `next(item)`, `celebrate(item, calm)`, `offer` and the CSS tokens (style.css).
// The try-on stage (since 0.18.0): `tryOn: () => import(VIEWER)`, loaded when the sheet opens (this path never names Three.js).
//
// The server part is "@nano133/nanoterra/shop" (the handler and the stores): it must not load this one.

export { mountShop } from "./mount.js";
export type { MountedShop, PlayItem, PlayReady, ShopItem, ShopMountOptions } from "./mount.js";
export { looksView, slotsOf } from "./looks.js";
export type { LooksViewOptions, SlotWords } from "./looks.js";
export { PAY_TIMING, calmNow, isTestOrder, itemPicture, payPanel, trustShown } from "./pay.js";
export type { PayNext, PayOptions, PayPanel } from "./pay.js";
export { qrModules, qrSvg, qrVersionFor } from "./qr.js";
// The try-on's sheet part (./tryon.ts) is a chunk of its own, loaded with import() by mountShop only when the game gives `tryOn`: not exported here.
export type { TryOnLoad } from "./tryon.js";
export type { TryOnContext, TryOnShow, TryOnStage, TryOnViewer } from "../viewer/contract.js";
export { COINGECKO_CREDIT, SHOP_WORDS, TRUST_LINE, playPrice, priceLine, shopWords, useWord } from "./words.js";
export type { ShopWords, TryOnWords } from "./words.js";
