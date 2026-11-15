// The QR code's versions 1 to 40, proved by others' code: the tables against two independent ones (jsQR's literal table of ISO/IEC 18004 and the
// `qrcode` package's), every module against the `qrcode` package's code at the same version, level and mask, and every code read back by an
// independent decoder (jsQR) from pixels. Both are dev dependencies only: the package ships neither. The codes of 213 bytes or less must not change:
// a fingerprint of 336 texts (120 nano: links and every length 1 to 213), made with the 0.17.0 encoder, holds them.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import jsQR from "jsqr";
import { account } from "./player-signin-keys.js";
import { createAdminSignin, createMemoryAdminSignin } from "../src/admin-signin/index.js";
import { createMemoryPlayerSignin, createPlayerSignin } from "../src/player-signin/index.js";
import { QR_MAX_BYTES, qrAlignment, qrBlocks, qrLevelFor, qrModules, qrVersionFor, type QrLevel } from "../src/shop/panel/qr.js";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const QRCode: any = require("qrcode");
const ecc: any = require("qrcode/lib/core/error-correction-code");
const eclevel: any = require("qrcode/lib/core/error-correction-level");
const align: any = require("qrcode/lib/core/alignment-pattern");
const utils: any = require("qrcode/lib/core/utils");

/** jsQR's own table (ISO/IEC 18004's tables 1, 9 and D.1 and annex E, as ZXing has them), read from its file as data. */
type JsqrVersion = { infoBits: number | null; versionNumber: number; alignmentPatternCenters: number[]; errorCorrectionLevels: { ecCodewordsPerBlock: number; ecBlocks: { numBlocks: number; dataCodewordsPerBlock: number }[] }[] };
const JSQR_VERSIONS: JsqrVersion[] = (() => {
  const file = readFileSync(require.resolve("jsqr"), "utf8");
  const at = file.indexOf("exports.VERSIONS = [");
  const text = file.slice(at + "exports.VERSIONS = ".length, file.indexOf("\n];", at) + 2);
  return new Function(`return ${text}`)();
})();
/**
 * jsQR 1.4.0's table has one wrong entry: version 23's alignment centres are [6, 30, 54, 74, 102] there, but [6, 30, 54, 78, 102] in annex E (evenly spaced
 * by 24, as every other version's are; the qrcode package's formula gives 78 too). So stock jsQR reads no version 23 code. The tests read version 23 with a
 * copy of jsQR that has that one entry fixed, and every other version with stock jsQR; a test below shows that the entry is the only cause.
 */
const JSQR_23_WRONG = "alignmentPatternCenters: [6, 30, 54, 74, 102]";
const fixedJsqr: typeof jsQR = (() => {
  const file = readFileSync(require.resolve("jsqr"), "utf8");
  assert.equal(file.split(JSQR_23_WRONG).length, 2, "jsQR's version 23 entry is where this test expects it");
  const m: { exports: any } = { exports: {} };
  new Function("module", "exports", file.replace(JSQR_23_WRONG, "alignmentPatternCenters: [6, 30, 54, 78, 102]"))(m, m.exports);
  return m.exports.default ?? m.exports;
})();
/** jsQR lists the levels as L, M, Q, H. */
const JSQR_LEVEL: Record<QrLevel, number> = { L: 0, M: 1 };

/** A fixed generator: the same texts every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0), s / 2 ** 32);
}
const LEVELS: QrLevel[] = ["L", "M"];
const VERSIONS = Array.from({ length: 40 }, (_, i) => i + 1);
/** The most bytes `version` holds at `level`, from jsQR's table (the mode, a count of 8 bits to version 9 and 16 from 10, then the bytes). */
const capacity = (version: number, level: QrLevel) => {
  const l = JSQR_VERSIONS[version - 1].errorCorrectionLevels[JSQR_LEVEL[level]];
  const data = l.ecBlocks.reduce((a, b) => a + b.numBlocks * b.dataCodewordsPerBlock, 0);
  return Math.floor((data * 8 - 4 - (version < 10 ? 8 : 16)) / 8);
};
const ascii = (n: number, r: () => number) => Array.from({ length: n }, () => String.fromCharCode(33 + Math.floor(r() * 94))).join("");
const bits = (m: boolean[][]) => m.map((row) => row.map((d) => (d ? "1" : "0")).join("")).join("\n");

