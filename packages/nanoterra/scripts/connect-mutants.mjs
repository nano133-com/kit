// The proof that the connect suite holds each rule: a broken copy of src/connect for each rule (one rule taken out), and the connect tests run on it.
// A broken copy must fail at least one case of the conformance suite on the Worker adapter AND on the Node adapter (or, for a rule that only a test with
// a clock or a bridge can see, the kit's own test named in `held`). The copies are made in a folder of their own: the package's files never change.
//
//   node scripts/connect-mutants.mjs [folder]        (from packages/nanoterra; the folder is made when missing, default: a new one in the OS temp)
//
// It prints one line a broken copy: its id, the rule, and the cases that failed. It exits 1 when a broken copy fails no case, except the ones in
// EXPECTED_LIVE (a change that makes no difference: the sign-in stays safe, and no test can see it).

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tsxPath = (() => {
  for (const base of [root, resolve(root, "../..")]) {
    const p = join(base, "node_modules/tsx/dist/esm/index.mjs");
    try {
      readFileSync(p);
      return p;
    } catch {
      // try the next
    }
  }
  throw new Error("tsx is not installed: run npm ci in the kit first");
})();
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "connect-mutants-"));
mkdirSync(out, { recursive: true });

/** [id, the rule it takes out, file, the text, its broken form]. Each text must be in the file exactly once. */
const MUTANTS = [
  ["M01", "S1 the authorize route", "core.ts", 'export const AUTHORIZE_PATH = "/api/nanoterra/authorize";', 'export const AUTHORIZE_PATH = "/api/nanoterra/authorise";'],
  ["M02", "S1 the client id in the redirect", "core.ts", '    to.searchParams.set("client_id", setup.clientId);\n', ""],
  ["M03", "S2 a state of 128 bits or more", "core.ts", "const STATE_BYTES = 24;", "const STATE_BYTES = 8;"],
  ["M04", "S3 a new state at each start", "core.ts", "export const newState = () => b64url(crypto.getRandomValues(new Uint8Array(STATE_BYTES)));", 'export const newState = () => "a".repeat(32);'],
  ["M05", "S4/C3 the __Host- name (a copy that treats every host as a dev server)", "core.ts", '  return u.protocol === "http:" && (u.hostname === "localhost"', '  return true || (u.hostname === "localhost"'],
  ["M06", "S4 HttpOnly", "core.ts", "; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax", "; Max-Age=${maxAgeSec}; SameSite=Lax"],
  ["M07", "S4 SameSite=Lax (Strict breaks the return; None lets any site send it)", "core.ts", "; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax", "; Max-Age=${maxAgeSec}; HttpOnly; SameSite=None"],
  ["M08", "S4 a short life (10 minutes at most)", "core.ts", "export const STATE_SECONDS = 600;", "export const STATE_SECONDS = 3600;"],
  ["M09", "S5 start takes GET only", "core.ts", '  async function start(req: Request): Promise<Response> {\n    if (req.method !== "GET") return notAllowed("GET");\n', "  async function start(req: Request): Promise<Response> {\n"],
  ["M10", "C1/C3 the state check (no check at all)", "core.ts", '    if (!STATE.test(state) || !STATE.test(kept) || !(await sameText(state, kept))) return page(400, "notHere", clear);\n', ""],
  ["M11", "C3 the compare (shapes only)", "core.ts", "|| !STATE.test(kept) || !(await sameText(state, kept))) return page(400", "|| !STATE.test(kept)) return page(400"],
  ["M12", "C3 the cookie by its __Host- name only (the plain name read too)", "core.ts", "  return cookie(req, localDev(req) ? name : `__Host-${name}`);", "  return cookie(req, localDev(req) ? name : `__Host-${name}`) ?? cookie(req, name);"],
  ["M13", "C2 the code's shape", "core.ts", '    if (!CODE.test(code)) return page(400, "badCode");\n', ""],
  ["M14", "C4 no redirect followed", "core.ts", '      redirect: "manual",', '      redirect: "follow",'],
  ["M15", "C4 the state sent is the cookie's (equivalent after the compare: expected to live)", "core.ts", "    const player = await exchangeCode(setup, code, kept, fetcher, log);", "    const player = await exchangeCode(setup, code, state, fetcher, log);"],
  ["M16", "C5 the state cookie dropped on the confirm screen", "core.ts", '    for (const c of clear) headers.append("Set-Cookie", c);\n    return new Response(html, { status: 200, headers });', "    return new Response(html, { status: 200, headers });"],
  ["M17", "C5 the state cookie dropped on a refusal", "core.ts", '    if (!player) return page(400, "refused", clear);', '    if (!player) return page(400, "refused");'],
  ["M18", "C6 only a 200 is an answer", "core.ts", "    if (res.status !== 200) {", "    if (res.status >= 300) {"],
  ["M19", "C6 the answer's bound", "core.ts", "export const ANSWER_MAX = 32 * 1024;", "export const ANSWER_MAX = 32 * 1024 * 1024;"],
  ["M20", "C6 playerId is the address", "core.ts", " || playerId !== address) return null;", ") return null;"],
  ["M21", "C6 no control or direction character in a name", "core.ts", " || username.length > 60 || CONTROL.test(username)) return null;", " || username.length > 60) return null;"],
  ["M22", "C6 the nano_ prefix", "core.ts", ' || !address.startsWith("nano_") || !validAddress(address)', " || !validAddress(address)"],
  ["M23", "C7 no code in a log line", "core.ts", '    log("the exchange failed", { error: errorName(e) });', '    log(`the exchange failed ${code}`, { error: errorName(e) });'],
  ["M24", "C7 no secret in a log line", "core.ts", '      log("the exchange was refused", { status: res.status });', '      log(`the exchange was refused for ${setup.clientId}:${setup.secret}`, { status: res.status });'],
  ["M25", 'P1 only the exact string "press"', "core.ts", '  return (v as { arrival?: unknown }).arrival === "press";', '  return String((v as { arrival?: unknown }).arrival).trim().toLowerCase() === "press";'],
  ["M26", "P1 the press read only after the state check (a press with no screen for any arrival)", "core.ts", "    if (player.press && !doubt) {", "    if (!doubt) {"],
  ["M27", "P2 the pending cookie's short life (5 minutes)", "core.ts", "export const PENDING_SECONDS = 300;", "export const PENDING_SECONDS = 3000;"],
  ["M28", "P2 the screen's Referrer-Policy same-origin", "core.ts", '    const headers = pageHeaders(s, "same-origin");', '    const headers = pageHeaders(s, "no-referrer");'],
  ["M29", "P2 no frame around the screen", "screens.ts", "\"Content-Security-Policy\": s.csp ?? CONNECT_CSP,\n    \"X-Frame-Options\": \"DENY\",", "\"Content-Security-Policy\": (s.csp ?? CONNECT_CSP).replace(\"frame-ancestors 'none'\", \"frame-ancestors *\"),"],
  ["M30", "P2 the name escaped", "screens.ts", "  const values = { name: escapeHtml(username), address:", "  const values = { name: username, address:"],
  ["M31", "P2 the bind is a hash, never the token", "core.ts", "export const bindOf = async (token: string): Promise<string> => (await sha256Hex(token)).slice(0, 32);", "export const bindOf = async (token: string): Promise<string> => token;"],
  ["M32", "P4/P5 another account gets Switch (any session taken as the same account)", "core.ts", ": here.address === player.address))) return await pendingPage", ": true))) return await pendingPage"],
  ["M33", "P4 a session of the same account stays", "core.ts", "      if (here) return go(clear);\n", ""],
  ["M34", "P5 a press never replaces another account's session (Switch skipped)", "core.ts", "      if (here && !(await (o.same ? o.same(here, player) : here.address === player.address))) return await pendingPage(req, player, clear, here.name ?? shortAddress(here.address));\n", ""],
  ["M35", "F2 Continue only from this game's page (no origin check)", "core.ts", '    if (!ownOrigin(req, o.origins)) return page(403, "notOwnPage");\n    if (!(await limit("confirm", req)))', '    if (!(await limit("confirm", req)))'],
  ["M36", "F2 an Origin is required (the starter's looser rule: Sec-Fetch-Site alone)", "core.ts", "  if (origin === null) return false;", '  if (origin === null) return site === "same-origin";'],
  ["M37", "F2 Sec-Fetch-Site same-origin when sent", "core.ts", '  if (site !== null && site !== "same-origin") return false;\n', ""],
  ["M38", "F3 the pending cookie's signature", "core.ts", "    if (!(await crypto.subtle.verify(", "    if (false && !(await crypto.subtle.verify("],
  ["M39", "F3 the pending cookie's deadline (only a clock sees it: the kit's test)", "core.ts", " || v.exp < now ||", " ||"],
  ["M40", "F4 the bind", "core.ts", '    if (!(await sameText(await bindField(req), await bindOf(pending.token)))) return page(400, "changed", clear);\n', ""],
  ["M41", "F5 Continue works once", "core.ts", '    if (!(await o.once(pending.id, pending.exp, "confirm"))) return page(400, "used", clear);\n', ""],
  ["M42", "F5 Not me uses the cookie up", "core.ts", '    if (pending) await o.once(pending.id, pending.exp, "cancel");\n', ""],
  ["M43", "N1 Not me only from this game's page", "core.ts", '    // From this game\'s own page only (Arcade\'s; the starter took it from anywhere): another site cannot spend a player\'s screen.\n    if (!ownOrigin(req, o.origins)) return page(403, "notOwnPage");\n', ""],
  ["M44", "R1 the player goes to `after`, never to an address from the request", "core.ts", "    return made instanceof Response ? withCookies(made, clear) : go([...cookiesOf(made), ...clear]);\n  }\n\n  /** POST /nanoterra/cancel", '    const next = new URL(req.url).searchParams.get("next");\n    if (next) return new Response(null, { status: 303, headers: { Location: next } });\n    return made instanceof Response ? withCookies(made, clear) : go([...cookiesOf(made), ...clear]);\n  }\n\n  /** POST /nanoterra/cancel'],
  ["M45", "L1 the callback's limit", "core.ts", '    if (!(await limit("callback", req))) return page(429, "tooMany");\n', ""],
  ["M46", "S5 start sends no Referer", "core.ts", '    const headers = new Headers({ Location: to.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });', '    const headers = new Headers({ Location: to.toString(), "Cache-Control": "no-store" });'],
  ["M47", "Node: the request at the public origin, never the Host header (the kit's test)", "node.ts", "  const url = new URL(req.originalUrl ?? req.url ?? \"/\", origin);\n  if (url.origin !== origin)", "  const url = new URL(req.originalUrl ?? req.url ?? \"/\", `http://${String(req.headers.host)}`);\n  if (false)"],
  ["M48", "Node: each Set-Cookie on its own", "node.ts", '  if (cookies.length) res.setHeader("Set-Cookie", cookies);', '  if (cookies.length) res.setHeader("Set-Cookie", cookies.join(", "));'],
];

