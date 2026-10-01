const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.argv.find(value => /^https?:/.test(value)) || 'http://127.0.0.1:3020/';
async function main() {
  const output = path.resolve('logs/toolbar-polish');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [1440, 1100, 900, 721, 720, 480, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 721, hasTouch: width < 721, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading);
      if (width < 721) await page.locator('#mobileFiltersButton').click();
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await page.locator('#languageSelect').selectOption(locale);
        const controls = ['#languageSelect', '#dependencyModeSelect', '#avoidFoldedInput', '#selectTreeButton'];
        if (width > 720) controls.push('#searchInput');
        const boxes = [];
        for (const selector of controls) {
          const locator = page.locator(selector);
          assert(await locator.isVisible(), selector);
          const box = await locator.boundingBox();
          assert(box.x >= 0 && box.x + box.width <= width, locale + ': horizontal clipping ' + selector);
          assert(box.y >= 0 && box.y + box.height <= 900, locale + ': vertical clipping ' + selector);
          boxes.push(box);
        }
        for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
          const x = boxes[a], y = boxes[b];
          assert(x.x + x.width <= y.x || y.x + y.width <= x.x || x.y + x.height <= y.y || y.y + y.height <= x.y, locale + ': control overlap');
        }
        for (const selector of ['#languageSelect', '#dependencyModeSelect']) {
          const fits = await page.locator(selector).evaluate(el => {
            const s = getComputedStyle(el);
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d'); context.font = s.font;
            return context.measureText(el.selectedOptions[0].textContent).width <= el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - 18;
          });
          assert(fits, locale + ': selected text truncated ' + selector + ' at ' + width);
        }
        const language = await page.locator('#languageSelect').boundingBox();
        const scope = await page.locator('#dependencyModeSelect').boundingBox();
        assert.equal(language.height, width > 720 ? 40 : 48);
        assert.equal(scope.height, language.height);
        if (width > 720 || width >= 480) assert.equal(scope.y, language.y, 'Field baselines match');
        const left = await page.locator('#avoidFoldedInput').boundingBox();
        const right = await page.locator('.select-tree-box').boundingBox();
        assert.equal(left.height, right.height);
        assert.equal(left.y, right.y, 'Selection checkboxes align');
        if (width > 720) assert(await page.locator('.tree-filters').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'No horizontal toolbar scrolling');
        if (['zh', 'en', 'de'].includes(locale)) await page.screenshot({ path: path.join(output, width + '-' + locale + '.png') });
      }
      await page.locator('#languageSelect').selectOption('zh');
      const input = page.locator('#avoidFoldedInput');
      await input.click();
      assert.equal(await input.evaluate(el => getComputedStyle(el).boxShadow), 'none');
      await input.click();
      const select = page.locator('#selectTreeButton');
      await select.click(); assert.equal(await select.getAttribute('aria-checked'), 'true');
      await select.click(); assert.equal(await select.getAttribute('aria-checked'), 'false');
      if (width < 721) {
        await page.locator('#mobileFilters .mobile-sheet-heading button').click();
        await page.locator('#mobileSearchButton').click();
      }
      await page.locator('#searchInput').fill('M3');
      await page.waitForFunction(() => state.search === 'M3');
      await page.screenshot({ path: path.join(output, width + '-search.png') });
      if (width < 721) {
        await page.locator('.mobile-search-done').click();
        assert.equal(await page.locator('#mobileSearch').evaluate(el => el.open), false);
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, languages: 7, unclipped: true, controlsAligned: true, search: true, selection: true }));
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
