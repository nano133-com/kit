import assert from "node:assert/strict";
import test from "node:test";
import { diffLooks, looksJson, type Look } from "../src/looks/index.js";
import { aiPrompt, centsOf, changeText, ownedIds, shelfStats, soldText } from "../src/admin/panel/shelfData.js";

// The Shelf's numbers and words, as the starter's own test pinned them (test/shelf.test.ts): moving the code into the package must not change one word.

const look = (id: string, priceUsd = 0.25): Look => ({ id, name: id, priceUsd, change: { body: "#336699" } });

const orders = [
  { lookId: "sunset", status: "paid", usd: "0.25" },
  { lookId: "sunset", status: "paid", usd: "0.25" },
  { lookId: "sunset", status: "paid_late", usd: "0.25" },
  { lookId: "royal", status: "paid", usd: "1.10" },
  { lookId: "royal", status: "open", usd: "1.10" },
  { lookId: "royal", status: "expired", usd: "1.10" },
];
const players = [{ looks: [{ id: "sunset" }, { id: "royal" }] }, { looks: [{ id: "sunset" }, { id: "sunset" }] }, { looks: [] }];

test("the Shelf counts paid orders and their dollars, late payments apart, and the players who own a look once each", () => {
  const s = shelfStats(orders, players);
  assert.deepEqual(s.get("sunset"), { owners: 2, paid: 2, paidCents: 50, late: 1 });
  assert.deepEqual(s.get("royal"), { owners: 1, paid: 1, paidCents: 110, late: 0 });
  assert.equal(s.get("none"), undefined);
});

test("the Shelf says what a look has done, in plain words", () => {
  const s = shelfStats(orders, players);
  assert.equal(soldText(s.get("sunset")), "2 sold, $0.50, 2 owners");
  assert.equal(soldText(s.get("royal")), "1 sold, $1.10, 1 owner");
  assert.equal(soldText(undefined), "Not sold yet");
  assert.equal(soldText({ owners: 0, paid: 0, paidCents: 0, late: 1 }), "Not sold yet");
});

test("cents come from a dollar text the way an order stores it; every owned look id is listed once", () => {
  assert.deepEqual(["0.25", "1.10", "0.07", "1", "0.29", "x"].map(centsOf), [25, 110, 7, 100, 29, 0]);
  assert.deepEqual([...ownedIds(players)].sort(), ["royal", "sunset"]);
});

test("the message for an AI assistant holds the new file, the change and the owned ids, and no address, order or secret", () => {
  const before = [look("free", 0), look("a"), look("b")];
  const after = [look("free", 0), { ...look("a"), priceUsd: 0.5 }, look("c")];
  const text = looksJson(after);
  const prompt = aiPrompt(text, diffLooks(before, after), ["a"], before);
  assert.equal(changeText(diffLooks(before, after)), "1 added, 1 changed, 1 removed");
  for (const part of ["The change: 1 added, 1 changed, 1 removed.", 'Added: "c".', 'Removed: "b".', 'Changed: "a".', 'must stay in the file with the same id: "a".', text.trimEnd(), "npm run check"]) assert.ok(prompt.includes(part), part);
  assert.doesNotMatch(prompt, /nano_[13]/);
  assert.doesNotMatch(prompt, /secret|seed|session|cookie/i);
  assert.ok(aiPrompt(text, diffLooks(before, before), [], before).includes("must stay in the file with the same id: none yet."));
});
