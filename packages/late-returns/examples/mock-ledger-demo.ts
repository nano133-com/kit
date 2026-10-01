// A walk-through on a mock ledger (no network, no money): a checkout closes, a payment arrives late,
// and after the waiting time it goes back to its sender exactly once.
//
//   npm run example

import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { runLateReturns } from "../src/index.js";
import { memoryStore } from "../src/memoryStore.js";
import { MockLedger } from "../test/mockLedger.js";
import { seedSigner } from "./signer.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const XNO = 10n ** 30n;
const fmt = (raw: bigint) => `Ӿ${(Number(raw) / 1e30).toFixed(6)}`;
const shop = seedSigner(createHash("sha256").update("demo shop wallet").digest("hex"));
const buyer = nanoWeb.wallet.legacyAccounts(createHash("sha256").update("demo buyer").digest("hex"), 0, 0)[0].address;
const owner = nanoWeb.wallet.legacyAccounts(createHash("sha256").update("demo owner").digest("hex"), 0, 0)[0].address;

const led = new MockLedger();
const store = memoryStore();
// The shop's wallet holds 10 XNO from its owner.
const topUp = led.pay(owner, shop.address, 10n * XNO, 99_999);
await led.rpc({ action: "process", block: (await shop.receive({ frontier: null, balance: 0n, representative: owner, source: topUp, amount: 10n * XNO, work: "0" })).block });

// A checkout asked for 0.0281 XNO + a unique tail. The buyer paid 3 hours later, after the checkout closed.
const amount = 281n * 10n ** 26n + 734_201n;
const late = led.pay(buyer, shop.address, amount, 3 * 3600);
console.log(`1. A late payment of ${fmt(amount)} waits at the shop (block ${late.slice(0, 10)}…).`);

const options = {
  rpc: led.rpc,
  store,
  signer: shop,
  never: [owner],
  // The shop's own question: can one of my open checkouts still claim this amount? (Here: none can.)
  isClaimable: async () => false,
};
const r1 = await runLateReturns(options);
console.log(`2. A run records ${r1.recorded} return and sends ${r1.sent}.`);
const sent = led.sendsFrom(shop.address, buyer);
console.log(`3. The buyer got ${sent.length} send of ${fmt(sent[0][1].amount)} back (block ${sent[0][0].slice(0, 10)}…).`);
const r2 = await runLateReturns(options);
console.log(`4. The next run sends ${r2.sent}: a payment goes back once.`);
console.log(`5. The shop still holds ${fmt(led.balance(shop.address))} of its own money.`);
