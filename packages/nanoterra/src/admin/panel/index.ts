// "@nano133/nanoterra/admin/panel": the admin page of a game, drawn in the browser into one element. Plain DOM, no framework, no Three.js.
//
//   import { mountAdmin } from "@nano133/nanoterra/admin/panel";
//   import "@nano133/nanoterra/admin/style.css";
//   mountAdmin(document.getElementById("admin")!, { looks, signIn, signOut });
//
// The server part is "@nano133/nanoterra/admin" (the guard and the handler): it must not load this one.

export { mountAdmin } from "./mount.js";
export type { MountedAdmin, MountOptions } from "./mount.js";
export { ApiError, createApi } from "./api.js";
export type { Api } from "./api.js";
export { gameCard } from "./gameCard.js";
export { BODY_COLOURS, lookPicture, previewPicture, shelfFilter, shelfSort, shelfView } from "./shelf.js";
export { DEFAULT_LOGINS_NOTE, signinsCard } from "./signins.js";
export type { ShelfData, ShelfFilter, ShelfSort } from "./shelf.js";
export { orderMatches, ordersView } from "./orders.js";
export type { OrderFilter, OrdersView } from "./orders.js";
export { bestSellers, overviewView } from "./overview.js";
export type { BestSeller, OverviewView } from "./overview.js";
export { playerMatches, playersView } from "./players.js";
export { TABS, tabBar } from "./tabs.js";
export type { TabBar, TabId } from "./tabs.js";
export { icon } from "./icons.js";
export type { IconName } from "./icons.js";
export { aiPrompt, centsOf, changeText, ownedIds, shelfStats, soldText } from "./shelfData.js";
export type { LookStats, ShelfOrder, ShelfPlayer } from "./shelfData.js";
