// A walk-through of an address for each checkout, on a mock ledger (no network, no money): create two checkouts, pay one
// with the exact amount, pay the other with one step less, claim, and sweep. (Late Payment Return, which sends the wrong
// payment back, is in test/derived.test.ts and the README.)
//
//   npm run example:derived
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { claimCheckout, nanoUri, priceRaw, toXno } from "../src/index.js";
import { createDerivedCheckout, sweepPaid } from "../src/derived.js";
import { memoryStore } from "../src/memoryStore.js";
import { MockLedger } from "../test/mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const acct = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0].address;
const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-4)}`;
const buyer = acct("demo buyer");
const mine = acct("demo destination"); // YOUR address: where each payment ends
const secret = "demo checkout secret, at least 32 characters long";
const led = new MockLedger();
const store = memoryStore();
const options = { rpc: led.rpc, store, secret };

const a = await createDerivedCheckout(options, { item: "article:42", price: priceRaw(0.01, 0.36) });
const b = await createDerivedCheckout(options, { item: "article:42", price: priceRaw(0.01, 0.36) });
console.log(`1. Two checkouts, one clean amount (Ӿ${toXno(a.amount)}), two addresses: ${short(a.to)} and ${short(b.to)}.`);
console.log(`   Link for wallets: ${nanoUri(a.to, a.amount).slice(0, 40)}…`);
led.pay(buyer, a.to, BigInt(a.amount), 0);
console.log(`2. The exact amount at the first address: ${(await claimCheckout(options, a.id, null)).state}.`);
led.pay(buyer, b.to, BigInt(b.amount) - 10n ** 26n, 0);
console.log(`3. One step less at the second address: ${(await claimCheckout(options, b.id, null)).state}.`);
const swept = await sweepPaid({ ...options, destination: mine });
console.log(`4. The sweep moved ${swept.swept} payment on to my address (once: a second run moves ${(await sweepPaid({ ...options, destination: mine })).swept}).`);
