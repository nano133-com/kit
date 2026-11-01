// "@nano133/nanoterra/shop": the shop of a game that sells looks for Nano (XNO), as the game starter sells them. No database, no cookie, no key: the money
// goes straight from the player's wallet to the creator's address, and the server only READS the ledger to see that a payment came (a unique, clean
// amount for each order, matched exactly). The game gives its store, its looks, its address and its signed-in player.
//
//   createShopHandler     the routes (POST an order, GET it, POST its check), on Request and Response
//   scanPayments          one look at the creator's address that settles every held order (the cron's and the admin's check)
//   createMemoryShop      a store in memory, for tests
//   the rules             amounts (raw text and BigInt), the reservation, the match, the price, the nodes, the address check, the CSP lists
//   (the adapters are "/shop/d1" and "/shop/firestore", a Worker set up from the starter's settings "/shop/worker", the conformance suite
//   "/shop/conformance", the browser panel "/shop/panel")

export { EXAMPLE_ADDRESS, blake2bShort, payeeOf, validAddress } from "./address.js";
export { MAX_RATE, MAX_USD, MIN_RATE, RAW_PER_XNO, STEP_RAW, compareRaw, isClean, isRaw, nanoUri, plusSteps, priceRaw, rawFromSteps, stepsFromUsd, xnoText } from "./amount.js";
export { CLOCK_SLACK_MS, candidates, checkSend } from "./match.js";
export type { Verdict } from "./match.js";
export { KEYED_NODE, NodeDown, PUBLIC_NODES, forgetNodeHealth, nodesFor, rpc, settingValue } from "./nodes.js";
export type { Fetch, NanoNode, RpcOptions } from "./nodes.js";
export { LATE_HOLD_MS, MAX_EXTRA_PERCENT, MAX_OPEN_PER_PLAYER, MAX_STEPS, ORDER_ID_PATTERN, ORDER_TTL_MS, ShopBusy, amountsFor, newOrderId, orderView, paidStatus, reserveOrder, smallestAmount, statusAt, stepsFor } from "./orders.js";
export type { ReserveInput } from "./orders.js";
export { PRICE_FEEDS, RATE_FRESH_MS, RATE_LAST_GOOD_MS, readFeeds, usdPerXno } from "./price.js";
export type { PriceFeed, Rate } from "./price.js";
export { SCAN_GAP_MS, forgetBlocks, scanPayments } from "./scan.js";
export type { ScanOptions, ScanResult } from "./scan.js";
export { FORGOTTEN } from "./store.js";
export type { ForgetResult, KeptRate, OrderStatus, Payment, Settled, ShopOrder, ShopStore } from "./store.js";
export { createMemoryShop } from "./memory.js";
export type { MemoryShop } from "./memory.js";
export { SHOP_LIMITS, createShopHandler } from "./handler.js";
export type { PayView, ShopHandler, ShopHandlerOptions } from "./handler.js";
export { SHOP_CSP, TURNSTILE_ORIGIN, mergeCsp } from "./security.js";
