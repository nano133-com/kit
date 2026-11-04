// Layout rules that happy-dom cannot measure, read from the stylesheets' text: where the shop's refund words stand in each layout of the pay sheet.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Rule = { at: string; selector: string; body: string };

/** The rules of a stylesheet, each with the @media or @container it stands in ("" at the top). Comments are dropped; one level of nesting. */
function cssRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  let i = 0;
  const block = (from: number): number => {
    let depth = 0;
    for (let j = from; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) return j;
    }
    return text.length;
  };
  const read = (part: string, at: string) => {
    for (const m of part.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ at, selector: m[1].trim().replace(/\s+/g, " "), body: m[2] });
  };
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    if (head.startsWith("@")) {
      const end = block(open);
      read(text.slice(open + 1, end), head.replace(/\s+/g, " "));
      i = end + 1;
    } else {
      const end = text.indexOf("}", open);
      out.push({ at: "", selector: head.replace(/\s+/g, " "), body: text.slice(open + 1, end) });
      i = end + 1;
    }
  }
  return out;
}

/** The value of a property in a rule's body, or null. */
const prop = (r: Rule | undefined, name: string): string | null => {
  const m = r ? new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`).exec(r.body) : null;
  return m ? m[1].trim() : null;
};

const SHOP = cssRules(readFileSync(new URL("../src/shop/panel/style.css", import.meta.url), "utf8"));
const LANDSCAPE = "@media (orientation: landscape) and (max-height: 520px)";
const find = (rules: Rule[], at: string, selector: string) => rules.find((r) => r.at === at && r.selector === selector);

test("the shop's pay sheet: the refund words stand above the pay box in every layout, and the sheet's body scrolls", () => {
  // A phone held up, a tablet and a wide screen: the pay sheet is one column in the DOM's order (the refund words before the QR code: shop-panel.test.ts).
  const main = find(SHOP, "", ".n133-shop .n133s-pay-main");
  assert.equal(prop(main, "display"), null, "one column: no grid at the top");
  for (const at of ["", "@media (min-width: 700px)"]) assert.ok(!SHOP.some((r) => r.at === at && /n133s-pay\b/.test(r.selector) && /grid-template-areas/.test(r.body)), `no grid for the pay sheet at "${at}"`);
  // A phone on its side: a grid with the refund words' own row first, across both columns, above the QR code ("qr") and the wallet key ("side").
  const grid = find(SHOP, LANDSCAPE, ".n133-shop .n133s-pay");
  assert.equal(prop(grid, "display"), "grid");
  const rows = [...prop(grid, "grid-template-areas")!.matchAll(/"([^"]+)"/g)].map((m) => m[1].split(/\s+/));
  assert.deepEqual(rows[0], ["refund", "refund"], "the first row is the refund words'");
  assert.ok(rows.slice(1).some((r) => r.includes("qr")) && rows.slice(1).some((r) => r.includes("side")), "the QR code and the wallet key come after");
  assert.equal(prop(grid, "grid-template-rows")!.split(/\s+/).length, rows.length, "a row size for each row");
  assert.equal(prop(find(SHOP, LANDSCAPE, ".n133-shop .n133s-pay-main"), "display"), "contents");
  assert.equal(prop(find(SHOP, LANDSCAPE, ".n133-shop .n133s-pay .n133s-refund"), "grid-area"), "refund", "the refund words have their place in the grid");
  // Every child of the grid has an area: none is put in a row after the last by itself.
  for (const cls of ["n133s-pay-what", "n133s-amount", "n133s-pay-side"]) assert.ok(SHOP.some((r) => r.at === LANDSCAPE && r.selector.endsWith(`.${cls}`) && prop(r, "grid-area")), cls);
  assert.ok(SHOP.some((r) => r.at === LANDSCAPE && r.selector.includes(".n133s-live-pay") && r.selector.includes(".n133s-test-pay") && prop(r, "grid-area") === "qr"));
  // The body scrolls, so a long text is never cut by the sheet's edge.
  const body = find(SHOP, "", ".n133-shop .n133s-body");
  assert.equal(prop(body, "overflow"), "auto");
  assert.equal(prop(body, "min-height"), "0");
  assert.equal(prop(find(SHOP, "", ".n133-shop .n133s-refund"), "overflow-wrap"), "anywhere", "a long word breaks, never runs off the side");
});

const ADMIN = cssRules(readFileSync(new URL("../src/admin/panel/style.css", import.meta.url), "utf8"));

test("the admin's Orders: the name keeps its width and wraps, the payer line wraps in at most half the card, the price never runs over it", () => {
  const card = find(ADMIN, "", ".n133-admin .order");
  const [left, right] = prop(card, "grid-template-columns")!.split(/\s+(?![^(]*\))/);
  assert.equal(left, "minmax(0, 1fr)");
  assert.match(right, /^fit-content\((?:[1-5]\d|60)%\)$/, "the status and \"when\" column is capped, so it cannot squeeze the name and the price to nothing");
  const name = find(ADMIN, "", ".n133-admin .order-look strong");
  assert.equal(prop(name, "white-space"), null, "the name wraps (no nowrap)");
  assert.equal(prop(name, "text-overflow"), null, "never cut to \"Extra r…\"");
  assert.equal(prop(name, "overflow-wrap"), "anywhere");
  assert.equal(prop(find(ADMIN, "", ".n133-admin .order-look"), "flex-wrap"), "wrap", "the Round mark goes under a long name");
  const when = find(ADMIN, "", ".n133-admin .order-when");
  assert.equal(prop(when, "overflow-wrap"), "anywhere", "a long nano_ address breaks anywhere");
  assert.equal(prop(when, "min-width"), "0");
  const amount = find(ADMIN, "", ".n133-admin .order-amount");
  assert.equal(prop(amount, "white-space"), null, "the amount's box may wrap, so it stays in its own column");
  assert.equal(prop(amount, "flex-wrap"), "wrap");
  assert.equal(prop(find(ADMIN, "", ".n133-admin .order-amount > *"), "white-space"), "nowrap", "\"0.05 XNO\" and \"$0.05\" each stay whole");
  // The table (a wide panel: an iPad, a phone on its side in a wide panel, a computer): every column can shrink, and no cell is cut on one line.
  const table = find(ADMIN, "@container n133 (min-width: 760px)", ".n133-admin .order-table-head, .n133-admin .orders:not(.is-compact) .order");
  for (const col of prop(table, "grid-template-columns")!.split(/\s+(?![^(]*\))/)) assert.ok(/^minmax\(0, [\d.]+fr\)$|^\d+px$/.test(col), col);
  assert.ok(!ADMIN.some((r) => /\.order-(look|when)\b/.test(r.selector) && /nowrap|ellipsis/.test(r.body)), "no name or \"when\" rule keeps one line");
});

test("the admin's tap targets: every key, tab, segment, switch and summary is at least 44 px high, in every layout", () => {
  const TARGET = /(?:^|[.\s])(?:btn|btn-small|seg-btn|tabbar-tab|link-key|copy-key|theme-choice|theme-summary|switch|ladder-step|swatch-btn|hat-choice|colour|input|shelf-add-tile)(?![\w-])|^summary\b|\ssummary\b/;
  const small: string[] = [];
  for (const r of ADMIN) {
    for (const one of r.selector.split(/\s*,\s*/)) {
      // The last part of the selector is what the rule sizes: ".switch .switch-knob" sizes the knob inside the 44 px switch, not the switch.
      const last = one.split(/\s+|>|\+|~/).filter(Boolean).pop() ?? "";
      if (!TARGET.test(` ${last.replace(/:[\w-]+(\([^)]*\))?/g, "")}`)) continue;
      for (const name of ["min-height", "height"]) {
        const v = prop(r, name);
        const px = v && /^(\d+(?:\.\d+)?)px$/.exec(v);
        if (px && Number(px[1]) < 44) small.push(`${r.at} ${one} { ${name}: ${v} }`.trim());
      }
    }
  }
  assert.deepEqual(small, [], "a tap target under 44 px");
  for (const sel of [".n133-admin .btn", ".n133-admin .btn-small", ".n133-admin .seg-btn", ".n133-admin .tabbar-tab"]) assert.equal(prop(find(ADMIN, "", sel), "min-height"), "44px", sel);
});

test("the admin's sticky tabs never cover a heading the page scrolls to: the tab panels and the cards keep a margin as high as the tabs, and a little more", () => {
  const room = prop(find(ADMIN, "", ".n133-admin"), "--tabs-room");
  assert.ok(room, "the room for the tabs is one value");
  // The tab bar: 44 px keys + 6 px padding each side + 1 px border each side = 58 px; on a narrow panel 54 px + 4 px each side + 2 = 64 px.
  assert.ok(Number(/^(\d+)px$/.exec(room!)![1]) >= 64 + 8, `${room} is the tabs' height (64 px on a phone) and a little more`);
  const rule = ADMIN.find((r) => r.at === "" && /\.tabpanel/.test(r.selector) && /\.admin-card/.test(r.selector) && prop(r, "scroll-margin-top") === "var(--tabs-room)");
  assert.ok(rule, "the tab panels and the cards the Overview scrolls to (\"To send back\") keep the room");
  assert.equal(prop(find(ADMIN, "", ".n133-admin .tabbar"), "position"), "sticky");
});
