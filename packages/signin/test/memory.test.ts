import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryOnce, memoryRequests } from "../src/memory.js";
import { checkOf, sameStarter } from "../src/requests.js";

test("memoryOnce: a key once, until it expires", async () => {
  const once = memoryOnce();
  assert.equal(await once("k", 60_000, "nano_x"), true);
  assert.equal(await once("k", 60_000, "nano_x"), false);
  assert.equal(await once("j", -1, "nano_y"), true);
  assert.equal(await once("j", 60_000, "nano_y"), true, "an expired key can be used again");
});

test("memoryRequests: finish only a waiting request; find by id", async () => {
  const s = memoryRequests();
  await s.create("key1", { id: "id1", starter: "aa", status: "waiting", expiresAt: 10 });
  await assert.rejects(s.create("key1", { id: "id2", starter: "aa", status: "waiting", expiresAt: 10 }));
  assert.equal((await s.find("id1"))?.key, "key1");
  assert.equal(await s.find("nope"), null);
  assert.equal(await s.finish("key1", "nano_a"), true);
  assert.equal(await s.finish("key1", "nano_b"), false);
  assert.equal((await s.get("key1"))?.account, "nano_a");
});

test("the starter compare and the delivery window", () => {
  assert.equal(sameStarter("ab".repeat(32), "ab".repeat(32)), true);
  assert.equal(sameStarter("ab".repeat(32), "ac".repeat(32)), false);
  assert.equal(sameStarter("ab", "abab"), false);
  assert.equal(sameStarter(undefined, "ab"), false);
  const found = { key: "k", request: { id: "i", starter: "ab".repeat(32), status: "signedin" as const, expiresAt: 1000, account: "nano_a" } };
  assert.equal(checkOf(found, 1000 + 59 * 60_000, "ab".repeat(32)).mine, true);
  assert.equal(checkOf(found, 1000 + 61 * 60_000, "ab".repeat(32)).mine, false, "an hour after expiry nobody is signed in by it");
  assert.equal(checkOf(null, 0).status, "expired");
});
