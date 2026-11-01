// The shop's rules with no store: amounts (the game starter's test/amount.test.ts), the price (test/price.test.ts, on the memory store), the reservation's
// steps (test/orders.test.ts), node failover (test/nodes.test.ts), the address checksum, the CSP lists and the QR code. No real network, no real money.
import assert from "node:assert/strict";
import test, { after, before, beforeEach, describe } from "node:test";
import {
  KEYED_NODE,
  MAX_STEPS,
  NodeDown,
  PUBLIC_NODES,
  RATE_FRESH_MS,
  RATE_LAST_GOOD_MS,
  SHOP_CSP,
  EXAMPLE_ADDRESS,
  createMemoryShop,
  forgetNodeHealth,
  isClean,
  isRaw,
  mergeCsp,
  nanoUri,
  nodesFor,
  payeeOf,
  plusSteps,
  priceRaw,
  rawFromSteps,
  readFeeds,
  rpc,
  stepsFor,
  stepsFromUsd,
  usdPerXno,
  validAddress,
  xnoText,
  type Fetch,
} from "../src/shop/index.js";
import { qrModules, qrVersionFor } from "../src/shop/panel/qr.js";
import { MockNode, testAddress, type NodeMode } from "./shop-helpers.js";

const XNO = (s: string) => {
  const [w, f = ""] = s.split(".");
  return (BigInt(w) * 10n ** 30n + BigInt((f + "0".repeat(30)).slice(0, 30))).toString();
};

describe("clean amounts", () => {
  test("rounds the price UP to 0.0001 XNO, never down", () => {
    assert.equal(xnoText(priceRaw(0.25, 1)!), "0.25");
    assert.equal(xnoText(priceRaw(0.25, 0.9)!), "0.2778"); // 0.27777… goes up
    assert.equal(xnoText(priceRaw(1, 3)!), "0.3334"); // 0.3333… goes up
    assert.equal(xnoText(priceRaw(0.01, 0.5)!), "0.02"); // float noise (200.00000000000003 steps) adds no step
    assert.equal(xnoText(priceRaw(0.000001, 1)!), "0.0001"); // the smallest amount is one step
  });

  test("has at most four decimals, so a wallet that shortens amounts still pays it exactly", () => {
    for (const [usd, rate] of [[0.25, 0.8731], [0.5, 1.2345], [1, 0.0712], [9.99, 3.3333], [0.07, 77.7]] as const) {
      const raw = priceRaw(usd, rate)!;
      assert.ok(isClean(raw));
      assert.ok(raw.endsWith("0".repeat(26)));
      assert.ok((xnoText(raw).split(".")[1] ?? "").length <= 4);
      // The creator never gets less than the price.
      assert.ok(Number(xnoText(raw)) * rate >= usd - 1e-12);
    }
  });

  test("refuses a price or a rate it cannot trust", () => {
    for (const [u, r] of [[0, 1], [-1, 1], [20_000, 1], [1, 0.01], [1, 500], [1, Number.NaN]]) assert.equal(stepsFromUsd(u, r), null, `${u} at ${r}`);
  });

  test("adds whole steps of 0.0001 XNO with BigInt, never floats", () => {
    assert.equal(xnoText(plusSteps(XNO("0.25"), 1)), "0.2501");
    assert.equal(xnoText(plusSteps(XNO("1"), 99)), "1.0099");
    assert.throws(() => plusSteps("123", 1)); // not a clean amount
    assert.equal(rawFromSteps(1), "1" + "0".repeat(26));
  });

  test("reads and writes raw amounts strictly", () => {
    assert.equal(isRaw("0"), false);
    assert.equal(isRaw("01"), false);
    assert.equal(isRaw("1".repeat(40)), false);
    assert.equal(isClean(XNO("0.00001")), false);
    assert.equal(xnoText("1"), "0.000000000000000000000000000001");
    assert.equal(nanoUri("nano_abc", "2500000000000000000000000000000"), "nano:nano_abc?amount=2500000000000000000000000000000");
  });

  test("the reservation asks at most a tenth of the price more, and at most 100 amounts", () => {
    assert.equal(stepsFor(priceRaw(0.003, 1)!), 4); // 30 steps: 3 more
    assert.equal(stepsFor(priceRaw(100, 1)!), MAX_STEPS);
    assert.equal(stepsFor(priceRaw(0.0001, 1)!), 1);
  });
});

