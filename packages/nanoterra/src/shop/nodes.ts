// Talking to Nano nodes, with failover (the game starter's src/worker/nodes.ts). The shop holds no key and sends nothing: it only READS the ledger, to see
// whether the creator's address received a payment.
//
// The order of the list (`nodesFor`, the starter's defaults):
// 1. Nanswap Nodes, when the game gives its API key (the starter's secret NODE_API_KEY; a free key: https://nanswap.com/nano-node).
// 2. The game's own list of node addresses (the starter's setting NANO_NODES), or else the public nodes that need no key. Those are run by volunteers,
//    with no promise of uptime.
// A node that does not answer, answers with an HTTP error or answers with an error is skipped, and the next one is asked. When none answers, the check
// fails closed: nothing is credited, and the order waits.

/** The `fetch` the shop uses (a test gives its own). */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type NanoNode = { name: string; url: string; headers?: Record<string, string> };

/** The keyed provider. Its key is a secret: the game reads it from its secret store and passes it, never writes it in code. */
export const KEYED_NODE = { name: "Nanswap Nodes", url: "https://nodes.nanswap.com/XNO", keyHeader: "nodes-api-key" } as const;

/** Public nodes with no key (from the community list at publicnodes.somenano.com, read 2026-10-21). */
export const PUBLIC_NODES: readonly NanoNode[] = [
  { name: "rpc.nano.to", url: "https://rpc.nano.to" },
  { name: "Rainstorm", url: "https://rainstorm.city/api" },
  { name: "NanOslo", url: "https://nanoslo.0x.no/proxy" },
];

/**
 * An optional setting or secret: its value without spaces around it, or undefined when it is not set. A setup page that needs a value in every field
 * (Cloudflare's "Deploy" page) gets "none", "skip", "off" or "-" (in any case), which also mean "not set".
 */
export function settingValue(v?: string | null): string | undefined {
  const s = (v ?? "").trim();
  return s && !/^(none|skip|off|-)$/i.test(s) ? s : undefined;
}

/**
 * The nodes to ask, in order. `NODE_API_KEY`: the keyed provider's key (it goes first). `NANO_NODES`: the game's own node addresses, separated by
 * commas, instead of the public list: https only, and plain http only for a node on this computer (local development with a mock node). The names are
 * the game starter's, so `nodesFor(env)` works as it is.
 */
export function nodesFor(settings: { NODE_API_KEY?: string | null; NANO_NODES?: string | null } = {}): NanoNode[] {
  const list: NanoNode[] = [];
  const key = settingValue(settings.NODE_API_KEY);
  if (key) list.push({ name: KEYED_NODE.name, url: KEYED_NODE.url, headers: { [KEYED_NODE.keyHeader]: key } });
  const own = (settings.NANO_NODES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^https:\/\/[^\s]+$/.test(s) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[^\s]*)?$/.test(s));
  list.push(...(own.length ? own.map((url) => ({ name: new URL(url).host, url })) : PUBLIC_NODES.map((n) => ({ ...n }))));
  return list;
}

export class NodeDown extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeDown";
  }
}

/** Nodes that failed lately are asked last for a short time (in this copy of the server only). */
const restUntil = new Map<string, number>();
const REST_MS = 30_000;

export type RpcOptions = { fetch?: Fetch; timeoutMs?: number; now?: () => number };

/**
 * Sends one RPC call to the first node that answers. Returns its answer, or null when the node says the thing does not exist ("Account not found",
 * "Block not found"). Throws NodeDown when no node answers.
 */
export async function rpc(nodes: readonly NanoNode[], body: Record<string, unknown>, o: RpcOptions = {}): Promise<{ node: string; answer: Record<string, any> | null }> {
  if (!nodes.length) throw new NodeDown("no Nano node is set");
  const fetchFn: Fetch = o.fetch ?? ((input, init) => fetch(input, init));
  const now = o.now ?? Date.now;
  const resting = (n: NanoNode) => (restUntil.get(n.url) ?? 0) > now();
  const order = [...nodes.filter((n) => !resting(n)), ...nodes.filter(resting)];
  const why: string[] = [];
  for (const node of order) {
    try {
      const res = await fetchFn(node.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "nano-game-starter", ...node.headers },
        body: JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(o.timeoutMs ?? 5000),
      });
      const text = await res.text();
      let answer: unknown;
      try {
        answer = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${res.status}, not JSON`);
      }
      if (!answer || typeof answer !== "object") throw new Error(`HTTP ${res.status}, not an object`);
      const error = (answer as { error?: unknown }).error;
      if (error !== undefined) {
        if (/not found/i.test(String(error))) {
          restUntil.delete(node.url);
          return { node: node.name, answer: null };
        }
        throw new Error(String(error).slice(0, 80));
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      restUntil.delete(node.url);
      return { node: node.name, answer: answer as Record<string, any> };
    } catch (e) {
      restUntil.set(node.url, now() + REST_MS);
      why.push(`${node.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new NodeDown(`no Nano node answered (${why.join("; ")})`);
}

/** For tests: forget which nodes failed. */
export function forgetNodeHealth(): void {
  restUntil.clear();
}
