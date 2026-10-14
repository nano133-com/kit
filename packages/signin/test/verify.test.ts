import assert from "node:assert/strict";
import { test } from "node:test";
import { validAddress, verifyBytes, verifyMessage, verifyText } from "../src/verify.js";
import { account, plusL, publicKeyOf, signBytes, signHexText, signText } from "./keys.js";

const me = account("verify me");
const other = account("verify other");
const text = "example.com: sign in as someone at 1790000000000";
const bytes = new Uint8Array(Buffer.from(text, "utf8"));

test("an address must be whole: its shape and its checksum", () => {
  assert.equal(validAddress(me.address), true);
  const broken = me.address.slice(0, -1) + (me.address.endsWith("1") ? "3" : "1");
  assert.equal(validAddress(broken), false, "another checksum");
  assert.equal(validAddress(me.address.replace("nano_", "xrb_")), false, "the old prefix is not an account here");
  assert.equal(validAddress("ban_" + me.address.slice(5)), false);
  for (const bad of [null, 7, "", "nano_1", me.address.toUpperCase()]) assert.equal(validAddress(bad), false);
});

test("Nautilus-style keys are the library's keys", () => {
  assert.equal(publicKeyOf(me.privateKey), me.publicKey.toUpperCase());
});

test("each check takes its own form only", () => {
  const hexForm = signHexText(me.privateKey, text);
  const textForm = signText(me.privateKey, text);
  const byteForm = signBytes(me.privateKey, bytes);
  assert.equal(verifyMessage(me.address, text, hexForm), true, "a purse's form");
  assert.equal(verifyText(me.address, text, textForm), true, "NanChat's form");
  assert.equal(verifyBytes(me.address, bytes, byteForm), true, "Nautilus's form");
  assert.equal(verifyMessage(me.address, text, textForm), false);
  assert.equal(verifyMessage(me.address, text, byteForm), false);
  assert.equal(verifyText(me.address, text, hexForm), false);
  assert.equal(verifyText(me.address, text, byteForm), false);
  assert.equal(verifyBytes(me.address, bytes, hexForm), false);
  assert.equal(verifyBytes(me.address, bytes, textForm), false);
});

test("another key, another text, a second form (S + L), a bad shape: refused", () => {
  const sig = signHexText(me.privateKey, text);
  assert.equal(verifyMessage(other.address, text, sig), false, "another account");
  assert.equal(verifyMessage(me.address, text + " ", sig), false, "another text");
  assert.equal(verifyMessage(me.address, text, plusL(sig)), false, "the same signature + L");
  assert.equal(verifyText(me.address, text, plusL(signText(me.privateKey, text))), false);
  assert.equal(verifyBytes(me.address, bytes, plusL(signBytes(me.privateKey, bytes))), false);
  for (const bad of ["", "00", "G".repeat(128), sig.slice(2)]) assert.equal(verifyMessage(me.address, text, bad), false);
});

test("a small-order key (the burn address) never verifies", () => {
  const burn = "nano_1111111111111111111111111111111111111111111111111111hifc8npp";
  assert.equal(validAddress(burn), true);
  // R = the identity point, S = 0: the classic forgery for a small-order key.
  const forged = "01" + "00".repeat(31) + "00".repeat(32);
  assert.equal(verifyMessage(burn, text, forged), false);
  assert.equal(verifyText(burn, text, forged), false);
  assert.equal(verifyBytes(burn, bytes, forged), false);
});
