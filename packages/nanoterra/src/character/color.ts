// A colour helper with no imports at all, so the closed lists (lists.ts) and the record (record.ts) load nowhere near three.

/** A colour from hue (0 to 1), saturation and lightness (0 to 1) as a "#rrggbb" string: CSS's hsl(), for the room blob's swatches. */
export function hsl(h: number, s: number, l: number) {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}
