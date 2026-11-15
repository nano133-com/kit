// A QR code made in the browser: no outside service sees the payment request or the sign-in link, and the package needs no QR library. Byte mode,
// versions 1 to 40, error correction level M or L. The pay sheet's nano: link (at most 117 bytes) is level M, as the game starter's qrcode-generator
// made it; a wallet's sign-in link (Nautilus's is 460 to 740 bytes, with the callback URL and the label in it) is longer, and a text longer than
// version 10 holds at level M (213 bytes) is level L: read from a screen, nothing smudges the code, and the larger modules matter more (L is two
// versions smaller there, 8 modules fewer each way). Every text of 213 bytes or less gives the same code as before 0.17.1.
// The steps are ISO/IEC 18004's (and Project Nayuki's reference code): the data and its Reed-Solomon codes, the fixed patterns, the zig-zag placement, and
// the mask with the lowest penalty. `qrModules` has no DOM; `qrSvg` draws it as one SVG path (crisp at any size, fine under a strict CSP).
// The tables (ISO/IEC 18004 table 9: the EC codewords per block and the blocks, for each version) are checked entry by entry against the `qrcode`
// package's in test/qr-versions.test.ts, and every version is read back by an independent decoder (jsQR) there.

/** A level of error correction: M (about 15% of the code can be lost) or L (about 7%). */
export type QrLevel = "L" | "M";

/**
 * For versions 1 to 40 at levels L and M (ISO/IEC 18004 table 9): the EC codewords of each block, then the number of blocks, one character a version,
 * its code less 40 (")" is 1, "F" is 30). Compact on purpose: the shop's and the sign-in's pages load it.
 */
const TABLE: Record<QrLevel, readonly [string, string]> = {
  L: ["/27<B:<@F:<@BF>@DFDDDDFFBDFFFFFFFFFFFFFF", ")))))****,,,,,..../0011244456789:;;<=>@A"],
  M: ["28B:@8:>>BF>>@@DDBBBBDDDDDDDDDDDDDDDDDDD", ")))**,,,---01122356899:<=?ABDEGIKMNPSUWY"],
};

/** The codewords of a version (data and EC): its modules less the fixed patterns and the format and version information, over 8. */
function rawCodewords(version: number): number {
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    bits -= (25 * n - 10) * n - 55;
    if (version >= 7) bits -= 36;
  }
  return bits >>> 3;
}

/** The data codewords of each block of `version` at `level` (the short blocks first, as the standard orders them), and the EC codewords of each block. */
export function qrBlocks(version: number, level: QrLevel): { ec: number; data: number[] } {
  const ec = TABLE[level][0].charCodeAt(version - 1) - 40;
  const n = TABLE[level][1].charCodeAt(version - 1) - 40;
  const raw = rawCodewords(version);
  const short = Math.floor(raw / n) - ec;
  const shortCount = n - (raw % n);
  return { ec, data: Array.from({ length: n }, (_, i) => short + (i < shortCount ? 0 : 1)) };
}

/** The centres of the alignment patterns on each axis (ISO/IEC 18004 annex E): from row 6 to size - 7, evenly spaced on even rows. */
export function qrAlignment(version: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let p = version * 4 + 10; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
}

const gfMul = (x: number, y: number): number => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
};

function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < degree) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return out;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const out = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (out.shift() as number);
    out.push(0);
    divisor.forEach((c, i) => (out[i] ^= gfMul(c, factor)));
  }
  return out;
}

