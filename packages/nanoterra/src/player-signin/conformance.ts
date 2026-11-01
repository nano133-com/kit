// The conformance suite of the player sign-in's store: a game that writes its own store (another database) runs it, and so proves that its store
// keeps every rule the package's adapters keep. The package runs it on the memory store, D1 (on SQLite) and Firestore (a fake, and the emulator).
//
//   import { playerSigninStoreConformance } from "@nano133/nanoterra/player-signin/conformance";
//   for (const c of playerSigninStoreConformance(async () => ({ store: myStore(), dump: () => allMyRowsAsText() }))) it(c.name, c.run);
//
// Each case gets a NEW, empty store from `make`. The rules: a request is finished once and delivered once, and a delivery writes its session in the
// same step; the ways stay apart; a session lasts until its time; a once-only key counts once; "forget" leaves nothing of the player's.

import type { PlayerSigninStore, SessionRecord, SigninRequest, Way } from "./types.js";

export type PlayerSigninHarness = {
  store: PlayerSigninStore;
  /** Every row the store keeps (requests, sessions, once-only keys) as one text. `forget` must leave none that holds the player's address. */
  dump(): Promise<string>;
};

export type PlayerSigninConformanceCase = { name: string; run: () => Promise<void> };

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

/** An address the suite can find in any text (a store does not check addresses: the handler does). */
const who = (n: string) => `nano_3${n}${"x".repeat(59 - n.length)}`;
const ANN = who("ann");
const BOB = who("bob");
const hex = (n: number, len = 64) => n.toString(16).padStart(len, "0");

let serial = 0;
/** A request as a wallet's start makes it: a fresh id each time. */
function request(at: number, extra: Partial<SigninRequest> = {}): { key: string; r: SigninRequest } {
  serial += 1;
  const id = hex(Date.now() * 1000 + serial, 32).slice(-32);
  return { key: id, r: { id, starter: hex(serial + 7), status: "waiting", expiresAt: at + 5 * 60_000, nonce: hex(serial + 99), issuedAt: at, ...extra } };
}
const session = (address: string, at: number, n: number, via: SessionRecord["via"] = "wallet"): SessionRecord => ({ idHash: hex(1_000_000 + n + serial++), address, createdAt: at, expiresAt: at + 30 * 86_400_000, via });

