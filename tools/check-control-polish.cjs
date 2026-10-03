const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.argv.find(value => /^https?:/.test(value)) || 'http://127.0.0.1:3020/';
const output = path.resolve('logs/control-polish');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [320, 390, 720, 900, 1440]) {
      const mobile = width <= 720;
      const page = await browser.newPage({ viewport: { width, height: 940 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading);
      await page.evaluate(() => document.fonts.ready);
      const shell = page.locator('.tree-canvas .unit-tile-shell.has-modifications').first();
      const wiki = shell.locator('.unit-wiki-launch');
      const mods = shell.locator('.unit-modifications-launch');
      await wiki.scrollIntoViewIfNeeded();
      const a = await wiki.boundingBox(), b = await mods.boundingBox();
      for (const box of [a, b]) assert(box.width >= 44 && box.height >= 44, '44px card action target');
      assert(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'Wiki and modifications do not overlap');
      assert.equal(await wiki.locator('.wiki-bookmark').evaluate(el => el.getBoundingClientRect().width), 22, 'Bookmark stays small');
      for (const button of [wiki, mods]) {
        assert(await button.getAttribute('title'), 'Native tooltip remains');
        assert(await button.getAttribute('aria-label'), 'Accessible name remains');
        assert(await button.evaluate(el => {
          const r = el.getBoundingClientRect();
          return [[8, 8], [r.width - 8, 8], [8, r.height - 8], [r.width - 8, r.height - 8]]
            .every(([x, y]) => el.contains(document.elementFromPoint(r.x + x, r.y + y)));
        }), 'Invisible touch padding belongs to its action');
      }
      const planned = await page.evaluate(() => [...state.planned]);
      await wiki.click({ position: { x: 8, y: 8 } });
      assert(await page.locator('#wikiDialog').evaluate(el => el.open));
      await page.locator('[data-wiki-close]').click();
      await mods.click();
      await page.waitForSelector('.modification-tile');
      assert(await page.locator('#modificationDialog').evaluate(el => el.open));
      await page.locator('[data-modification-close]').click();
      assert.deepEqual(await page.evaluate(() => [...state.planned]), planned, 'Card actions do not select targets');

      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await page.evaluate(locale => WTI18n.setLocale(locale), locale);
        if (mobile) await page.locator('#mobileMoreButton').click();
        const controls = page.locator('.topbar-actions button:visible');
        for (const button of await controls.all()) {
          const metrics = await button.evaluate(el => {
            const r = el.getBoundingClientRect();
            return { height: r.height, x: r.x, right: r.right, fits: el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1 };
          });
          assert(metrics.height >= (mobile ? 48 : 40), 'Consistent action height');
          assert(metrics.x >= 0 && metrics.right <= width, 'Actions stay in viewport');
          assert(metrics.fits, locale + ': action text fits');
        }
        if (locale === 'zh') await page.screenshot({ path: path.join(output, width + '-actions.png') });
        if (mobile) await page.locator('#mobileMore .mobile-sheet-heading button').click();
      }
      await page.evaluate(() => WTI18n.setLocale('zh'));
      if (mobile) await page.locator('#mobileFiltersButton').click();
      const checkbox = page.locator('#avoidFoldedInput');
      await checkbox.click();
      assert.equal(await checkbox.evaluate(el => getComputedStyle(el).boxShadow), 'none');
      assert.equal(await checkbox.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
      await checkbox.click();
      await page.locator('#selectTreeButton').click();
      assert.equal(await page.locator('#selectTreeButton').getAttribute('aria-checked'), 'true');
      await page.locator('#selectTreeButton').click();
      assert.equal(await page.locator('#selectTreeButton').getAttribute('aria-checked'), 'false');
      if (mobile) await page.locator('#mobileFilters .mobile-sheet-heading button').click();
      await page.keyboard.press('Tab');
      await mods.focus();
      assert.equal(await mods.evaluate(el => getComputedStyle(el).outlineStyle), 'solid', 'Keyboard focus remains visible');
      await page.keyboard.press('Enter');
      assert(await page.locator('#modificationDialog').evaluate(el => el.open));
      await page.locator('[data-modification-close]').click();
      await page.mouse.click(1, 1);
      await page.waitForFunction(() => {
        const img = document.querySelector('.tree-canvas .unit-tile > img');
        return img?.complete && img.naturalWidth > 0;
      });
      await page.screenshot({ path: path.join(output, width + '-tree.png') });
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, languages: 7, hitTargets: true, keyboard: true, cardActions: true, noGreenRing: true }));
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