const files = ["core.ts", "screens.ts", "node.ts"];
/** M15: after the compare, the link's state and the cookie's are the same text, so sending either is the same request. */
const EXPECTED_LIVE = new Set(["M15"]);
const rows = [];
let lived = 0;
for (const [id, rule, file, from, to] of MUTANTS) {
  const dir = join(out, id);
  cpSync(join(root, "src"), join(dir, "src"), { recursive: true });
  cpSync(join(root, "test"), join(dir, "test"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  const path = join(dir, "src/connect", file);
  const text = readFileSync(path, "utf8");
  const count = text.split(from).length - 1;
  if (count !== 1 || !files.includes(file)) {
    rows.push(`${id}  ${rule}: THE TEXT IS IN ${file} ${count} TIMES (fix the script)`);
    lived += 1;
    continue;
  }
  writeFileSync(path, text.replace(from, to));
  const r = spawnSync(process.execPath, ["--import", tsxPath, "--test", "--test-reporter=tap", "test/connect.test.ts"], { cwd: dir, encoding: "utf8", timeout: 240_000 });
  const failed = [...r.stdout.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  const worker = new Set(), node = new Set(), kit = [];
  // TAP nests the cases under their describe: read which suite each failed case is in.
  let suite = "";
  for (const line of r.stdout.split("\n")) {
    const s = /^# Subtest: (connect.*)$/.exec(line.trim());
    if (s) suite = s[1];
    const f = /^\s+not ok \d+ - ([A-Z]\d) /.exec(line);
    if (f && suite.includes("Worker")) worker.add(f[1]);
    else if (f && suite.includes("Node adapter")) node.add(f[1]);
  }
  for (const name of failed) if (!/^[A-Z]\d /.test(name) && !name.startsWith("connect")) kit.push(name.slice(0, 70));
  const caught = worker.size > 0 || node.size > 0 || kit.length > 0;
  if (!caught && !EXPECTED_LIVE.has(id)) lived += 1;
  rows.push(`${id}  ${caught ? "CAUGHT" : EXPECTED_LIVE.has(id) ? "LIVED (expected)" : "LIVED "}  ${rule}  | Worker: ${[...worker].join(" ") || "-"} | Node: ${[...node].join(" ") || "-"} | kit tests: ${kit.length ? kit.join("; ") : "-"}`);
}
console.log(rows.join("\n"));
console.log(`\n${MUTANTS.length} broken copies; ${lived} lived that should not. Copies in ${out}`);
process.exit(lived > 0 ? 1 : 0);