/** The codewords (data and EC, interleaved) of `bytes` in `version` at `level`. */
function codewords(bytes: Uint8Array, version: number, level: QrLevel): number[] {
  const { ec: ecLen, data: blocks } = qrBlocks(version, level);
  const capacity = blocks.reduce((a, b) => a + b, 0);
  const bits: number[] = [];
  const put = (value: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
  const divisor = rsDivisor(ecLen);
  const parts: number[][] = [];
  let at = 0;
  for (const n of blocks) {
    parts.push(data.slice(at, at + n));
    at += n;
  }
  const ecs = parts.map((p) => rsRemainder(p, divisor));
  const out: number[] = [];
  const longest = Math.max(...blocks);
  for (let i = 0; i < longest; i++) for (const p of parts) if (i < p.length) out.push(p[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The penalty of a finished matrix (the four rules of the standard). */
function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    lines.push(m[i]);
    lines.push(m.map((row) => row[i]));
  }
  const finder = [true, false, true, true, true, false, true];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    for (let i = 0; i + 7 <= n; i++) {
      if (!finder.every((v, k) => line[i + k] === v)) continue;
      const lightBefore = i >= 4 && [1, 2, 3, 4].every((k) => !line[i - k]);
      const lightAfter = i + 11 <= n && [7, 8, 9, 10].every((k) => !line[i + k]);
      if (lightBefore) score += 40;
      if (lightAfter) score += 40;
    }
  }
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/** The data bits that `length` bytes take in byte mode in `version`: the mode, the count (8 bits to version 9, 16 from 10) and the bytes. */
const dataBits = (length: number, version: number) => 4 + (version < 10 ? 8 : 16) + 8 * length;

/**
 * The smallest version that holds `length` bytes, or 0 when none does. With `level`, at that level. Without one, the version of the code that
 * `qrModules` makes: level M up to version 10 (213 bytes), else level L (`qrLevelFor`).
 */
export function qrVersionFor(length: number, level?: QrLevel): number {
  const at = level ?? qrLevelFor(length);
  for (let v = 1; v <= 40; v++) {
    const { data } = qrBlocks(v, at);
    if (dataBits(length, v) <= 8 * data.reduce((x, y) => x + y, 0)) return v;
  }
  return 0;
}

/** The level that `qrModules` uses for `length` bytes: M when version 10 holds them at M (213 bytes, every nano: link), else L. */
export const qrLevelFor = (length: number): QrLevel => (length <= 213 ? "M" : "L");

/** The most bytes that any code holds: version 40 at level L. */
export const QR_MAX_BYTES = 2953;

/**
 * The modules of the QR code of `text` (UTF-8): `true` is dark, `[row][column]`, without the quiet zone. `mask` forces a mask (0 to 7); by default the
 * one with the lowest penalty. `level` forces a level; by default M up to 213 bytes, else L (`qrLevelFor`). Throws when the text is longer than
 * version 40 holds (2,953 bytes at L, 2,331 at M): its message names the size, never the text.
 */
export function qrModules(text: string, mask?: number, level?: QrLevel): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const at = level ?? qrLevelFor(bytes.length);
  const version = qrVersionFor(bytes.length, at);
  // The size only, never the text.
  if (version < 1) throw new Error(`qrModules: ${bytes.length} bytes are more than a QR code holds (${QR_MAX_BYTES})`);
  const size = version * 4 + 17;
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    m[y][x] = dark;
    fixed[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  }
  const pos = qrAlignment(version);
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const drawFormat = (maskNo: number) => {
    const data = ((at === "M" ? 0 : 1) << 3) | maskNo; // the level's bits: M is 00, L is 01
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  const words = codewords(bytes, version, at);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fixed[y][x] && i < words.length * 8) {
          m[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
  const masked = (k: number) => {
    const out = m.map((row) => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[k](x, y)) out[y][x] = !out[y][x];
    return out;
  };
  const pick = (k: number) => {
    drawFormat(k);
    return masked(k);
  };
  if (mask !== undefined) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) throw new Error("qrModules: a mask is 0 to 7");
    return pick(mask);
  }
  let best = 0;
  let bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    const s = penalty(pick(k));
    if (s < bestScore) (best = k), (bestScore = s);
  }
  return pick(best);
}

const SVG = "http://www.w3.org/2000/svg";

/** The QR code of `text` as an SVG element: dark modules on white, with a quiet zone of 4 modules. `label` names it for a screen reader. */
export function qrSvg(text: string, label: string): SVGSVGElement {
  const m = qrModules(text);
  const quiet = 4;
  const n = m.length + quiet * 2;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("class", "n133s-qr-code");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("shape-rendering", "crispEdges");
  // The modules each way, quiet zone included: the sign-in sheet's stylesheet makes each module a whole number of CSS pixels from it. (A style set
  // through the CSSOM: a strict CSP's style-src allows it.)
  svg.style.setProperty("--n133-qr-modules", String(n));
  const back = document.createElementNS(SVG, "rect");
  back.setAttribute("width", String(n));
  back.setAttribute("height", String(n));
  back.setAttribute("fill", "#ffffff");
  let d = "";
  m.forEach((row, y) => row.forEach((dark, x) => (d += dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : "")));
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#111318");
  svg.append(back, path);
  return svg;
}