export function playerSigninStoreConformance(make: () => Promise<PlayerSigninHarness>): PlayerSigninConformanceCase[] {
  const cases: PlayerSigninConformanceCase[] = [];
  const add = (name: string, run: (h: PlayerSigninHarness, now: number) => Promise<void>) => cases.push({ name, run: async () => run(await make(), Date.now()) });

  add("a request reads back as it was made, by its key and by its browser id, and only for its own way", async ({ store }, now) => {
    const { key, r } = request(now, { label: "game.test sign-in ABCD-EFGH" });
    await store.requests("nautilus").create(key, r);
    const back = await store.requests("nautilus").get(key);
    check(back !== null && back.id === r.id && back.starter === r.starter && back.status === "waiting" && back.expiresAt === r.expiresAt && back.label === r.label && back.nonce === r.nonce && back.issuedAt === r.issuedAt && back.account === undefined, `read back: ${JSON.stringify(back)}`);
    const found = await store.requests("nautilus").find(r.id);
    check(found?.key === key && found.request.id === r.id, `find: ${JSON.stringify(found)}`);
    for (const other of ["berry", "nanchat"] as Way[]) {
      check((await store.requests(other).get(key)) === null, `${other} does not see a nautilus request`);
      check((await store.requests(other).find(r.id)) === null, `${other} does not find a nautilus request`);
    }
    check((await store.requests("nautilus").get(hex(12345, 32))) === null, "an unknown key is null");
  });

  add("NanChat's request is kept under the hash of its nonce and found by the browser's id", async ({ store }, now) => {
    const { r } = request(now);
    const key = hex(424242);
    await store.requests("nanchat").create(key, { ...r, id: "AbCdEfGhIjKlMnOpQrStUvWx" });
    check((await store.requests("nanchat").find("AbCdEfGhIjKlMnOpQrStUvWx"))?.key === key, "found by the browser's id");
  });

  add("a second request with the same key is refused", async ({ store }, now) => {
    const { key, r } = request(now);
    await store.requests("berry").create(key, r);
    let threw = false;
    try {
      await store.requests("berry").create(key, { ...r, starter: hex(1) });
    } catch {
      threw = true;
    }
    check(threw, "the second create throws");
    check((await store.requests("berry").get(key))?.starter === r.starter, "the first request is unchanged");
  });

  add("finish signs a waiting request in once, with its account; a second finish, or one on an unknown key, is false", async ({ store }, now) => {
    const { key, r } = request(now);
    await store.requests("berry").create(key, r);
    check(await store.requests("berry").finish(key, ANN), "the first finish");
    check(!(await store.requests("berry").finish(key, BOB)), "a second finish is false");
    const back = await store.requests("berry").get(key);
    check(back?.status === "signedin" && back.account === ANN, `the account stays the first: ${JSON.stringify(back)}`);
    check(!(await store.requests("berry").finish(hex(777, 32), ANN)), "an unknown key");
    check(!(await store.requests("nautilus").finish(key, ANN)), "another way cannot finish it");
  });

  add("two finishes at the same moment: exactly one is true", async ({ store }, now) => {
    const { key, r } = request(now);
    await store.requests("berry").create(key, r);
    const both = await Promise.all([store.requests("berry").finish(key, ANN), store.requests("berry").finish(key, BOB)]);
    check(both.filter(Boolean).length === 1, `results: ${JSON.stringify(both)}`);
  });

  add("deliver: false while waiting; then once, with its session; a second delivery writes no session", async ({ store }, now) => {
    const { key, r } = request(now);
    await store.requests("berry").create(key, r);
    const early = session(ANN, now, 1);
    check(!(await store.deliver("berry", key, early)), "a waiting request is not delivered");
    check((await store.session(early.idHash, now)) === null, "and no session was written");
    await store.requests("berry").finish(key, ANN);
    const s1 = session(ANN, now, 2);
    check(await store.deliver("berry", key, s1), "the first delivery");
    const read = await store.session(s1.idHash, now);
    check(read?.address === ANN && read.via === "wallet" && read.expiresAt === s1.expiresAt && read.createdAt === s1.createdAt, `the session: ${JSON.stringify(read)}`);
    const s2 = session(ANN, now, 3);
    check(!(await store.deliver("berry", key, s2)), "a second delivery is false");
    check((await store.session(s2.idHash, now)) === null, "and wrote no session");
    check(!(await store.deliver("nautilus", key, session(ANN, now, 4))), "another way cannot deliver it");
    check(!(await store.deliver("berry", hex(888, 32), session(ANN, now, 5))), "an unknown key");
  });

  add("two deliveries at the same moment: one is true, and one session is written", async ({ store, dump }, now) => {
    const { key, r } = request(now);
    await store.requests("nautilus").create(key, r);
    await store.requests("nautilus").finish(key, ANN);
    const a = session(ANN, now, 10);
    const b = session(ANN, now, 11);
    const both = await Promise.all([store.deliver("nautilus", key, a), store.deliver("nautilus", key, b)]);
    check(both.filter(Boolean).length === 1, `results: ${JSON.stringify(both)}`);
    const live = [await store.session(a.idHash, now), await store.session(b.idHash, now)].filter(Boolean);
    check(live.length === 1, `sessions written: ${live.length} (${(await dump()).slice(0, 300)})`);
  });

  add("a session reads while it lasts, with its `via`, and not from its end; ending it removes it", async ({ store }, now) => {
    const s = session(BOB, now, 20, "passkey");
    await store.createSession(s);
    const read = await store.session(s.idHash, now);
    check(read?.address === BOB && read.via === "passkey" && read.idHash === s.idHash, `read: ${JSON.stringify(read)}`);
    check((await store.session(s.idHash, s.expiresAt)) === null, "not at its end");
    check((await store.session(s.idHash, s.expiresAt + 1)) === null, "not after it");
    check((await store.session(hex(999), now)) === null, "an unknown id");
    await store.endSession(s.idHash);
    check((await store.session(s.idHash, now)) === null, "ended");
    await store.endSession(s.idHash);
  });

  add("a once-only key counts once; another key counts; two at the same moment: one", async ({ store }, now) => {
    const k = hex(now);
    check(await store.useOnce(k, 600_000, ANN), "the first use");
    check(!(await store.useOnce(k, 600_000, BOB)), "the second use");
    check(await store.useOnce(hex(now + 1), 600_000, ANN), "another key");
    const k2 = hex(now + 2);
    const both = await Promise.all([store.useOnce(k2, 600_000, ANN), store.useOnce(k2, 600_000, ANN)]);
    check(both.filter(Boolean).length === 1, `two at once: ${JSON.stringify(both)}`);
  });

  add("forget leaves nothing of the player's (sessions, signed requests, once-only keys) and every row of another player", async ({ store, dump }, now) => {
    for (const [address, n] of [[ANN, 30], [BOB, 40]] as const) {
      await store.createSession(session(address, now, n, "passkey"));
      const { key, r } = request(now);
      await store.requests("berry").create(key, r);
      await store.requests("berry").finish(key, address);
      await store.deliver("berry", key, session(address, now, n + 1));
      await store.useOnce(hex(now + n), 600_000, address);
    }
    const before = await dump();
    check(before.includes(ANN) && before.includes(BOB), "both players are in the store");
    const gone = await store.forget(ANN);
    check(gone >= 4, `rows that went: ${gone}`);
    const after = await dump();
    check(!after.includes(ANN), `the player is left in the store: ${after.slice(0, 400)}`);
    check(after.split(BOB).length - 1 >= 4, "the other player's rows stay");
    check((await store.forget(ANN)) === 0, "a second forget finds nothing");
  });

  add("clean deletes ended sessions and requests 2 hours after they ended, and keeps the rest", async ({ store }, now) => {
    const ended = { ...session(ANN, now - 40 * 86_400_000, 50), expiresAt: now - 1 };
    const live = session(ANN, now, 51);
    await store.createSession(ended);
    await store.createSession(live);
    const old = request(now - 3 * 3_600_000);
    const fresh = request(now);
    await store.requests("berry").create(old.key, old.r);
    await store.requests("berry").create(fresh.key, fresh.r);
    await store.clean(now);
    check((await store.session(live.idHash, now)) !== null, "the live session stays");
    check((await store.session(ended.idHash, now - 2)) === null, "the ended session went");
    check((await store.requests("berry").get(old.key)) === null, "the old request went");
    check((await store.requests("berry").get(fresh.key)) !== null, "the fresh request stays");
  });

  return cases;
}
