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