describe("the price", () => {
  const feeds = [
    { name: "one", url: "https://one.test/", read: (j: any) => j.usd },
    { name: "two", url: "https://two.test/", read: (j: any) => j.usd },
    { name: "three", url: "https://three.test/", read: (j: any) => j.usd },
  ];
  /** A fake fetch: each feed answers this price, or fails when it is null. */
  const answering =
    (prices: Record<string, number | null>): Fetch =>
    async (url) => {
      const p = prices[new URL(url).host.split(".")[0]];
      if (p === null || p === undefined) throw new Error("network down");
      return new Response(JSON.stringify({ usd: p }), { status: 200 });
    };
  const T = 1_800_000_000_000;

  test("is the median, so one wrong feed cannot move it", async () => {
    assert.equal((await readFeeds(answering({ one: 0.9, two: 1.0, three: 75 }), feeds))!.usd, 1.0);
    // Out of the sane range: a broken feed, left out.
    assert.deepEqual((await readFeeds(answering({ one: 0.9, two: 1.1, three: 9999 }), feeds))!.sources, ["one", "two"]);
  });

  test("is kept for 5 minutes", async () => {
    const store = createMemoryShop();
    await usdPerXno(store, answering({ one: 1, two: 1, three: 1 }), T, feeds);
    assert.deepEqual(await usdPerXno(store, answering({ one: 2, two: 2, three: 2 }), T + RATE_FRESH_MS - 1, feeds), { usd: 1, sources: ["one", "two", "three"], at: T, stale: false });
    assert.equal((await usdPerXno(store, answering({ one: 2, two: 2, three: 2 }), T + RATE_FRESH_MS + 1, feeds))!.usd, 2);
  });

  test("uses the last good price when every feed fails, for a limited time, then sells nothing", async () => {
    const store = createMemoryShop();
    await usdPerXno(store, answering({ one: 1.2, two: 1.2, three: 1.2 }), T, feeds);
    const down = answering({ one: null, two: null, three: null });
    assert.deepEqual(await usdPerXno(store, down, T + 60 * 60_000, feeds), { usd: 1.2, sources: ["one", "two", "three"], at: T, stale: true });
    assert.equal(await usdPerXno(store, down, T + RATE_LAST_GOOD_MS + 1, feeds), null);
  });

  test("is null when no feed ever answered", async () => {
    assert.equal(await usdPerXno(createMemoryShop(), answering({ one: null, two: null, three: null }), T, feeds), null);
  });
});