/** The `qrcode` package's modules for `text` at that version, level and mask. */
function theirs(text: string, version: number, level: QrLevel, mask: number): string {
  const q = QRCode.create([{ data: new TextEncoder().encode(text), mode: "byte" }], { version, errorCorrectionLevel: level, maskPattern: mask });
  const n = q.modules.size;
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = "";
    for (let x = 0; x < n; x++) row += q.modules.get(y, x) ? "1" : "0";
    rows.push(row);
  }
  return rows.join("\n");
}

/** The code drawn as a picture (`px` pixels a module, a quiet zone of 4 modules), read by jsQR (version 23 by the fixed copy): the bytes it found, or null. */
function decode(m: boolean[][], px = 2, reader: typeof jsQR = m.length === 23 * 4 + 17 ? fixedJsqr : jsQR): { bytes: number[]; version: number } | null {
  const n = (m.length + 8) * px;
  const rgba = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m.length; x++) {
      if (!m[y][x]) continue;
      for (let dy = 0; dy < px; dy++)
        for (let dx = 0; dx < px; dx++) {
          const i = (((y + 4) * px + dy) * n + (x + 4) * px + dx) * 4;
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
        }
    }
  const r = reader(rgba, n, n, { inversionAttempts: "dontInvert" });
  return r ? { bytes: r.binaryData, version: r.version } : null;
}
const bytesOf = (text: string) => [...new TextEncoder().encode(text)];

describe("the QR code's tables, entry by entry", () => {
  test("jsQR's table is whole: versions 1 to 40, levels L, M, Q, H", () => {
    assert.equal(JSQR_VERSIONS.length, 40);
    JSQR_VERSIONS.forEach((v, i) => assert.equal(v.versionNumber, i + 1));
  });

  test("the EC codewords per block, the blocks and their data codewords, for each version at L and M: the same as jsQR's table and the qrcode package's", () => {
    for (const v of VERSIONS)
      for (const level of LEVELS) {
        const mine = qrBlocks(v, level);
        const theirLevel = JSQR_VERSIONS[v - 1].errorCorrectionLevels[JSQR_LEVEL[level]];
        assert.equal(mine.ec, theirLevel.ecCodewordsPerBlock, `version ${v} ${level}: the EC codewords per block`);
        const expected = theirLevel.ecBlocks.flatMap((b) => new Array<number>(b.numBlocks).fill(b.dataCodewordsPerBlock));
        assert.deepEqual(mine.data, expected, `version ${v} ${level}: the blocks`);
        assert.equal(mine.data.length, ecc.getBlocksCount(v, eclevel[level]), `version ${v} ${level}: the blocks (qrcode)`);
        assert.equal(mine.ec * mine.data.length, ecc.getTotalCodewordsCount(v, eclevel[level]), `version ${v} ${level}: the EC codewords (qrcode)`);
        assert.equal(mine.data.reduce((a, b) => a + b, 0) + mine.ec * mine.data.length, utils.getSymbolTotalCodewords(v), `version ${v}: all codewords (qrcode)`);
      }
  });

  test("the alignment patterns' centres, for each version: the same as jsQR's table (annex E; its version 23 entry is wrong) and the qrcode package's", () => {
    for (const v of VERSIONS) {
      if (v === 23) assert.deepEqual(JSQR_VERSIONS[v - 1].alignmentPatternCenters, [6, 30, 54, 74, 102], "jsQR's one wrong entry");
      else assert.deepEqual(qrAlignment(v), JSQR_VERSIONS[v - 1].alignmentPatternCenters, `version ${v}`);
      assert.deepEqual(qrAlignment(v), align.getRowColCoords(v), `version ${v} (qrcode)`);
    }
  });

  test("the version information (versions 7 to 40) in the code: jsQR's 18 bits, in both places", () => {
    for (const v of VERSIONS.filter((x) => x >= 7)) {
      const m = qrModules(ascii(capacity(v, "L"), rng(v)), 0, "L");
      const n = m.length;
      const info = JSQR_VERSIONS[v - 1].infoBits!;
      for (let i = 0; i < 18; i++) {
        const dark = ((info >>> i) & 1) === 1;
        const a = n - 11 + (i % 3);
        const b = Math.floor(i / 3);
        assert.equal(m[b][a], dark, `version ${v}: bit ${i}, top right`);
        assert.equal(m[a][b], dark, `version ${v}: bit ${i}, bottom left`);
      }
    }
  });

  test("the capacity of each version: the shortest and the longest text of a version get that version, and one byte more gets the next", () => {
    for (const level of LEVELS)
      for (const v of VERSIONS) {
        const most = capacity(v, level);
        assert.equal(qrVersionFor(most, level), v, `${level} ${v}: ${most} bytes`);
        assert.equal(qrVersionFor(most + 1, level), v === 40 ? 0 : v + 1, `${level} ${v}: ${most + 1} bytes`);
      }
    assert.equal(capacity(10, "M"), 213);
    assert.equal(capacity(40, "L"), QR_MAX_BYTES);
    assert.equal(capacity(40, "M"), 2331);
  });
});

