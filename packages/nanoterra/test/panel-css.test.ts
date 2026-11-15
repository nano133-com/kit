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

test("the shop's pay sheet: the refund words stand above the amount and every way to pay in every layout, and the sheet's body scrolls", () => {
  // A phone held up, a tablet and a wide screen: the refund words are in the top part, before the amount and the ways to pay in the DOM's order
  // (shop-panel.test.ts); only a computer's layout has a grid (the QR code's column beside the words), and it is inside the body, under the top part.
  for (const at of ["", "@media (min-width: 700px)"]) assert.ok(!SHOP.some((r) => r.at === at && /n133s-pay\b/.test(r.selector) && /grid-template-areas/.test(r.body)), `no grid of areas for the pay sheet at "${at}"`);
  assert.equal(prop(find(SHOP, "@media (min-width: 700px)", '.n133-shop .n133s-pay[data-main="qr"] .n133s-pay-body'), "display"), "grid");
  // A phone on its side: two columns; the top part (the item and the refund words) first on the left, then the amount; the ways to pay on the right.
  const grid = find(SHOP, LANDSCAPE, '.n133-shop .n133s-pay:not([data-state="paid"])');
  assert.equal(prop(grid, "display"), "grid");
  const rows = [...prop(grid, "grid-template-areas")!.matchAll(/"([^"]+)"/g)].map((m) => m[1].split(/\s+/));
  assert.deepEqual(rows[0], ["bar", "bar"]);
  assert.deepEqual(rows[1], ["top", "act"], "the refund words' part is the first row of the words");
  assert.deepEqual(rows[2], ["amount", "act"], "the amount after them");
  assert.deepEqual(rows[3], ["amount", "fine"], "the fine lines under the ways to pay");
  assert.equal(prop(grid, "grid-template-rows")!.split(/\s+/).length, rows.length, "a row size for each row");
  assert.equal(prop(find(SHOP, LANDSCAPE, '.n133-shop .n133s-pay:not([data-state="paid"]) :is(.n133s-pay-body, .n133s-pay-words)'), "display"), "contents");
  for (const [cls, area] of [["n133s-pay-top", "top"], ["n133s-amount", "amount"], ["n133s-pay-act", "act"], ["n133s-fine-lines", "fine"], ["n133s-bar", "bar"]])
    assert.equal(prop(find(SHOP, LANDSCAPE, `.n133-shop .n133s-pay .${cls}`), "grid-area"), area, cls);
  // The body scrolls, so a long text is never cut by the sheet's edge.
  const body = find(SHOP, "", ".n133-shop .n133s-body");
  assert.equal(prop(body, "overflow"), "auto");
  assert.equal(prop(body, "min-height"), "0");
  assert.equal(prop(find(SHOP, "", ".n133-shop .n133s-refund, .n133-shop .n133s-pay .n133s-refund"), "overflow-wrap"), "anywhere", "a long word breaks, never runs off the side");
});

