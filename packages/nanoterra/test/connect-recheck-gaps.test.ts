// Sign in from Nanoterra: tests for the gaps that the re-check's broken copies found (2026-11-15): the secret rule at its edges, the
// local opt-in's conditions, the Node body's time bound.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectTestSecret } from "../src/connect/conformance.js";
import { ConnectSetupError, createConnect, strongSecret } from "../src/connect/core.js";
import { createMemoryOnce } from "../src/connect/index.js";
import { BODY_MS, webRequest } from "../src/connect/node.js";

describe("re-check gaps", () => {
  it("the secret rule at its edges", () => {
    const real = connectTestSecret();
    assert.equal(strongSecret(real.slice(0, 45)), false, "42 characters after ns_"); // B01
    assert.equal(strongSecret(`${real.slice(0, 20)}+${real.slice(21)}`), false, "a + in it"); // B02
    assert.equal(strongSecret(`${real} x`), false, "text after it"); // B03
    assert.equal(strongSecret(`${real.slice(3)}xyz`), false, "no ns_"); // B04
    assert.equal(strongSecret(`ns_${"ABCDEFGHIJKLMNO".repeat(3)}`), false, "15 different"); // B05, B06
    assert.equal(strongSecret(`ns_${"ABCDEFGHIJKLMNOP".repeat(3)}`), true, "16 different");
  });
  it("the opt-in: a mixed origins list throws; localhost.evil.test is not local", async () => {
    const o = { clientId: "ng_00000000000000000001", secret: "dev", localDevSecret: true, site: "http://127.0.0.1:9", once: createMemoryOnce(), signIn: async () => "", log: () => undefined };
    assert.throws(() => createConnect({ ...o, origins: ["http://localhost:5173", "https://game.test"] }), ConnectSetupError); // B10
    assert.equal((await createConnect(o).start(new Request("http://localhost.evil.test/nanoterra/start"))).status, 500); // B12
  });
  it("Node: the time bound is for the whole body, not for each chunk; the default is 10 seconds", { timeout: 5_000 }, async () => {
    let n = 0;
    const drip = { method: "POST", url: "/nanoterra/confirm", headers: {}, [Symbol.asyncIterator]: () => ({ next: () => new Promise((ok) => setTimeout(() => ok(n++ < 1000 ? { done: false, value: new Uint8Array([98]) } : { done: true, value: undefined }), 20)), return: async () => ({ done: true, value: undefined }) }) };
    const t0 = Date.now();
    await webRequest(drip, "https://game.test", 100);
    assert.ok(Date.now() - t0 < 400, `${Date.now() - t0} ms`); // B17
    assert.equal(BODY_MS, 10_000); // B18
  });
});