describe("the QR code's modules", () => {
  test("every version at L and M, the shortest and the longest text, each mask: module for module the qrcode package's code", () => {
    let codes = 0;
    for (const level of LEVELS)
      for (const v of VERSIONS) {
        const r = rng(v * 7 + (level === "M" ? 1 : 0));
        for (const len of [v === 1 ? 1 : capacity(v - 1, level) + 1, capacity(v, level)]) {
          const text = ascii(len, r);
          for (let mask = 0; mask < 8; mask++) {
            const m = qrModules(text, mask, level);
            assert.equal(m.length, v * 4 + 17, `${level} ${v}: the size`);
            assert.equal(bits(m), theirs(text, v, level, mask), `${level} version ${v}, ${len} bytes, mask ${mask}`);
            codes++;
          }
        }
      }
    assert.equal(codes, 2 * 40 * 2 * 8);
  });

  test("jsQR reads back every version at L and M, at the shortest and the longest text, with each mask", () => {
    let read = 0;
    for (const level of LEVELS)
      for (const v of VERSIONS) {
        const r = rng(1000 + v * 7 + (level === "M" ? 1 : 0));
        for (const len of [v === 1 ? 1 : capacity(v - 1, level) + 1, capacity(v, level)]) {
          const text = ascii(len, r);
          for (let mask = 0; mask < 8; mask++) {
            const got = decode(qrModules(text, mask, level));
            assert.ok(got, `${level} version ${v}, ${len} bytes, mask ${mask}: jsQR found no code`);
            assert.equal(got.version, v);
            assert.deepEqual(got.bytes, bytesOf(text), `${level} version ${v}, ${len} bytes, mask ${mask}`);
            read++;
          }
        }
      }
    assert.equal(read, 1280);
  });

  test("jsQR reads back 200 random texts with the mask the encoder picks: nano: links, the three wallets' sign-in links, URLs and any UTF-8", () => {
    const r = rng(20261115);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const ALPHA = "13456789abcdefghijkmnopqrstuwxyz";
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const address = () => `nano_${pick(["1", "3"])}${Array.from({ length: 59 }, () => pick([...ALPHA])).join("")}`;
    const host = () => `${ascii(3 + Math.floor(r() * 40), r).replace(/[^a-z0-9]/gi, "a").toLowerCase()}.${pick(["com", "org", "party", "example.org", "co.uk"])}`;
    const base = () => pick(["", "/games/a-long-game-name", `/${ascii(1 + Math.floor(r() * 30), r).replace(/[^a-z0-9]/gi, "x")}`]);
    const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
    const shapes = [
      () => `nano:${address()}?amount=${Math.floor(r() * 1e9)}${"0".repeat(Math.floor(r() * 31))}`,
      () => `berrypay://signin?request_uri=${encodeURIComponent(`https://${host()}${base()}/api/signin/nano/${hex(32)}`)}`,
      () => `https://nanchat.com/?uri=nanauth://sign?message=${encodeURIComponent(`Login to ${host()} nonce: ${hex(32)}`)}&url=${encodeURIComponent(`https://${host()}${base()}/api/signin/nanchat`)}`,
      () => `nanoauth:${Array.from({ length: 300 + Math.floor(r() * 700) }, () => pick([...B64])).join("")}`,
      () => `https://${host()}${base()}/?q=${ascii(Math.floor(r() * 400), r)}`,
      () => Array.from({ length: 1 + Math.floor(r() * 300) }, () => pick(["a", "é", "€", "😀", "ß", " ", "Z", "7", "ナ"])).join(""),
    ];
    const versions = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const text = shapes[i % shapes.length]();
      const m = qrModules(text);
      const n = new TextEncoder().encode(text).length;
      const v = (m.length - 17) / 4;
      assert.equal(v, qrVersionFor(n), `${n} bytes`);
      const got = decode(m);
      assert.ok(got, `text ${i} (${n} bytes, version ${v}): jsQR found no code`);
      assert.deepEqual(got.bytes, bytesOf(text), `text ${i} (${n} bytes, version ${v})`);
      versions.add(v);
    }
    assert.ok(versions.size >= 15, `the texts reach many versions (${versions.size})`);
  });

  test("version 23: stock jsQR misses codes that the copy with its one table entry fixed reads, every one", () => {
    const r = rng(23);
    const missed: string[] = [];
    for (const level of LEVELS)
      for (const len of [capacity(22, level) + 1, capacity(23, level)])
        for (let mask = 0; mask < 8; mask++) {
          const text = ascii(len, r);
          const m = qrModules(text, mask, level);
          assert.equal(m.length, 23 * 4 + 17);
          if (!decode(m, 2, jsQR)) missed.push(`${level}${len}/${mask}`);
          assert.deepEqual(decode(m, 2, fixedJsqr)?.bytes, bytesOf(text), `${level} ${len} bytes mask ${mask}: the fixed copy`);
        }
    // Level M's correction covers the misplaced pattern here; level L's cannot: stock jsQR misses all 16 L codes.
    assert.deepEqual(missed, ["L1004", "L1091"].flatMap((t) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => `${t}/${k}`)));
  });
});

