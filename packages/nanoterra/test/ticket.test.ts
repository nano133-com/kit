// The ticket reader: one ticket pinned byte for byte (nano133.com's own test pins the same one), what it refuses, and how the page's
// address is handled. No network: the key list and the page's location are stand-ins.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { baseRecord, packRecord, unpackRecord } from "../src/character/pure.js";
import { forgetKeys, fetchKeys, hashWithoutTicket, readTicket, ticketFromHash, verifyTicket, type Keys } from "../src/ticket/index.js";

// Made by nano133.com's signer (app/nanoterra/signin/ticket.ts) from the seed 32 x 0x07 at 1,800,000,000 s.
const PINNED = {
  kid: "fe812c12f3ab4ce6",
  x: "6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw",
  token:
    "eyJ2IjoxLCJ0eXAiOiJ0aWNrZXQiLCJpc3MiOiJuYW5vMTMzLmNvbSIsImtpZCI6ImZlODEyYzEyZjNhYjRjZTYiLCJhdWQiOiJodHRwczovL2dhbWUuZXhhbXBsZSIsImdhbWUiOiJnZW0taXNsYW5kIiwic3ViIjoibmFub18zaTdtc3djbXpmcWk2czNkZ21jZ2VxdWczZmV1bWVmZzcxeGdkaDFiZXkzZm1uM2RrNzFjN2Zlemh1N3QiLCJuYW1lIjoiQW5uIiwibG9vayI6eyJza2luIjoiI2YyYzI5YiIsImhhaXIiOiIjM2EyYTFlIiwic2hpcnQiOiIjMmE5ZGY0IiwicGFudHMiOiIjMWUyYTRhIiwic2hvZXMiOiIjZmZmZmZmIn0sIml0ZW1zIjpbImh1Yi5zdW4taGF0Il0sImlhdCI6MTgwMDAwMDAwMCwiZXhwIjoxODAwMDAwMTIwLCJqdGkiOiJBQUFBQUFBQUFBQUFBQUFBIn0.lvG9nDtl9w1CfScuUxaCNawX6-OI2DyvZvZnETg92TXI1lY816yLBeKF2nhU3N_CTAPXtqBDkMrxIGG-bZT2Cw",
};
const NOW = 1_800_000_000_000;
const AUD = "https://game.example";
const ADDRESS = "nano_3i7mswcmzfqi6s3dgmcgequg3feumefg71xgdh1bey3fmn3dk71c7fezhu7t";
const LOOK = { skin: "#f2c29b", hair: "#3a2a1e", shirt: "#2a9df4", pants: "#1e2a4a", shoes: "#ffffff" };
const KEYS: Keys = { keys: [{ kid: PINNED.kid, x: PINNED.x, kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig" }] };

// A signer for tickets that are right except for one thing. The same seed as the pinned ticket.
const b64url = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");
async function signer() {
  const seed = new Uint8Array(32).fill(7);
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...seed]);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  return async (claims: Record<string, unknown>) => {
    const body = b64url(Buffer.from(JSON.stringify(claims)));
    return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign("Ed25519", key, Buffer.from(body))))}`;
  };
}
const good = { v: 1, typ: "ticket", iss: "nano133.com", kid: PINNED.kid, aud: AUD, game: "gem-island", sub: ADDRESS, name: "Ann", look: LOOK, items: ["hub.sun-hat"], iat: 1_800_000_000, exp: 1_800_000_120, jti: "AAAAAAAAAAAAAAAA" };
const sign = await signer();
const check = (token: string, over: { audience?: string; now?: number; keys?: Keys } = {}) => verifyTicket(token, { audience: AUD, keys: KEYS, now: NOW, ...over });
const reason = async (token: string, over?: Parameters<typeof check>[1]) => {
  const r = await check(token, over);
  return r.ok ? "ok" : r.reason;
};

describe("verifyTicket", () => {
  it("accepts the pinned ticket and says what it holds", async () => {
    assert.equal(await sign(good), PINNED.token, "the test's signer makes the pinned bytes");
    const r = await check(PINNED.token);
    assert.deepEqual(r, { ok: true, ticket: { username: "Ann", address: ADDRESS, look: LOOK, items: ["hub.sun-hat"], game: "gem-island", audience: AUD, issuedAt: 1_800_000_000_000, expiresAt: 1_800_000_120_000, id: "AAAAAAAAAAAAAAAA" } });
  });

  it("refuses another origin, in every spelling", async () => {
    for (const audience of ["https://other.example", "http://game.example", "https://game.example:8443", "https://game.example/", "https://sub.game.example", ""]) {
      assert.equal(await reason(PINNED.token, { audience }), "audience", audience);
    }
  });

  it("allows a minute of a wrong clock, either way, and no more", async () => {
    assert.equal(await reason(PINNED.token, { now: NOW + 119_000 }), "ok");
    assert.equal(await reason(PINNED.token, { now: NOW + 179_000 }), "ok");
    assert.equal(await reason(PINNED.token, { now: NOW + 181_000 }), "expired");
    assert.equal(await reason(PINNED.token, { now: NOW - 59_000 }), "ok");
    assert.equal(await reason(PINNED.token, { now: NOW - 61_000 }), "early");
  });

  it("refuses a changed ticket, a ticket of an unknown key and text that is not a ticket", async () => {
    const [body, sig] = PINNED.token.split(".") as [string, string];
    const flip = (s: string) => `${s.slice(0, -2)}${s.endsWith("AA") ? "BB" : "AA"}`;
    const renamed = b64url(Buffer.from(JSON.stringify({ ...good, name: "Bob" })));
    assert.equal(await reason(`${renamed}.${sig}`), "signature", "a claim changed, the old signature kept");
    assert.equal(await reason(`${flip(body)}.${sig}`), "malformed", "the end of the body cut off");
    assert.equal(await reason(`${body}.${flip(sig)}`), "signature");
    assert.equal(await reason(PINNED.token, { keys: { keys: [] } }), "unknown-key");
    assert.equal(await reason(PINNED.token, { keys: { keys: [{ kid: PINNED.kid, x: "B".repeat(43) }] } }), "signature", "the right id with another key");
    for (const t of ["", "x", "a.b.c", "!!!.???", `${body}.`, `.${sig}`, `${body}.${"A".repeat(5000)}`, `${b64url(Buffer.from("not json"))}.${sig}`, `${b64url(Buffer.from("[]"))}.${sig}`]) {
      assert.equal(await reason(t), "malformed", t.slice(0, 20));
    }
  });

  it("refuses a ticket that is signed right but is not one as it is made", async () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["another kind", { typ: "access" }, "wrong-kind"],
      ["another issuer", { iss: "evil.example" }, "wrong-kind"],
      ["version 2", { v: 2 }, "wrong-kind"],
      ["a life of an hour", { exp: good.iat + 3600 }, "life"],
      ["no time", { exp: "soon" }, "malformed"],
      ["a bad address", { sub: "nano_notanaddress" }, "malformed"],
      ["no name", { name: "" }, "malformed"],
      ["a name over 60", { name: "x".repeat(61) }, "malformed"],
      ["a colour that is not hex", { look: { ...LOOK, shirt: "red" } }, "malformed"],
      ["a missing look part", { look: { skin: LOOK.skin } }, "malformed"],
      ["items that are not text", { items: [5] }, "malformed"],
      ["65 items", { items: Array.from({ length: 65 }, (_, i) => `i.${i}`) }, "malformed"],
      ["no id", { jti: undefined }, "malformed"],
    ];
    for (const [name, over, want] of cases) assert.equal(await reason(await sign({ ...good, ...over })), want, name);
  });

  it("says unsupported when the browser has no Ed25519, and never throws", async () => {
    const noEd = { importKey: async () => { throw Object.assign(new Error("no"), { name: "NotSupportedError" }); } } as unknown as SubtleCrypto;
    assert.equal(await reason(PINNED.token, { subtle: noEd } as never), "unsupported");
    assert.equal(await verifyTicket(5 as unknown as string, { audience: AUD, keys: KEYS }).then((r) => (r.ok ? "ok" : r.reason)), "malformed");
  });
});

describe("the address", () => {
  it("finds the ticket in a fragment and takes it out, leaving the other parts", () => {
    assert.equal(ticketFromHash(`#nanoterra=${PINNED.token}`), PINNED.token);
    assert.equal(ticketFromHash(`#route=/play&nanoterra=${PINNED.token}&x=1`), PINNED.token);
    assert.equal(hashWithoutTicket(`#nanoterra=${PINNED.token}`), "");
    assert.equal(hashWithoutTicket(`#route=/play&nanoterra=${PINNED.token}&x=1`), "#route=/play&x=1");
    assert.equal(hashWithoutTicket("#route=/play"), "#route=/play");
    assert.equal(ticketFromHash(""), null);
    assert.equal(ticketFromHash("#nanoterra="), null);
    assert.equal(ticketFromHash("#nanoterra=a b"), null);
    assert.equal(ticketFromHash(`#nanoterra=${"A".repeat(5000)}.B`), null);
    assert.equal(ticketFromHash("#xnanoterra=a.b"), null);
  });
});

