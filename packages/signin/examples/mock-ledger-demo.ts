// A walk-through on a mock ledger (no network, no money): a payment sign-in, then a signature sign-in.
//
//   npm run example
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { checkSignin, startSignin } from "../src/index.js";
import { checkSignatureSignin } from "../src/signature.js";
import { signinMessage } from "../src/message.js";
import { memoryOnce, memoryStore } from "../src/memoryStore.js";
import { MockLedger } from "../test/mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const acct = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0];
const signinAddress = acct("demo sign-in address").address;
const user = acct("demo user");
const led = new MockLedger();
const o = { rpc: led.rpc, store: memoryStore(), config: { address: signinAddress } };

const s = await startSignin(o, { starter: "this-browser" });
console.log(`1. Send exactly ${(Number(s.amount) / 1e30).toFixed(12)} XNO to ${signinAddress.slice(0, 14)}… (raw ${s.amount}).`);
console.log(`2. Before the payment: ${(await checkSignin(o, s.id, null, { starter: "this-browser" })).state}.`);
led.pay(user.address, signinAddress, BigInt(s.amount), 0);
const r = await checkSignin(o, s.id, null, { starter: "this-browser" });
console.log(`3. After it: ${r.state} as ${r.state === "signedin" ? r.account.slice(0, 14) : "?"}… (this browser: ${r.state === "signedin" && r.mine}).`);

const at = Date.now();
const signature = nanoWeb.tools.sign(user.privateKey, Buffer.from(signinMessage("example.com", user.address, at), "utf8").toString("hex"));
const who = await checkSignatureSignin({ domain: "example.com", useOnce: memoryOnce() }, { address: user.address, at, signature });
console.log(`4. A signature from the wallet's key signs in ${who.slice(0, 14)}… with no payment at all.`);