describe("the wallets' sign-in links (the package's own handlers, local test values only)", () => {
  test("Berry Wallet, NanChat and Nautilus, for the player and the admin, on short and long hosts and a long path base: each fits, and jsQR reads it back", async () => {
    const HOSTS = ["game.test", "a-long-game-name.example.org", "a-very-long-game-name-for-a-test.example-studio.co.uk:8443"];
    const rows: string[] = [];
    let longest = 0;
    const check = (who: string, host: string, way: string, link: string) => {
      const n = new TextEncoder().encode(link).length;
      longest = Math.max(longest, n);
      const m = qrModules(link);
      const got = decode(m);
      assert.deepEqual(got?.bytes, bytesOf(link), `${who} ${way} on ${host}`);
      rows.push(`${who.padEnd(42)} ${host.padEnd(58)} ${way.padEnd(9)} ${String(n).padStart(4)} B  version ${String(qrVersionFor(n)).padStart(2)} ${qrLevelFor(n)}  ${m.length} modules`);
    };
    const start = async (handle: (r: Request) => Promise<Response | null>, host: string, path: string, way: string) => {
      const res = await handle(new Request(`https://${host}${path}/start`, { method: "POST", headers: { "Content-Type": "application/json", Origin: `https://${host}`, "CF-Connecting-IP": "203.0.113.9", "CF-IPCountry": "US" }, body: JSON.stringify({ way }) }));
      assert.equal(res?.status, 200);
      return ((await res!.json()) as { link: string }).link;
    };
    for (const host of HOSTS)
      for (const base of ["/api/signin", "/games/a-long-game-name/api/signin"]) {
        const s = createPlayerSignin({ store: createMemoryPlayerSignin(), siteAddress: account("the game").address, base });
        for (const way of ["berry", "nanchat", "nautilus"]) check(`player ${base}`, host, way, await start((r) => s.handle(r), host, base, way));
      }
    for (const host of HOSTS) {
      const s = createAdminSignin({ store: createMemoryAdminSignin(), owner: account("the owner").address, nanchat: true });
      for (const way of ["berry", "nanchat", "nautilus"]) check("admin /api/admin-signin", host, way, await start((r) => s.handle(r), host, "/api/admin-signin", way));
    }
    assert.ok(longest > 700 && longest < QR_MAX_BYTES / 2, `the longest link (${longest} bytes) has room to spare`);
    console.log(`\n${rows.join("\n")}`);
  });
});

