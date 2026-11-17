// The browser check of the try-on demo (not in `npm test`: it needs Chrome and Playwright, which the kit does not install). It proves what a fake
// DOM cannot: the tray's Buy and a row's Buy open the SAME pay sheet in test mode (the same look, the same price, the stamp, no QR code), and the
// stage's keys stand whole in the stage at each size. Usage, with the demo served (node test/tryon-demo/serve.mjs 18911):
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node test/tryon-demo/check.mjs [port]
//
// Real Chrome (`channel: "chrome"`), the sandbox on, headless. Every host but 127.0.0.1 is blocked, and no page may take a real pointer lock (a
// headless pointer lock holds the computer's real cursor): the init script below stands in for it. Exit code 0: every check passed.
const port = Number(process.argv[2] ?? 18911);
const base = `http://127.0.0.1:${port}/`;
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright").catch(() => {
  console.error("Playwright not found: set PLAYWRIGHT to its index.mjs");
  process.exit(2);
});

const NO_POINTER_LOCK = `(() => {
  let el = null;
  const fire = () => document.dispatchEvent(new Event("pointerlockchange"));
  Object.defineProperty(Document.prototype, "pointerLockElement", { get: () => el, configurable: true });
  Element.prototype.requestPointerLock = function () { el = this; queueMicrotask(fire); return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { if (el) { el = null; queueMicrotask(fire); } };
})();`;

const fails = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

const browser = await chromium.launch({ channel: "chrome", chromiumSandbox: true, headless: true });
try {
  for (const [w, h] of [[390, 844], [844, 390], [320, 640], [820, 1180], [1440, 900]]) {
    const phone = w < 700 || h < 500;
    const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone });
    await context.addInitScript({ content: NO_POINTER_LOCK });
    if (process.env.INIT_SCRIPT) await context.addInitScript({ path: process.env.INIT_SCRIPT });
    const offHost = [];
    await context.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : (offHost.push(route.request().url()), route.abort())));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base);
    await page.waitForFunction(() => window.demo);
    await page.evaluate(() => window.demo.shop.open());
    await page.waitForFunction(() => document.querySelector(".n133s-tryon-stage.n133s-has-3d")?.dataset.ready, null, { timeout: 15000 });
    const at = `${w}x${h}`;
    // four looks tried on: the tray is full, the stage at its smallest
    for (const [id, tab] of [["royal", null], ["straw-hat", "Hats"], ["red-scarf", "Scarves"], ["explorer-pack", "Packs"]]) {
      if (tab) await page.locator(".n133s-tab", { hasText: tab }).first().click();
      await page.locator(`.n133s-try[data-look="${id}"]`).click();
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(500);
    const keys = await page.evaluate(() => {
      const box = document.querySelector(".n133s-tryon-stage");
      const s = box.getBoundingClientRect();
      const shown = [...box.querySelectorAll(".n133s-stage-key")].filter((k) => k.getClientRects().length);
      const out = shown.filter((k) => {
        const q = k.getBoundingClientRect();
        return q.left < s.left - 1 || q.right > s.right + 1 || q.top < s.top - 1 || q.bottom > s.bottom + 1;
      });
      return { shown: shown.length, out: out.length };
    });
    check(keys.out === 0 && (keys.shown === 4 || keys.shown === 0), `${at}: the stage's keys are all whole in the stage, or all hidden (${keys.shown} shown, ${keys.out} out)`);
    // the tray's Buy, then a row's Buy: the same pay sheet
    const paySheet = () =>
      page.evaluate(() => {
        const sheet = document.querySelector(".n133s-sheet");
        return { title: sheet.querySelector(".n133s-title")?.textContent, amount: sheet.querySelector(".n133s-amount-row strong")?.textContent, usd: sheet.querySelector(".n133s-usd")?.textContent, stamp: sheet.textContent.includes("TEST MODE: DO NOT PAY"), qr: !!sheet.querySelector(".n133s-qr svg"), test: !!sheet.querySelector(".n133s-pay.n133s-is-test") };
      });
    await page.locator('.n133s-tray [data-buy="straw-hat"]').click();
    await page.waitForSelector(".n133s-pay");
    await page.waitForTimeout(300);
    const fromTray = await paySheet();
    await page.evaluate(() => (window.demo.shop.close(), window.demo.shop.open()));
    await page.locator(".n133s-tab", { hasText: "Hats" }).first().click();
    await page.locator('.n133s-looks .n133s-buy[data-look="straw-hat"]').click();
    if (await page.locator(".n133s-offer-key").count()) await page.locator(".n133s-offer-key").click();
    await page.waitForSelector(".n133s-pay");
    await page.waitForTimeout(300);
    const fromRow = await paySheet();
    check(fromTray.stamp && fromTray.test && !fromTray.qr && fromTray.title === "Straw Sun Hat" && fromTray.usd === "= $0.10" && fromTray.amount === "0.1 XNO", `${at}: the tray's Buy opens the pay sheet in test mode (${JSON.stringify(fromTray)})`);
    check(JSON.stringify(fromTray) === JSON.stringify(fromRow), `${at}: a row's Buy opens the same pay sheet (${JSON.stringify(fromRow)})`);
    const sent = await page.evaluate(() => ({ requests: window.demo.requests.slice(), wears: window.demo.wears.length }));
    check(sent.requests.every((r) => r === "POST /api/orders") && sent.requests.length === 2 && sent.wears === 0, `${at}: only the two orders left the sheet, nothing worn (${sent.requests.join(", ")})`);
    check(errors.length === 0, `${at}: no page error ${errors.join(" | ")}`);
    check(offHost.length === 0, `${at}: no request beyond 127.0.0.1 ${offHost.join(" ")}`);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(fails.length ? `${fails.length} check(s) failed` : "every check passed");
process.exit(fails.length ? 1 : 0);