describe("readTicket", () => {
  beforeEach(() => forgetKeys());
  const page = (hash: string) => {
    const calls: string[] = [];
    return {
      calls,
      location: { hash, pathname: "/play/", search: "?lang=en", origin: AUD },
      history: { state: { s: 1 }, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => void calls.push(String(url)) } as Pick<History, "replaceState" | "state">,
    };
  };
  const keysFetch = (calls: string[], keys: Keys = KEYS, status = 200) =>
    (async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify(keys), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

  it("takes the ticket out of the address first, reads the keys once and answers", async () => {
    const p = page(`#nanoterra=${PINNED.token}`);
    const fetched: string[] = [];
    const r = await readTicket({ ...p, fetch: keysFetch(fetched), now: NOW });
    assert.equal(r.ok, true);
    assert.deepEqual(p.calls, ["/play/?lang=en"], "the address without the ticket, the path and query kept");
    assert.deepEqual(fetched, ["https://nano133.com/api/nanoterra/keys"]);
    // The next page load in the same session reuses the keys.
    await readTicket({ ...page(`#nanoterra=${PINNED.token}`), fetch: keysFetch(fetched), now: NOW });
    assert.equal(fetched.length, 1);
  });

  it("keeps the other fragment parts in the address", async () => {
    const p = page(`#route=/play&nanoterra=${PINNED.token}`);
    await readTicket({ ...p, keys: KEYS, now: NOW });
    assert.deepEqual(p.calls, ["/play/?lang=en#route=/play"]);
  });

  it("a plain visit asks for nothing and changes nothing", async () => {
    const p = page("#route=/play");
    const fetched: string[] = [];
    assert.deepEqual(await readTicket({ ...p, fetch: keysFetch(fetched) }), { ok: false, reason: "none" });
    assert.deepEqual(p.calls, []);
    assert.deepEqual(fetched, []);
    assert.deepEqual(await readTicket({ ...page(""), fetch: keysFetch(fetched) }), { ok: false, reason: "none" });
  });

  it("takes a ticket out of the address even when it is not a good one", async () => {
    const p = page("#nanoterra=short");
    assert.deepEqual(await readTicket({ ...p, keys: KEYS }), { ok: false, reason: "malformed" });
    assert.deepEqual(p.calls, ["/play/?lang=en"]);
    const q = page(`#nanoterra=${PINNED.token}`);
    assert.deepEqual(await readTicket({ ...q, keys: KEYS, audience: "https://other.example", now: NOW }), { ok: false, reason: "audience" });
    assert.deepEqual(q.calls, ["/play/?lang=en"]);
  });

  it("answers keys when the list cannot be read, and reads it again for a key it does not know", async () => {
    assert.deepEqual(await readTicket({ ...page(`#nanoterra=${PINNED.token}`), fetch: keysFetch([], KEYS, 503), now: NOW }), { ok: false, reason: "keys" });
    forgetKeys();
    const throws = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    assert.deepEqual(await readTicket({ ...page(`#nanoterra=${PINNED.token}`), fetch: throws, now: NOW }), { ok: false, reason: "keys" });
    forgetKeys();
    // The first list is old (another key); the second has the right one.
    const seen: string[] = [];
    let n = 0;
    const rotating = (async (url: string) => {
      seen.push(String(url));
      return new Response(JSON.stringify(n++ === 0 ? { keys: [{ kid: "0000000000000000", x: PINNED.x }] } : KEYS), { status: 200 });
    }) as unknown as typeof fetch;
    assert.equal((await readTicket({ ...page(`#nanoterra=${PINNED.token}`), fetch: rotating, now: NOW })).ok, true);
    assert.equal(seen.length, 2);
    forgetKeys();
    // A key list that is pinned is never fetched, and an unknown key is not asked for again.
    const none: string[] = [];
    assert.deepEqual(await readTicket({ ...page(`#nanoterra=${PINNED.token}`), keys: { keys: [] }, fetch: keysFetch(none), now: NOW }), { ok: false, reason: "unknown-key" });
    assert.deepEqual(none, []);
  });

  it("fetchKeys gives up after its time limit, and readTicket then answers keys (a slow nano133.com never holds the page)", async () => {
    const hangs = ((_u: string, i: RequestInit) => new Promise((_res, rej) => i.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const t0 = Date.now();
    await assert.rejects(fetchKeys(undefined, hangs, "default", 40));
    assert.ok(Date.now() - t0 < 1000);
    forgetKeys();
    assert.deepEqual(await readTicket({ ...page(`#nanoterra=${PINNED.token}`), fetch: hangs, keysTimeoutMs: 40, now: NOW }), { ok: false, reason: "keys" });
  });

  it("a ticket gives a clean look: the five colours and nothing else", async () => {
    const r = await check(await sign({ ...good, look: { ...LOOK, evil: "#000000", constructor: "x" } }));
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(Object.keys(r.ticket.look).sort(), ["hair", "pants", "shirt", "shoes", "skin"]);
  });

  it("fetchKeys keeps only well-formed keys and sends no cookie", async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i: RequestInit) => {
      init = i;
      return new Response(JSON.stringify({ keys: [{ kid: "a", x: "b" }, { kid: 5 }, null, "x"] }), { status: 200 });
    }) as unknown as typeof fetch;
    assert.deepEqual(await fetchKeys(undefined, f), { keys: [{ kid: "a", x: "b" }] });
    assert.equal(init?.credentials, "omit");
    await assert.rejects(fetchKeys(undefined, (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch));
  });
});

describe("the character's record in a ticket", () => {
  const bee = baseRecord("bee");
  const claim = (r: ReturnType<typeof baseRecord>) => ({ v: 2, k: packRecord(r) });

  it("a ticket that carries a record answers with it, and every other field as before", async () => {
    const withRecord = await check(await sign({ ...good, record: claim(bee) }));
    const without = await check(PINNED.token);
    assert.ok(withRecord.ok && without.ok);
    if (!withRecord.ok || !without.ok) return;
    assert.deepEqual(withRecord.ticket.record, bee);
    const { record, ...rest } = withRecord.ticket;
    assert.ok(record);
    assert.deepEqual(rest, without.ticket, "the same ticket but for the record");
    assert.deepEqual(withRecord.ticket.look, LOOK, "the five colours are still there");
  });

  it("every base's record comes back whole", async () => {
    for (const base of ["classic", "round", "critter", "bee", "robot", "pineapple"] as const) {
      const r = await check(await sign({ ...good, record: claim(baseRecord(base)) }));
      assert.ok(r.ok);
      if (r.ok) assert.deepEqual(r.ticket.record, unpackRecord(...packRecord(baseRecord(base))));
    }
  });

  it("a ticket with no record reads exactly as it did: the field is not there at all", async () => {
    const r = await check(PINNED.token);
    assert.ok(r.ok);
    if (r.ok) assert.equal("record" in r.ticket, false);
  });

  it("a record that is not two whole numbers on the closed lists is left out; the ticket is still good", async () => {
    const [a, b] = packRecord(bee);
    const bad: unknown[] = [null, 7, "x", {}, { v: 1, k: [a, b] }, { v: 2 }, { v: 2, k: [a] }, { v: 2, k: [a, b, 0] }, { v: 2, k: [a, 1.5] }, { v: 2, k: [-1, b] }, { v: 2, k: ["1", "2"] }, { v: 2, k: [2 ** 30, b] }, { v: 2, k: [2 ** 28, b] }, { v: 2, k: [a, 2 ** 30] }];
    for (const record of bad) {
      const r = await check(await sign({ ...good, record }));
      assert.ok(r.ok, JSON.stringify(record));
      if (r.ok) assert.equal("record" in r.ticket, false, JSON.stringify(record));
    }
    // A number whose field is off its list: the base has six values in three bits, so 7 is a whole number inside the bit limit and still not a base.
    const offList = (a & ((1 << 25) - 1)) | (7 << 25);
    assert.equal(unpackRecord(offList, b), null, "the lists refuse it");
    const r = await check(await sign({ ...good, record: { v: 2, k: [offList, b] } }));
    assert.ok(r.ok);
    if (r.ok) assert.equal("record" in r.ticket, false);
  });
});
