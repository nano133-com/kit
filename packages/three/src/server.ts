import { createHash, randomBytes, randomUUID } from "node:crypto";
import { serverTime } from "./config.js";
import { play } from "./rules.js";
import type { CheckResult, PrizeLimits, PrizeResult, PrizeSender, Round, RoundStore, SignedSend, TrustedPlayer } from "./types.js";

export type * from "./types.js";

const knownId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const usageKeys = (day: string, player: string) => [day, `${day}-${createHash("sha256").update(player).digest("hex")}`] as const;

/** Call only on the server. `player` and an optional seed must come from trusted server code. */
export async function startRound(store: RoundStore, input: { rulesVersion: string; player: TrustedPlayer; seed?: string }) {
  if (!store.rules(input.rulesVersion)) throw new Error("rules version is not available");
  if (!text(input.player?.id, 256) || !text(input.player?.payee, 128)) throw new Error("a trusted player and payee are required");
  const seed = input.seed ?? randomBytes(32).toString("hex");
  if (typeof seed !== "string" || seed.length > 1024) throw new Error("invalid server seed");
  const round: Round = {
    id: randomUUID(), rulesVersion: input.rulesVersion, seed,
    startedAt: serverTime(store.now()), player: { id: input.player.id, payee: input.player.payee }, status: "open",
  };
  await store.transaction(async (tx) => { tx.createRound(round); });
  return { roundId: round.id, rulesVersion: round.rulesVersion, seed };
}

/** `now` is server time in milliseconds, never a value from the browser. A too-soon round stays open. */
export async function checkRound(store: RoundStore, input: { roundId: string; inputs: unknown; now?: number }): Promise<CheckResult> {
  if (!knownId(input.roundId)) return { state: "unknown" };
  const now = serverTime(input.now ?? store.now());
  // A request cannot change its inputs between transaction retries.
  const inputs = Array.isArray(input.inputs) && input.inputs.length <= 1_000_000 ? input.inputs.slice() : null;
  return store.transaction(async (tx) => {
    const round = await tx.getRound(input.roundId);
    if (!round) return { state: "unknown" };
    if (round.status !== "open") return { state: "used" };
    const rules = store.rules(round.rulesVersion);
    if (!rules) return { state: "rules-unavailable" };
    const replay = play(rules, round.seed, inputs);
    const waitMs = Math.ceil(round.startedAt + replay.durationMs - now);
    if (replay.valid && waitMs > 0) return { state: "soon", waitMs };
    tx.setRound({
      ...round, checkedAt: now, replay, status: replay.won ? "checked" : "closed",
      ...(!replay.won ? { noPrize: replay.valid ? "lost" : "invalid" } as const : {}),
    });
    return { state: "checked", replay };
  });
}

function validatePrize(amountRaw: bigint | string, limits: PrizeLimits): string {
  if ((typeof amountRaw !== "bigint" && typeof amountRaw !== "string") || !/^[1-9][0-9]{0,38}$/.test(String(amountRaw))) throw new Error("amountRaw must be positive whole raw");
  if (BigInt(amountRaw) > (1n << 128n) - 1n) throw new Error("amountRaw exceeds the Nano balance range");
  for (const count of [limits.perPlayerPerDay, limits.totalPerDay]) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("prize limits must be nonnegative whole counts");
  }
  return String(amountRaw);
}

function savedSend(send: SignedSend): SignedSend {
  if (!send || !/^[0-9a-f]{64}$/i.test(send.hash) || send.block?.type !== "state") throw new Error("sender did not return a signed state block");
  const fields = ["account", "previous", "representative", "balance", "link", "signature", "work"] as const;
  if (fields.some((field) => typeof send.block[field] !== "string" || !send.block[field].length)) throw new Error("sender returned an incomplete signed block");
  // Keep only public block fields. Never persist caller metadata or signer internals.
  const b = send.block;
  return { hash: send.hash.toUpperCase(), block: { type: "state", account: b.account, previous: b.previous, representative: b.representative, balance: b.balance, link: b.link, signature: b.signature, work: b.work } };
}

