// The proof that the connect suite holds each rule: a broken copy of src/connect for each rule (one rule taken out), and the connect tests run on it.
// A broken copy must fail at least one case of the conformance suite on the Worker adapter AND on the Node adapter (or, for a rule that only a test with
// a clock or a bridge can see, the kit's own test named in `held`). The copies are made in a folder of their own: the package's files never change.
//
//   node scripts/connect-mutants.mjs [folder]        (from packages/nanoterra; the folder is made when missing, default: a new one in the OS temp)
//
// It prints one line a broken copy: its id, the rule, and the cases that failed. It exits 1 when a broken copy fails no case, except the ones in
// EXPECTED_LIVE (a change that makes no difference: the sign-in stays safe, and no test can see it). M01 to M48 are the builder's; A01 to A21 the
// security review's own (2026-11-15); N01 to N12 the review's fixes undone, one part each.

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
  ["M05", "S4/C3 the __Host- name (a copy that treats every host as a dev server)", "core.ts", 'const localUrl = (u: URL) => u.protocol === "http:" && (u.hostname === "localhost"', 'const localUrl = (u: URL) => true || (u.hostname === "localhost"'],
  ["M06", "S4 HttpOnly", "core.ts", "; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax", "; Max-Age=${maxAgeSec}; SameSite=Lax"],
  ["M07", "S4 SameSite=Lax (Strict breaks the return; None lets any site send it)", "core.ts", "; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax", "; Max-Age=${maxAgeSec}; HttpOnly; SameSite=None"],
  ["M08", "S4 a short life (10 minutes at most)", "core.ts", "export const STATE_SECONDS = 600;", "export const STATE_SECONDS = 3600;"],
  ["M09", "S5 start takes GET only", "core.ts", '  async function start(req: Request): Promise<Response> {\n    if (req.method !== "GET") return notAllowed("GET");\n', "  async function start(req: Request): Promise<Response> {\n"],
  ["M10", "C1/C3 the state check (no check at all)", "core.ts", '    if (!STATE.test(state) || !STATE.test(kept) || !(await sameText(state, kept))) return page(400, "notHere", clear);\n', ""],
  ["M11", "C3 the compare (shapes only)", "core.ts", "|| !STATE.test(kept) || !(await sameText(state, kept))) return page(400", "|| !STATE.test(kept)) return page(400"],
  ["M12", "C3 the cookie by its __Host- name only (the plain name read too)", "core.ts", "  return cookie(req, localDev(req, origins) ? name : `__Host-${name}`);", "  return cookie(req, localDev(req, origins) ? name : `__Host-${name}`) ?? cookie(req, name);"],
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
  ["M36", "F2 no Origin passes only with Sec-Fetch-Site same-origin (a copy that takes no Origin and no Sec-Fetch-Site)", "core.ts", '  if (origin === null) return site === "same-origin";', "  if (origin === null) return true;"],
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
  // The security review's own broken copies (2026-11-15-kit-connect-review.md, A01 to A21), on the code after its fixes.
  ["A01", "C3/F3 the cookie name compared exactly (a copy with trim(): a U+00A0-tossed cookie passes)", "core.ts", "    if (i > 0 && trimAscii(part.slice(0, i)) === name) {", "    if (i > 0 && part.slice(0, i).trim() === name) {"],
  ["A02", "C3/F3 the cookie name compared with its case (a __host- cookie passes)", "core.ts", "    if (i > 0 && trimAscii(part.slice(0, i)) === name) {", "    if (i > 0 && trimAscii(part.slice(0, i)).toLowerCase() === name.toLowerCase()) {"],
  ["A03", "C3 no state cookie: the link's state trusted", "core.ts", "    if (!STATE.test(state) || !STATE.test(kept) || !(await sameText(state, kept))) return page(400, \"notHere\", clear);\n    const player = await exchangeCode(setup, code, kept, fetcher, log);", "    if (!STATE.test(state) || (kept && !(await sameText(state, kept)))) return page(400, \"notHere\", clear);\n    const player = await exchangeCode(setup, code, kept || state, fetcher, log);"],
  ["A04", "P1 a throwing `arrived` still lets the press skip the screen", "core.ts", "    if (player.press && !doubt) {", "    if (player.press) {"],
  ["A05", "P1 a session that cannot be read: sign in anyway", "core.ts", "      log(\"the press could not be used\", { error: errorName(e) });\n      return null;", "      log(\"the press could not be used\", { error: errorName(e) });\n      return go([...cookiesOf(await o.signIn(req, player, { via: \"press\", id: randomHex(12) })), ...clear]);"],
  ["A06", "F5 Continue: signIn before the once check", "core.ts", "    if (!(await o.once(pending.id, pending.exp, \"confirm\"))) return page(400, \"used\", clear);\n    const made = await o.signIn(req, pending.player, { via: \"confirm\", id: pending.id });", "    const made = await o.signIn(req, pending.player, { via: \"confirm\", id: pending.id });\n    if (!(await o.once(pending.id, pending.exp, \"confirm\"))) return page(400, \"used\", clear);"],
  ["A07", "F4 a missing bind passes", "core.ts", "    if (!(await sameText(await bindField(req), await bindOf(pending.token)))) return page(400, \"changed\", clear);", "    const got = await bindField(req);\n    if (got && !(await sameText(got, await bindOf(pending.token)))) return page(400, \"changed\", clear);"],
  ["A08", "F3 an empty pending key", "core.ts", "  const key = o.signingKey ?? setup?.secret ?? \"\";", "  const key = \"\";"],
  ["A09", "F2/N1 the Origin compared by prefix (https://game.test.evil.test passes)", "core.ts", "  return origins && origins.length ? origins.includes(origin) : origin === new URL(req.url).origin;", "  return origins && origins.length ? origins.some((x) => origin.startsWith(x)) : origin.startsWith(new URL(req.url).origin);"],
  ["A10", "C6 the token call has no timeout (the kit's test)", "core.ts", "      signal: AbortSignal.timeout(5000),\n", ""],
  ["A11", "S1/S5 the secret in the authorize redirect", "core.ts", "    to.searchParams.set(\"state\", state);", "    to.searchParams.set(\"state\", state);\n    to.searchParams.set(\"client_secret\", setup.secret);"],
  ["A12", "any https site as the stand-in for nano133.com (the kit's test)", "core.ts", "    return (u.protocol === \"http:\" || u.protocol === \"https:\") && local && u.origin", "    return (u.protocol === \"http:\" || u.protocol === \"https:\") && u.origin"],
  ["A13", "C6 the address checksum not checked", "core.ts", "!address.startsWith(\"nano_\") || !validAddress(address) || playerId", "!address.startsWith(\"nano_\") || address.length !== 65 || playerId"],
  ["A14", "P5 the current name on the Switch screen not escaped (the kit's test)", "screens.ts", "  const values = { name: escapeHtml(username), current: escapeHtml(current) };", "  const values = { name: escapeHtml(username), current };"],
  ["A15", "the pages' policy allows inline script (the kit's test)", "screens.ts", "export const CONNECT_CSP = \"default-src 'none'; style-src 'self';", "export const CONNECT_CSP = \"default-src 'none'; script-src 'unsafe-inline'; style-src 'self';"],
  ["A16", "Node: no bound on the body's size (the kit's test)", "node.ts", "    if (size > BODY_MAX) {", "    if (false) {"],
  ["A17", "C7 errors logged by their message", "core.ts", "const errorName = (e: unknown) => (e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : \"error\");", "const errorName = (e: unknown) => (e instanceof Error ? e.message : \"error\");"],
  ["A18", "F2 Origin null taken as this site", "core.ts", "  if (origin === null) return site === \"same-origin\";", "  if (origin === null) return site === \"same-origin\";\n  if (origin === \"null\") return true;"],
  ["A19", "N1 Not me uses the cookie up before the origin check", "core.ts", "    if (!ownOrigin(req, o.origins)) return page(403, \"notOwnPage\");\n    const pending = key ? await readPending(key, req, now(), origins) : null;\n    if (pending) await o.once(pending.id, pending.exp, \"cancel\");", "    const pending = key ? await readPending(key, req, now(), origins) : null;\n    if (pending) await o.once(pending.id, pending.exp, \"cancel\");\n    if (!ownOrigin(req, o.origins)) return page(403, \"notOwnPage\");"],
  ["A20", "F3 no bound on the pending cookie's size (the kit's test)", "core.ts", "  if (!token || token.length > PENDING_MAX) return null;", "  if (!token) return null;"],
  ["A21", "C3 the plain state name read when the __Host- one is missing", "core.ts", "    const kept = readCookie(req, STATE_COOKIE, origins) ?? \"\";", "    const kept = readCookie(req, STATE_COOKIE, origins) ?? cookie(req, STATE_COOKIE) ?? \"\";"],
  // The review's fixes: the code before each fix, and each part of the new rules taken out.
  ["N01", "F1 no floor for the secret or the key (the code before the review)", "core.ts", "  const problem = connectSetupProblem(o);", "  const problem = null as string | null;"],
  ["N02", "F1 a weak secret does not throw (only the request-time guard is left)", "core.ts", "  if (problem && !o.localDevSecret) throw new ConnectSetupError(problem);\n", ""],
  ["N03", "F1 localDevSecret honoured away from a local dev server", "core.ts", "  const refusedHere = (req: Request) => problem !== null && !localDev(req, origins);", "  const refusedHere = (req: Request) => false && problem !== null;"],
  ["N04", "F1 localDevSecret with nano133.com itself (no stand-in needed)", "core.ts", "  if (problem && (siteOf(o.site) === null || siteOf(o.site) === NANOTERRA_SITE)) throw", "  if (false) throw"],
  ["N05", "F1 localDevSecret with origins that name another site", "core.ts", "  if (problem && o.origins?.length && !o.origins.every(localOrigin)) throw", "  if (false) throw"],
  ["N06", "F1 the secret's placeholder check (any 43 characters pass)", "core.ts", "  return SECRET_SHAPE.test(s) && kinds(s.slice(3)) >= SECRET_KINDS;", "  return SECRET_SHAPE.test(s);"],
  ["N07", "F1 the signing key's length", "core.ts", "key.length >= SIGNING_KEY_MIN && kinds(key) >= SIGNING_KEY_KINDS", "key.length > 0"],
  ["N08", "F1 the Worker answers a weak secret by throwing (Cloudflare's own error page, no guest link)", "worker.ts", "    if (e instanceof ConnectSetupError) return setupWrongConnect(options);\n", ""],
  ["N09", "F4 signIn after a screen gets items: [] (the code before the review)", "core.ts", "    const { items: _none, ...player } = read;", "    const player = read;"],
  ["N10", "F5 the cookies' names from the request, not from origins (the code before the review)", "core.ts", "  return localUrl(new URL(origins && origins.length ? origins[0] : req.url));", "  return localUrl(new URL(req.url));"],
  ["N11", "F7 no Origin refused even with Sec-Fetch-Site same-origin (the code before the review; stricter, but the player's own press fails)", "core.ts", "  if (origin === null) return site === \"same-origin\";", "  if (origin === null) return false;"],
  ["N12", "F12 Node: no time bound on the body", "node.ts", "    const step = await Promise.race([it.next(), late]).finally(() => clearTimeout(timer));", "    const step = await it.next().finally(() => clearTimeout(timer));"],
];

const files = ["core.ts", "screens.ts", "node.ts", "worker.ts"];
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