describe("node failover (against mock nodes on 127.0.0.1)", () => {
  const a = new MockNode();
  const b = new MockNode();
  const c = new MockNode();
  before(async () => void (await Promise.all([a.start(), b.start(), c.start()])));
  after(async () => void (await Promise.all([a.stop(), b.stop(), c.stop()])));
  beforeEach(() => {
    forgetNodeHealth();
    for (const n of [a, b, c]) (n.mode = "ok"), (n.calls = []);
  });
  const list = () => [
    { name: "a", url: a.url, headers: { "nodes-api-key": "test-key-not-real" } },
    { name: "b", url: b.url },
    { name: "c", url: c.url },
  ];
  const call = { action: "receivable", account: "nano_x", count: "50", threshold: "1", source: "true" };

  for (const mode of ["down", "http500", "error", "slow", "garbage"] as NodeMode[]) {
    test(`asks the next node when the first one is ${mode}`, async () => {
      a.mode = mode;
      const r = await rpc(list(), call, { timeoutMs: 500 });
      assert.equal(r.node, "b");
      assert.deepEqual(r.answer, { blocks: "" });
    });
  }

  test("goes down the whole list, and throws when no node answers", async () => {
    a.mode = "down";
    b.mode = "http500";
    assert.equal((await rpc(list(), call, { timeoutMs: 500 })).node, "c");
    forgetNodeHealth();
    c.mode = "error";
    await assert.rejects(rpc(list(), call, { timeoutMs: 500 }), NodeDown);
  });

  test('takes "not found" as a real answer (no failover): an account with no history', async () => {
    assert.deepEqual(await rpc(list(), { action: "account_history", account: "nano_x", count: "50", raw: "true" }), { node: "a", answer: null });
    assert.equal(b.calls.length, 0);
  });

  test("asks a node that just failed last, for a while", async () => {
    a.mode = "down";
    await rpc(list(), call, { timeoutMs: 500 });
    a.mode = "ok";
    a.calls = [];
    assert.equal((await rpc(list(), call)).node, "b");
    assert.equal(a.calls.length, 0);
  });

  test("sends the API key only to the keyed node", async () => {
    a.mode = "down";
    await rpc(list(), call, { timeoutMs: 500 });
    assert.equal(a.calls[0].headers["nodes-api-key"], "test-key-not-real");
    assert.equal(b.calls[0].headers["nodes-api-key"], undefined);
  });

  test("the list: the keyed provider first only when its key is given; the game's own list (https, or http on this computer) instead of the public one", () => {
    assert.deepEqual(nodesFor({}), PUBLIC_NODES);
    const withKey = nodesFor({ NODE_API_KEY: " k-from-secret " });
    assert.deepEqual(withKey[0], { name: KEYED_NODE.name, url: KEYED_NODE.url, headers: { [KEYED_NODE.keyHeader]: "k-from-secret" } });
    assert.deepEqual(withKey.slice(1), PUBLIC_NODES);
    assert.ok(PUBLIC_NODES.every((n) => !n.headers));
    for (const v of ["none", "NONE", " ", "", "skip", "off", "-"]) assert.deepEqual(nodesFor({ NODE_API_KEY: v }), PUBLIC_NODES, JSON.stringify(v));
    const own = nodesFor({ NANO_NODES: "https://node.example.com/rpc, http://evil.example.com, http://127.0.0.1:8792, ftp://x" });
    assert.deepEqual(own.map((n) => n.url), ["https://node.example.com/rpc", "http://127.0.0.1:8792"]);
  });
});

describe("the creator's address", () => {
  test("a whole address passes; one changed character, the example, another shape or a wrong prefix does not", () => {
    for (let i = 0; i < 20; i++) {
      const a = testAddress();
      assert.ok(validAddress(a), a);
      assert.equal(payeeOf(` ${a.toUpperCase().replace("NANO_", "xrb_")} `), a, "case, spaces and the old prefix are cleaned");
      const at = 5 + (i % 60);
      const bent = a.slice(0, at) + (a[at] === "1" ? "3" : "1") + a.slice(at + 1);
      assert.equal(validAddress(bent), false, bent);
    }
    // Known addresses: the burn address (all zeros) and the genesis account.
    assert.ok(validAddress(EXAMPLE_ADDRESS));
    assert.ok(validAddress("nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3"));
    assert.equal(payeeOf(EXAMPLE_ADDRESS), null, "the example address keeps test mode");
    for (const bad of [undefined, null, "", "nano_", "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr4", "ban_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3", 42]) assert.equal(payeeOf(bad), null, String(bad));
  });
});

describe("the CSP lists", () => {
  test("merge into the game's own policy: nothing of the game's is lost, nothing is written twice, 'none' goes when a source comes", () => {
    const game = "default-src 'none'; script-src 'self'; frame-src https://nano133.com; style-src 'self'; frame-ancestors 'none'";
    assert.equal(
      mergeCsp(game, SHOP_CSP),
      "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; frame-src https://nano133.com https://challenges.cloudflare.com; style-src 'self'; frame-ancestors 'none'; connect-src 'self'",
    );
    assert.equal(mergeCsp({ "script-src": ["'none'"] }, { "script-src": ["'self'"] }), "script-src 'self'");
    assert.equal(mergeCsp(mergeCsp(game, SHOP_CSP), SHOP_CSP), mergeCsp(game, SHOP_CSP), "merging twice changes nothing");
    assert.throws(() => mergeCsp(game, { "script-src": ["x; img-src *"] }), /not a CSP source/);
  });
});

