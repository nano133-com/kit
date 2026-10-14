import assert from "node:assert/strict";
import { test } from "node:test";
import { isSchemeUser, newUserId, PasskeyError, passkeyFault, prfBuffer, prfInput, seedFromPrf, type PasskeyScheme } from "../src/passkey.js";
import { purseAddress } from "../src/purse.js";

// nano133.com's own scheme, FROZEN since 2026-10-08, and its vectors (the site's tests/purse/passkey-seed-test.mts):
// a person's XNO lies at these addresses. If this test fails, the change is wrong, not the test.
const NANO133: PasskeyScheme = { input: "nano133.com purse v1", salt: "nano133.com", info: "nano133 purse seed v1", versionByte: 1 };
const VECTORS = [
  { prf: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20", seed: "A3D5687C6751378F395095094E54C4C112D4E93BFFF12469EA2D84B0818B33BF", address: "nano_14kjq638aessbe71bp4b958uz8emcqqxctd4sbq1imnp9ckxzmzjgcou4kge" },
  { prf: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", seed: "EF116E1B3453D54D014BBD3191ED299C96099F404ACF0147BA9059F948F8A0FF", address: "nano_3iqo4p53e7xwesq1jpcnrgn9xkp1aigbzbej1auj1snb3gzx8aqiuyehmiqp" },
  { prf: "fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e0", seed: "69A0ECBC22261E1327EDEB33DF1DD6B4C43F598ACD523E1BD7763952484D4B54", address: "nano_1qi6oqbo9jcftxm8h7ghkrfratdzfkqq4tgxkhzyow39jb4pzegaiqdgjmpz" },
  { prf: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", seed: "B2B49E48E84A4AD402EEEF9681F76BD04A368561FC27A56EAAE7B919526546D8", address: "nano_195c1y1ep3k8ou4efm75gog4mro6zxu3y73htd4y7m5rrfjh4btimt6kb9em" },
];
const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

test("nano133.com's frozen vectors: one PRF output, one seed, one address, for ever", async () => {
  assert.equal(new TextDecoder().decode(prfInput(NANO133)), "nano133.com purse v1");
  for (const v of VECTORS) {
    const seed = await seedFromPrf(hex(v.prf), NANO133);
    assert.equal(seed, v.seed);
    assert.equal(purseAddress(seed), v.address);
    assert.equal(await seedFromPrf(Array.from(hex(v.prf)), NANO133), v.seed, "the same bytes as a list give the same seed");
  }
});

test("another site's scheme gives another purse for the same passkey answer", async () => {
  const other: PasskeyScheme = { input: "example.com purse v1", salt: "example.com", info: "example.com purse seed v1", versionByte: 1 };
  assert.notEqual(await seedFromPrf(hex(VECTORS[0]!.prf), other), VECTORS[0]!.seed);
});

test("prfBuffer is strict", () => {
  const ok = hex(VECTORS[0]!.prf);
  assert.ok(prfBuffer(ok));
  assert.ok(prfBuffer(ok.buffer));
  assert.ok(prfBuffer(Array.from(ok)));
  const hole = Array.from(ok) as (number | undefined)[];
  delete hole[3];
  for (const bad of [null, "x".repeat(32), new Uint8Array(31), new Uint8Array(33), new Uint8Array(32), new Uint8Array(32).fill(255), { 0: 1, length: 32 }, hole, [...Array.from(ok).slice(0, 31), 256], [...Array.from(ok).slice(0, 31), 1.5], [...Array.from(ok).slice(0, 31), -0]])
    assert.equal(prfBuffer(bad), null, String(bad).slice(0, 20));
});

test("the version byte names the scheme; a refused answer makes no seed", async () => {
  const id = newUserId(NANO133);
  assert.equal(id.length, 32);
  assert.equal(id[0], 1);
  assert.equal(isSchemeUser(id, NANO133), true);
  assert.equal(isSchemeUser(id, { ...NANO133, versionByte: 2 }), false);
  assert.equal(isSchemeUser(new Uint8Array(16), NANO133), false);
  await assert.rejects(seedFromPrf(new Uint8Array(32), NANO133), (e) => e instanceof PasskeyError && e.code === "no-prf");
});

test("the browser's errors as fault codes", () => {
  assert.equal(passkeyFault({ name: "NotAllowedError" }).code, "cancelled");
  assert.equal(passkeyFault({ name: "AbortError" }).code, "cancelled");
  assert.equal(passkeyFault({ name: "InvalidStateError" }).code, "exists");
  assert.equal(passkeyFault({ name: "SecurityError" }).code, "wrong-host");
  assert.equal(passkeyFault({ name: "NotSupportedError" }).code, "unsupported");
  assert.equal(passkeyFault(new Error("x")).code, "failed");
  assert.equal(passkeyFault(new PasskeyError("unstable")).code, "unstable");
});
