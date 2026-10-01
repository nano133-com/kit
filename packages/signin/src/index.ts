import { randomBytes, randomInt, timingSafeEqual, createHash } from "node:crypto";
import { CLOCK_SLACK_MS, checkPayment, inWindow, type BlockInfo } from "@nano133/checkout";
import type { CheckResult, Rpc, SigninConfig, SigninSession, SigninStore } from "./types.js";

export * from "./types.js";
export { signinMessage } from "./message.js";

// Sign in with Nano, by payment.
//
// The visitor sends a tiny, unique amount (by default 0.00000133nnnn XNO) from
// any wallet to the site's sign-in address. When it confirms, the browser that
// started the sign-in is signed in as the sending account. The amount can go
// straight back (use @nano133/late-returns: record a return for it).
//
// Rules (from nano133.com):
// - an amount names one sign-in at a time; it stays reserved until the
//   sign-in's grace plus a margin are over;
// - a sign-in only takes a payment the node first saw after it began (within
//   `earlyMs`), and never one that was already waiting when it began;
// - it stops taking payments when its grace is over;
// - taking a payment and marking the sign-in done is one atomic step, which
//   also checks that the sign-in was still waiting; one payment signs in once;
// - only the browser that started it gets the session, and only for
//   `deliverMs` after it signed in;
// - the node is your own; when it doesn't answer, check() throws (fail closed).

export type SigninOptions = { rpc: Rpc; store: SigninStore; config: SigninConfig; now?: () => number; pick?: () => number };

const defaults = (c: SigninConfig) => ({
  address: c.address,
  base: c.base ?? 133n * 10n ** 22n,
  step: c.step ?? 10n ** 18n,
  slots: c.slots ?? 9_999,
  ttlMs: c.ttlMs ?? 15 * 60_000,
  graceMs: c.graceMs ?? 2 * 60_000,
  reuseMarginMs: c.reuseMarginMs ?? 3 * 60_000,
  earlyMs: c.earlyMs ?? 10_000,
  deliverMs: c.deliverMs ?? 10 * 60_000,
});

/** How many waiting payments a search reads. Receive kept amounts now and then, so new ones stay inside it. */
const RECEIVABLE_COUNT = 1000;

/**
 * Throws when the amounts could reach the next "round" amount: every slot
 * must stay below the base's last digit's next value (base 133 × 10^22 and
 * 9,999 × 10^18 stay below 134 × 10^22), so a normal payment of a round
 * amount never matches a slot.
 */
export function checkConfig(config: SigninConfig) {
  const c = defaults(config);
  if (!/^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/.test(c.address)) throw new Error("the sign-in address isn't a nano_ address");
  if (c.base <= 0n || c.step <= 0n || !Number.isInteger(c.slots) || c.slots < 1) throw new Error("base, step and slots must be positive");
  const zeros = (c.base.toString().match(/0*$/)?.[0].length ?? 0);
  const unit = 10n ** BigInt(zeros);
  if (c.step * BigInt(c.slots) >= unit) throw new Error(`the slots reach the next round amount: ${c.slots} × ${c.step} must stay below ${unit}`);
  if (!(c.ttlMs > 0) || !(c.graceMs > 0) || !(c.deliverMs > 0)) throw new Error("ttlMs, graceMs and deliverMs must be positive");
  if (!(c.reuseMarginMs > CLOCK_SLACK_MS)) throw new Error(`reuseMarginMs must be longer than the clock allowance (${CLOCK_SLACK_MS} ms)`);
  if (!(c.earlyMs >= 0 && c.earlyMs <= 60_000)) throw new Error("earlyMs must be between 0 and 60 seconds");
}

/** Waiting sends of exactly `amount` to `to`. */
async function waitingSends(o: SigninOptions, to: string, amount: string) {
  const r = await o.rpc<{ blocks: Record<string, { amount: string }> | "" }>({ action: "receivable", account: to, count: String(RECEIVABLE_COUNT), source: "true", threshold: amount });
  return Object.entries(r.blocks || {})
    .filter(([, v]) => v.amount === amount)
    .map(([h]) => h.toUpperCase());
}

