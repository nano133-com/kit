// A walk-through on a mock ledger (no network, no money): create a checkout, pay it, claim it, check the receipt.
//
//   npm run example
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { claimCheckout, createCheckout, nanoUri, priceRaw, toXno, verifyReceipt } from "../src/index.js";
import { memoryStore } from "../src/memoryStore.js";
import { MockLedger } from "../test/mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const acct = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0].address;
const shop = acct("demo shop"), buyer = acct("demo buyer");
const led = new MockLedger();
const o = { rpc: led.rpc, store: memoryStore(), to: shop, receiptSecret: "demo secret" };

const checkout = await createCheckout(o, { item: "article:42", price: priceRaw(0.01, 0.36) });
console.log(`1. The checkout asks for exactly Ӿ${toXno(checkout.amount)}.`);
console.log(`   Link for wallets: ${nanoUri(shop, checkout.amount).slice(0, 40)}…`);
console.log(`2. Before payment: ${(await claimCheckout(o, checkout.id, null)).state}.`);
led.pay(buyer, shop, BigInt(checkout.amount), 0);
const r = await claimCheckout(o, checkout.id, null);
console.log(`3. After payment: ${r.state}, from ${r.state === "paid" ? r.checkout.payer!.slice(0, 12) : "?"}….`);
const claims = r.state === "paid" ? verifyReceipt("demo secret", r.receipt, { item: "article:42" }) : null;
console.log(`4. The receipt unlocks article:42 for this payer: ${claims ? "yes" : "no"}.`);
