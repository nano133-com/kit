// The panel's small line icons, drawn as inline SVG with createElementNS (no icon font, no innerHTML: fine under a strict CSP). Each is 24 units square, drawn
// with the text colour (currentColor), and hidden from screen readers: the word next to it says what it is.

const NS = "http://www.w3.org/2000/svg";

type Shape = [tag: string, attrs: Record<string, string | number>];

const SHAPES = {
  overview: [["rect", { x: 3, y: 3, width: 7.5, height: 7.5, rx: 2 }], ["rect", { x: 13.5, y: 3, width: 7.5, height: 7.5, rx: 2 }], ["rect", { x: 3, y: 13.5, width: 7.5, height: 7.5, rx: 2 }], ["rect", { x: 13.5, y: 13.5, width: 7.5, height: 7.5, rx: 2 }]],
  shirt: [["path", { d: "M8.5 3.5 4 6 2.5 10.5l3.5 1.5V21h12v-9l3.5-1.5L20 6l-4.5-2.5a3.5 3.5 0 0 1-7 0Z" }]],
  receipt: [["path", { d: "M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21Z" }], ["path", { d: "M9 8h6M9 12h6M9 16h3" }]],
  players: [["circle", { cx: 9, cy: 8, r: 3.5 }], ["path", { d: "M2.5 20a6.5 6.5 0 0 1 13 0" }], ["path", { d: "M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8" }]],
  settings: [["circle", { cx: 12, cy: 12, r: 3 }], ["path", { d: "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" }]],
  coin: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 6.5v11M14.8 9.2a2.6 2.6 0 0 0-2.6-1.7h-.6a2.2 2.2 0 0 0 0 4.4h.8a2.2 2.2 0 0 1 0 4.4h-.7a2.6 2.6 0 0 1-2.6-1.7" }]],
  clock: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 7v5l3.5 2" }]],
  back: [["path", { d: "M9 6 4 11l5 5" }], ["path", { d: "M4 11h10.5a5.5 5.5 0 0 1 0 11H11" }]],
  tag: [["path", { d: "M3 12.2V4a1 1 0 0 1 1-1h8.2l8.6 8.6a1.5 1.5 0 0 1 0 2.1l-6.9 6.9a1.5 1.5 0 0 1-2.1 0Z" }], ["circle", { cx: 7.5, cy: 7.5, r: 1.5 }]],
  copy: [["rect", { x: 8, y: 8, width: 13, height: 13, rx: 2.5 }], ["path", { d: "M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8" }]],
  lock: [["rect", { x: 4.5, y: 10.5, width: 15, height: 10.5, rx: 2.5 }], ["path", { d: "M8 10.5V7.5a4 4 0 0 1 8 0v3" }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  search: [["circle", { cx: 10.5, cy: 10.5, r: 6.5 }], ["path", { d: "m15.5 15.5 5 5" }]],
  alert: [["path", { d: "M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" }], ["path", { d: "M12 9v4.5M12 17h.01" }]],
  check: [["path", { d: "m4.5 12.5 5 5 10-11" }]],
  external: [["path", { d: "M14 4h6v6M20 4l-9 9" }], ["path", { d: "M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" }]],
  refresh: [["path", { d: "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4" }], ["path", { d: "M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" }]],
  out: [["path", { d: "M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" }], ["path", { d: "M10 8l-4 4 4 4M6 12h10" }]],
  pencil: [["path", { d: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z" }], ["path", { d: "m13.5 6.5 4 4" }]],
  close: [["path", { d: "M6 6l12 12M18 6 6 18" }]],
  dup: [["rect", { x: 8, y: 8, width: 13, height: 13, rx: 2.5 }], ["path", { d: "M14.5 11.5v6M11.5 14.5h6M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8" }]],
  trash: [["path", { d: "M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" }]],
  sun: [["circle", { cx: 12, cy: 12, r: 4 }], ["path", { d: "M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" }]],
  moon: [["path", { d: "M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" }]],
  device: [["circle", { cx: 12, cy: 12, r: 8.5 }], ["path", { d: "M12 3.5a8.5 8.5 0 0 1 0 17Z", fill: "currentColor" }]],
  sparkle: [["path", { d: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" }]],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof SHAPES;

/** An icon of `size` CSS pixels (default 20). */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: `icon icon-${name}` })) svg.setAttribute(k, String(v));
  for (const [tag, attrs] of SHAPES[name] as Shape[]) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
}
