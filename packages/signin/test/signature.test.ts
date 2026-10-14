import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSignatureSignin, onceKey, SigninError } from "../src/signature.js";
import { signinMessage } from "../src/message.js";
import { memoryOnce } from "../src/memory.js";
import { purseAddress, signinBody, signText } from "../src/purse.js";
import { verifyMessage } from "../src/verify.js";
import { account, seedOf, signHexText } from "./keys.js";

const NOW = 1_790_000_000_000;
const now = () => NOW;
const status = async (p: Promise<unknown>) => p.then(() => 0, (e) => (e instanceof SigninError ? e.status : -1));

test("a purse's sign-in body signs in, once, and the store keeps the account", async () => {
  const seed = seedOf("purse one");
  const body = signinBody("example.com", seed, NOW);
  assert.equal(body.address, purseAddress(seed));
  const useOnce = memoryOnce();
  assert.equal(await checkSignatureSignin({ domain: "example.com", useOnce, now }, body), body.address);
  assert.equal(await status(checkSignatureSignin({ domain: "example.com", useOnce, now }, body)), 409, "the same signature again");
  const [row] = [...useOnce.rows.values()];
  assert.equal(row!.address, body.address, "the row names the account (for a deletion)");
});

test("another domain, an old time, a wrong key, a broken address: refused", async () => {
  const seed = seedOf("purse two");
  const body = signinBody("example.com", seed, NOW);
  const useOnce = memoryOnce();
  assert.equal(await status(checkSignatureSignin({ domain: "other.example", useOnce, now }, body)), 401);
  assert.equal(await status(checkSignatureSignin({ domain: "example.com", useOnce, now: () => NOW + 5 * 60_000 + 1 }, body)), 400);
  const stranger = account("stranger");
  assert.equal(await status(checkSignatureSignin({ domain: "example.com", useOnce, now }, { ...body, signature: signHexText(stranger.privateKey, signinMessage("example.com", body.address, NOW)) })), 401);
  assert.equal(await status(checkSignatureSignin({ domain: "example.com", useOnce, now }, { ...body, address: body.address.slice(0, -1) + (body.address.endsWith("1") ? "3" : "1") })), 400);
  await assert.rejects(checkSignatureSignin({ domain: " ", useOnce, now }, body), /domain/);
});

test("the purse signs in the form verifyMessage checks; onceKey and its label", () => {
  const seed = seedOf("purse three");
  const s = signText(seed, "hello");
  assert.equal(verifyMessage(s.address, "hello", s.signature), true);
  assert.notEqual(onceKey("m"), onceKey("m", "purse sign-in v2"), "a site may keep its own label");
  assert.equal(onceKey("m", "purse sign-in v2"), onceKey("m", "purse sign-in v2"));
});