const notFound = (e: unknown) => /not found/i.test(String((e as Error)?.message ?? e));
const blockInfo = (o: SigninOptions, hash: string) =>
  o.rpc<BlockInfo>({ action: "block_info", hash, json_block: "true" }).catch((e) => (notFound(e) ? null : Promise.reject(e)));

/** Whether the node first saw the block after the sign-in began (within earlyMs). */
const seenAfterStart = (info: BlockInfo, s: SigninSession, earlyMs: number) => Number(info.local_timestamp ?? 0) * 1000 >= s.startedAt - earlyMs;

const digest = (v: string) => createHash("sha256").update(v).digest();
const sameStarter = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** Starts a sign-in for this browser (`starter`: a hash of your own cookie). Throws when no amount is free. */
export async function startSignin(o: SigninOptions, p: { starter: string }) {
  const c = defaults(o.config);
  checkConfig(o.config);
  const now = o.now?.() ?? Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    const slot = o.pick?.() ?? randomInt(1, c.slots + 1);
    const amount = (c.base + BigInt(slot) * c.step).toString();
    const session: SigninSession = {
      id: randomBytes(12).toString("hex"),
      amount,
      address: c.address,
      status: "waiting",
      starter: p.starter,
      startedAt: now,
      expiresAt: now + c.ttlMs,
      graceMs: c.graceMs,
      before: (await waitingSends(o, c.address, amount)).slice(0, 100),
    };
    if (await o.store.create(session, session.expiresAt + c.graceMs + c.reuseMarginMs)) return session;
  }
  throw Object.assign(new Error("busy, try again"), { status: 503 });
}

/**
 * Checks a sign-in. `hash`: a block the browser saw, or null to search.
 * `starter`: this browser's hash, to tell whether the sign-in is its own.
 */
export async function checkSignin(o: SigninOptions, id: string, hash: string | null, p: { starter: string }): Promise<CheckResult> {
  const c = defaults(o.config);
  const now = o.now?.() ?? Date.now();
  const s = await o.store.get(id);
  if (!s) return { state: "unknown" };
  const mine = (done: SigninSession) => sameStarter(done.starter, p.starter) && now - (done.signedInAt ?? now) <= c.deliverMs;
  if (s.status === "signedin") return { state: "signedin", account: s.account!, hash: s.hash!, again: true, mine: mine(s) };
  // Past its grace a sign-in is over: its amount may already belong to a newer one.
  if (now > s.expiresAt + s.graceMs) return { state: "expired" };
  const window = { from: s.startedAt, until: s.expiresAt + s.graceMs };
  const before = new Set((s.before ?? []).map((h) => h.toUpperCase()));
  const notYet = { state: now > s.expiresAt ? "expired" : "waiting" } as const;
  let named = hash;
  if (named && before.has(named.toUpperCase())) return notYet;
  if (!named) {
    for (const h of await waitingSends(o, s.address, s.amount)) {
      if (before.has(h)) continue;
      const info = await blockInfo(o, h);
      if (info && inWindow(info, window) && seenAfterStart(info, s, c.earlyMs)) {
        named = h;
        break;
      }
    }
    if (!named) return notYet;
  }
  const check = await checkPayment(o.rpc, { hash: named, to: s.address, amount: s.amount, window });
  if (check.state === "invalid" || check.state === "wrong") return { state: check.state };
  if ((check.state === "paid" || check.state === "unconfirmed") && !seenAfterStart(check.info, s, c.earlyMs)) return notYet;
  if (check.state === "unconfirmed") return { state: "pending" };
  if (check.state !== "paid") return notYet;
  const account = check.info.block_account;
  const r = await o.store.claim(s.id, check.hash, account, now, s.amount);
  if (r === "used") return { state: "used" };
  const done = (await o.store.get(s.id))!;
  if (done.status !== "signedin") return { state: "waiting" };
  return { state: "signedin", account: done.account!, hash: done.hash!, again: r === "taken", mine: mine(done) };
}