describe("the QR code's level and its limits", () => {
  test("level M up to 213 bytes (every nano: link), level L above: the larger modules of a smaller code, for a link read from a screen", () => {
    assert.equal(qrLevelFor(213), "M");
    assert.equal(qrLevelFor(214), "L");
    assert.equal(qrVersionFor(213), 10);
    assert.equal(qrVersionFor(214), 9, "214 bytes at L are version 9: the code gets smaller, never larger, at the change of level");
    // The format information says the level: read it back from the code (the 15 bits next to the top left finder, mask 0x5412).
    const levelOf = (m: boolean[][]) => {
      let bits = 0;
      for (let i = 0; i <= 5; i++) bits |= (m[i][8] ? 1 : 0) << i;
      bits |= (m[7][8] ? 1 : 0) << 6;
      bits |= (m[8][8] ? 1 : 0) << 7;
      bits |= (m[8][7] ? 1 : 0) << 8;
      for (let i = 9; i < 15; i++) bits |= (m[8][14 - i] ? 1 : 0) << i;
      return ["M", "L", "H", "Q"][((bits ^ 0x5412) >>> 13) & 3];
    };
    assert.equal(levelOf(qrModules("x".repeat(213))), "M");
    assert.equal(levelOf(qrModules("x".repeat(214))), "L");
    assert.equal(levelOf(qrModules("x".repeat(214), undefined, "M")), "M");
    assert.equal(qrModules("x".repeat(214), undefined, "M").length, 11 * 4 + 17);
  });

  test("a text longer than version 40 holds: an error that names the size and never the text", () => {
    assert.equal(qrModules("x".repeat(QR_MAX_BYTES)).length, 177);
    assert.throws(() => qrModules("secret-ish".repeat(296)), (e: unknown) => e instanceof Error && e.message === "qrModules: 2960 bytes are more than a QR code holds (2953)");
    assert.throws(() => qrModules("x".repeat(2332), undefined, "M"), /2332 bytes are more than a QR code holds/);
  });

  test("every code of 213 bytes or less is the 0.17.0 encoder's, module for module (a fingerprint of 336 texts and their 9 masks)", () => {
    const r = rng(0x9e3779b9);
    const ALPHA = "13456789abcdefghijkmnopqrstuwxyz";
    const address = () => "nano_" + (r() < 0.5 ? "1" : "3") + Array.from({ length: 59 }, () => ALPHA[Math.floor(r() * 32)]).join("");
    const texts: string[] = [];
    for (let i = 0; i < 120; i++) {
      const raw = String(Math.floor(r() * 1e9)) + "0".repeat(Math.floor(r() * 31));
      texts.push(`nano:${address()}?amount=${raw}`);
    }
    for (let len = 1; len <= 213; len++) texts.push(Array.from({ length: len }, () => String.fromCharCode(32 + Math.floor(r() * 95))).join(""));
    texts.push("nano:x", "é".repeat(100), "😀".repeat(53));
    const h = createHash("sha256");
    for (const t of texts) {
      h.update(`${bits(qrModules(t)).replace(/\n/g, "\n")}|`);
      for (let k = 0; k < 8; k++) h.update(`${bits(qrModules(t, k))}|`);
    }
    assert.equal(texts.length, 336);
    assert.equal(h.digest("hex"), "76d5cee62b2ac4f9709480372f53502bb307c46bc54b31a65336bfdbb77321ad");
  });
});
