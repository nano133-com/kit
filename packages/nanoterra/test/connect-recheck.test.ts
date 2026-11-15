// Sign in from Nanoterra: the re-check's tests (2026-11-15). localDevSecret never signs the pending cookie with the weak secret (R2), and one
// live origin among the listed ones keeps the __Host- names (R1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectTestAddress, connectTestSecret, tokenAnswer } from "../src/connect/conformance.js";
import { bindOf, createConnect, PENDING_LABEL } from "../src/connect/core.js";
import { createMemoryOnce } from "../src/connect/index.js";

const CLIENT_ID = "ng_00000000000000000001";
const b64 = (v: string | Uint8Array) => Buffer.from(v).toString("base64url");
async function forged(key: string, address: string): Promise<string> {
  const payload = b64(JSON.stringify({ a: address, n: "Victim", l: tokenAnswer(address).character.look, r: null, exp: Date.now() + 60_000, j: "ab".repeat(12) }));
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${PENDING_LABEL}\n${payload}`))))}`;
}

describe("re-check: localDevSecret never signs with the weak secret", () => {
  for (const [name, origins, url, origin] of [
    ["no origins, a request with Host localhost", undefined, "http://localhost/nanoterra/confirm", "http://localhost"],
    ["local origins, a live request with the local Origin", ["http://localhost:3000"], "https://game.example/nanoterra/confirm", "http://localhost:3000"],
  ] as const) {
    it(`a pending cookie signed with the weak secret is refused (${name})`, async () => {
      let calls = 0;
      const c = createConnect({ clientId: CLIENT_ID, secret: "dev", localDevSecret: true, site: "http://127.0.0.1:9", origins, once: createMemoryOnce(), signIn: async () => (calls++, "session=x"), log: () => undefined });
      const token = await forged("dev", connectTestAddress());
      const res = await c.confirm(new Request(url, { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", Cookie: `nanoterra-pending=${token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: `bind=${await bindOf(token)}` }));
      assert.equal(calls, 0);
      assert.equal(res.status, 400);
    });
  }
});

describe("re-check: origins with a local and a live entry", () => {
  it("a local origin first never gives the live game plain cookie names", async () => {
    const c = createConnect({ clientId: CLIENT_ID, secret: connectTestSecret(), origins: ["http://localhost:5173", "https://game.example"], once: createMemoryOnce(), signIn: async () => "" });
    const set = (await c.start(new Request("https://game.example/nanoterra/start"))).headers.getSetCookie()[0];
    assert.match(set, /^__Host-nanoterra-state=[A-Za-z0-9_-]{32}; Path=\/; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/);
  });
});