test("the shop's pay sheet: the ended order hides every way to pay; reduced motion (the device's and the options') stops every animation; a key is 48 px", () => {
  const ended = SHOP.find((r) => r.at === "" && r.selector.includes('[data-state="ended"]') && r.selector.includes('[data-state="late"]') && prop(r, "display") === "none");
  assert.ok(ended, "one rule hides the ways to pay of an ended order");
  for (const part of [".n133s-foot", ".n133s-by-hand", ".n133s-live-pay", ".n133s-copy"]) assert.ok(ended!.selector.includes(part), part);
  const animated = new Set(SHOP.filter((r) => prop(r, "animation")).map((r) => (r.selector.match(/\.n133s-[\w-]+(?:\s+i)?$/) ?? [""])[0]));
  const calmDevice = SHOP.find((r) => r.at === "@media (prefers-reduced-motion: reduce)" && prop(r, "animation") === "none");
  const calmOption = SHOP.find((r) => r.at === "" && r.selector.startsWith(':root[data-n133-opt-reduced-motion="true"]') && prop(r, "animation") === "none");
  for (const a of animated) {
    if (!a) continue;
    assert.ok(calmDevice!.selector.includes(a.replace(/\s+i$/, " i")), `the device's reduced motion stops ${a}`);
    assert.ok(calmOption!.selector.includes(a.replace(/\s+i$/, " i")), `Less motion stops ${a}`);
  }
  for (const sel of [".n133-shop .n133s-btn", ".n133-shop .n133s-by-hand summary"]) assert.equal(prop(find(SHOP, "", sel), "min-height"), "48px", sel);
  assert.equal(prop(find(SHOP, "", ".n133-shop .n133s-copy"), "width"), "48px");
  assert.ok(SHOP.some((r) => r.at === "@media (forced-colors: active)"), "a forced-colors (high contrast) rule set");
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

test("the admin's icon-only keys: where the wide Orders table hides the copy key's word, the key is still 44 px wide", () => {
  const hides = ADMIN.find((r) => /\.copy-word/.test(r.selector) && prop(r, "display") === "none");
  assert.ok(hides, "the wide table hides the word");
  const key = find(ADMIN, hides!.at, ".n133-admin .orders:not(.is-compact) .order-player .copy-key");
  const w = /^(\d+)px$/.exec(prop(key, "min-width") ?? "");
  assert.ok(w && Number(w[1]) >= 44, `min-width ${prop(key, "min-width")}`);
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

test("K4: the item's picture frame clips all the game's preview, a position: fixed element too (contain: paint), so it never covers the amount, the address or the QR code", () => {
  const pic = find(SHOP, "", ".n133-shop .n133s-pic");
  assert.equal(prop(pic, "overflow"), "hidden");
  assert.match(prop(pic, "contain") ?? "", /\b(paint|content|strict)\b/, "contain: paint makes the frame the box of a fixed child, and clips it");
});

// 0.17.1: the dark gem colour has two jobs. As a FILL (the passkey's row, a chosen Settings key, the main keys) its text is --n133-on-gem-dark; as TEXT on
// the paper or the ground (a link, "Signed in as", the worn ✓, the admin's marks) it is --n133-gem-text. One colour could not pass 4.5:1 both ways on a
// light sheet (Coin Bees: 4.58:1 one way, 3.43:1 the other). Both default to today's values, so a game that sets neither sees no change.
test("the dark gem colour's two jobs have their own tokens: no text in --gem-dark, no fill of --gem-dark with --on-gem text; the defaults are today's", () => {
  const SHEETS = ["player-signin/panel", "shop/panel", "options/panel", "friends/panel", "emotes/panel", "admin/panel"].map((p) => `src/${p}/style.css`).concat("src/connect/style.css");
  for (const file of SHEETS) {
    const rules = cssRules(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    for (const r of rules) {
      const where = `${file}: ${r.at} ${r.selector}`;
      assert.doesNotMatch(r.body, /(^|[;\s])color:\s*var\(--(n133-)?gem-dark\b/, `${where}: text in the dark gem colour (use --gem-text)`);
      assert.doesNotMatch(r.body, /--accent:\s*var\(--gem-dark\)/, `${where}: an accent text in the dark gem colour`);
      if (/(^|[;\s])background(-color)?:\s*var\(--gem-dark\)/.test(r.body) && /(^|[;\s])color:/.test(r.body)) assert.match(r.body, /(^|[;\s])color:\s*var\(--on-gem-dark\)/, `${where}: text on the dark gem fill`);
      if (/(^|[;\s])background(-color)?:\s*var\(--gem-dark\)/.test(r.body) && !/(^|[;\s])color:/.test(r.body) && /n133f-badge/.test(r.selector)) assert.fail(`${where}: the badge's count has no colour of its own`);
    }
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    if (/var\(--gem-text\)/.test(text)) {
      assert.match(text, /--gem-text: var\(--n133-gem-text, var\(--gem-dark\)\);/, `${file}: --gem-text defaults to the dark gem colour`);
      if (/--n133-dark-gem-dark/.test(text)) assert.match(text, /--gem-text: var\(--n133-dark-gem-text, var\(--gem-dark\)\);/, `${file}: and its dark twin`);
    }
    if (/var\(--on-gem-dark\)/.test(text)) assert.match(text, /--on-gem-dark: var\(--n133-on-gem-dark, (var\(--on-gem\)|#ffffff)\);/, `${file}: --on-gem-dark defaults to today's text on the fill`);
  }
  // The sheet's dark theme fills its main keys with --gem, so their text there is --on-gem, never the dark fill's.
  const signin = cssRules(readFileSync(new URL("../src/player-signin/panel/style.css", import.meta.url), "utf8"));
  for (const r of signin.filter((x) => /data-n133-theme/.test(x.selector) && /\.n133s-(pk|primary)$/.test(x.selector))) assert.match(r.body, /color: var\(--on-gem\)/, `${r.at} ${r.selector}`);
});

// 0.17.1: the page behind the connect card has a public token of its own. --n133-ground painted both the page and the tiles in the card (the address,
// the guard line), so the starter's builder painted the page with --nt-picture, a name the kit did not list.
test("the connect screens: --n133-page (and its dark twin) paints the page, defaulting to --n133-ground; the tiles keep --n133-ground; the picture has public names", () => {
  const rules = cssRules(readFileSync(new URL("../src/connect/style.css", import.meta.url), "utf8"));
  const light = rules.find((r) => r.at === "" && r.selector === ":root")!;
  const dark = rules.find((r) => r.at === "@media (prefers-color-scheme: dark)" && r.selector === ":root")!;
  assert.equal(prop(light, "--nt-bg"), "var(--n133-page, var(--n133-ground, #eef2f7))");
  assert.equal(prop(dark, "--nt-bg"), "var(--n133-dark-page, var(--n133-dark-ground, #0f151e))");
  assert.equal(prop(light, "--nt-tile"), "var(--n133-ground, #eef2f7)", "the tiles stay on the ground");
  assert.equal(prop(dark, "--nt-tile"), "var(--n133-dark-ground, #0f151e)");
  assert.equal(prop(light, "--nt-picture"), "var(--n133-page-picture, none)");
  assert.equal(prop(light, "--nt-picture-tall"), "var(--n133-page-picture-tall, var(--nt-picture))");
  assert.equal(prop(light, "--nt-dim"), "var(--n133-page-dim, none)");
  // The page's layers: the dim, the picture and the ground, on the html and on the fixed layer behind a long page.
  const bodyBefore = rules.filter((r) => r.selector === "body::before");
  assert.ok(bodyBefore.length >= 2 && bodyBefore.every((r) => /var\(--nt-bg\)\s*$/.test(prop(r, "background") ?? "")), "the ground is the last layer");
  assert.match(prop(rules.find((r) => r.selector === "html"), "background") ?? "", /var\(--nt-bg\)/);
});

test("the sign-in sheet's QR code: a size of its own (--n133-qr-size, the weight of one class), and qrSvg's code in whole CSS pixels a module", () => {
  const rules = cssRules(readFileSync(new URL("../src/player-signin/panel/style.css", import.meta.url), "utf8"));
  const base = rules.find((r) => r.at === "" && r.selector === ".n133-signin :where(.n133s-qr svg, .n133s-qr canvas, .n133s-qr img)");
  assert.equal(prop(base, "width"), "var(--n133-qr-size, min(336px, 100%))");
  assert.equal(prop(base, "shape-rendering"), "crispEdges");
  const snap = rules.find((r) => r.at === "@supports (width: round(down, 10px, 1px))" && r.selector === ".n133-signin :where(.n133s-qr svg.n133s-qr-code)");
  assert.match(prop(snap, "width") ?? "", /^calc\(var\(--n133-qr-modules\) \* min\(round\(nearest, var\(--n133-qr-size, 336px\) \/ var\(--n133-qr-modules\), 1px\), round\(down, 100% \/ var\(--n133-qr-modules\), 1px\)\)\)$/);
});