describe("the QR code", () => {
  // A vector made with qrcode-generator 2.0.4 (the game starter's QR library), mask 2, for the same text: the encoder's bytes, its version information and its placement are the same.
  const TEXT = "nano:nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3?amount=250000000000000000000000000000";
  test("a nano: link with a 30-digit amount is version 7 (with its version information), level M, and the size follows the version", () => {
    assert.equal(qrVersionFor(new TextEncoder().encode(TEXT).length), 7);
    const m = qrModules(TEXT);
    assert.equal(m.length, 7 * 4 + 17);
    assert.ok(m.every((row) => row.length === m.length));
    // The longest link (39 digits) still fits a small code; 214 bytes do not fit at all.
    assert.ok(qrVersionFor(5 + 65 + 8 + 39) <= 7);
    assert.throws(() => qrModules("x".repeat(214)), /longer/);
  });

  test("the finder patterns, the timing lines and the dark module are where the standard puts them", () => {
    const m = qrModules(TEXT);
    const n = m.length;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let i = 0; i < 7; i++) assert.ok(m[r][c + i] && m[r + 6][c + i] && m[r + i][c] && m[r + i][c + 6], "a finder's ring");
      assert.ok(m[r + 3][c + 3] && !m[r + 1][c + 1], "a finder's middle");
    }
    for (let i = 8; i < n - 8; i++) assert.equal(m[6][i], i % 2 === 0, "the timing line");
    assert.ok(m[n - 8][8], "the dark module");
  });

  test("matches the vector of qrcode-generator (mask 2), module for module", () => {
    const rows = qrModules(TEXT, 2).map((row) => row.map((d) => (d ? "1" : "0")).join(""));
    assert.equal(rows.join("\n"), VECTOR.trim());
  });
});

const VECTOR = `
111111100000010011000110000100111100101111111
100000100110000110111011111101001101001000001
101110101111111010100000100011011101001011101
101110101000000010111111110001100101101011101
101110101001010001001111100101100011101011101
100000101100000111001000110100000000001000001
111111101010101010101010101010101010101111111
000000001111010110001000110011001010100000000
101111100011110101001111110100010011001111100
110000010010001100110101110001110000110110001
110110101010100011110100111111010001001111110
011101010000010100000101101100101110110011101
111000111001110001110010100010110000001100011
101010000011000101000011010110100001110101011
110000100110101101111110101011001011101101000
011010010110100000000010100010101011011111100
000010100100110101100100100101010010011000000
011101011110001001000000000000101001110000101
100010110101010110111001111001010110001000110
101001010001001010100000011011011101000010100
010111111110101100111111101000000101111111010
100110001011111111011000111101100101100010111
100010101100100100111010100000000010101011100
111110001000000001101000101011111010100011101
111011111011001000111111100100110010111110010
101001001110101011111011110000111100100100101
010011110111001000101101011111011010000011010
011110010010000110111011111000111001111001100
110101110011110100000000010100100100111010011
001100000010000011101111100000110001101101011
001111111000001011010100111100100010110010000
100111000011100100111101000011111101001011100
011001101010100011111100000101100000011010000
011010001010010011110011000111100001011100111
000010101011001010000101011100010110110100110
011110000100110010100000100010011101001100100
100110111011111100101111110001100100111111001
000000001010111100111000100111100101100011011
111111100011001010111010110110000010101010000
100000101000100110001000110111001100100011100
101110101111001001001111110001110010111110000
101110101011010011010100100010110001001010001
101110101000000001011000111001011010100001010
100000100100010011001100001101001100110010100
111111101010010010110111110010010010111101010
`;