/** Pay a checked win. The payee must match the trusted address saved when the server started the round. */
export async function payPrize(store: RoundStore, sender: PrizeSender, input: { roundId: string; payee: string; amountRaw: bigint | string; limits: PrizeLimits }): Promise<PrizeResult> {
  if (!knownId(input.roundId)) return { state: "unknown" };
  const amountRaw = validatePrize(input.amountRaw, input.limits);
  const limits = { ...input.limits };
  const now = serverTime(store.now());
  const day = new Date(now).toISOString().slice(0, 10);
  type Prepared = { state: "prepare"; round: Round } | { state: "publish"; send: SignedSend; again: boolean };
  const prepared = await store.transaction<Prepared | PrizeResult>(async (tx) => {
    const round = await tx.getRound(input.roundId);
    if (!round) return { state: "unknown" };
    if (round.player.payee !== input.payee) throw new Error("payee does not match the round's trusted player");
    if (round.status === "open") return { state: "unchecked" };
    if (round.prize && round.prize.amountRaw !== amountRaw) throw new Error("a reserved prize amount cannot change");
    if (round.send) return { state: "publish", send: round.send, again: true };
    if (round.noPrize) return { state: "no-prize", won: round.replay?.won === true, reason: round.noPrize };
    if (round.status === "signing") return { state: "pending", won: true, reason: "signing" };
    if (round.status !== "checked" || !round.replay?.won) throw new Error("round is not a checked win");
    const [totalKey, playerKey] = usageKeys(day, round.player.id);
    const [total, player, active] = await Promise.all([tx.getUsage(totalKey), tx.getUsage(playerKey), tx.getActivePrize()]);
    const reason = player >= limits.perPlayerPerDay ? "player-limit" : total >= limits.totalPerDay ? "day-limit" : null;
    if (reason) {
      tx.setRound({ ...round, status: "closed", noPrize: reason });
      return { state: "no-prize", won: true, reason };
    }
    if (active !== null) return { state: "pending", won: true, reason: "wallet-busy" };
    const reserved: Round = { ...round, status: "signing", prize: { day, amountRaw } };
    tx.setUsage(totalKey, total + 1);
    tx.setUsage(playerKey, player + 1);
    tx.setActivePrize(round.id);
    tx.setRound(reserved);
    return { state: "prepare", round: reserved };
  });
  if (prepared.state !== "prepare" && prepared.state !== "publish") return prepared;

  let send: SignedSend;
  let again = true;
  if (prepared.state === "prepare") {
    // Never put this call in a retried database callback. A failed or interrupted call stays reserved.
    const signed = await sender.sign({ roundId: prepared.round.id, payee: prepared.round.player.payee, amountRaw });
    const block = signed === null ? null : savedSend(signed);
    await store.transaction(async (tx) => {
      const round = await tx.getRound(prepared.round.id);
      const active = await tx.getActivePrize();
      if (!round || round.status !== "signing" || active !== round.id) throw new Error("prize reservation is not held");
      if (block === null) {
        const [totalKey, playerKey] = usageKeys(round.prize!.day, round.player.id);
        const [total, player] = await Promise.all([tx.getUsage(totalKey), tx.getUsage(playerKey)]);
        tx.setUsage(totalKey, total - 1);
        tx.setUsage(playerKey, player - 1);
        tx.setActivePrize(null);
        tx.setRound({ ...round, status: "closed", noPrize: "empty" });
      } else {
        // The same transaction closes the round and saves its signed send, before any publication.
        tx.setRound({ ...round, status: "closed", send: block });
      }
    });
    if (block === null) return { state: "no-prize", won: true, reason: "empty" };
    send = block;
    again = false;
  } else {
    send = prepared.send;
  }
  await sender.publish(structuredClone(send));
  await store.transaction(async (tx) => {
    const round = await tx.getRound(input.roundId);
    const active = await tx.getActivePrize();
    if (!round?.send || round.send.hash !== send.hash) throw new Error("saved prize send is missing");
    tx.setRound({ ...round, status: "paid" });
    if (active === round.id) tx.setActivePrize(null);
  });
  return { state: "paid", won: true, hash: send.hash, again };
}
