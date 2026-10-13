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
      const desktop = width > 720;
      // Language sits in the More sheet on desktop and beside the planning options in Filters on mobile.
      const planning = ['#dependencyModeSelect', '#avoidFoldedInput', '#selectTreeButton'];
      const groups = desktop
        ? [['#mobileMoreButton', 'mobileMore', ['#languageSelect']], ['#mobileFiltersButton', 'mobileFilters', planning]]
        : [['#mobileFiltersButton', 'mobileFilters', ['#languageSelect', ...planning]]];
      const setLocale = locale => page.locator('#languageSelect').evaluate((select, value) => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, locale);
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await setLocale(locale);
        const measured = {};
        for (const [trigger, sheet, controls] of groups) {
          await page.locator(trigger).click();
          const boxes = [];
          for (const selector of controls) {
            const locator = page.locator(selector);
            assert(await locator.isVisible(), selector);
            const box = await locator.boundingBox();
            assert(box.x >= 0 && box.x + box.width <= width, locale + ': horizontal clipping ' + selector);
            assert(box.y >= 0 && box.y + box.height <= 900, locale + ': vertical clipping ' + selector);
            boxes.push(box);
            measured[selector] = box;
          }
          for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
            const x = boxes[a], y = boxes[b];
            assert(x.x + x.width <= y.x || y.x + y.width <= x.x || x.y + x.height <= y.y || y.y + y.height <= x.y, locale + ': control overlap');
          }
          for (const selector of controls.filter(selector => selector.endsWith('Select'))) {
            const fits = await page.locator(selector).evaluate(el => {
              const s = getComputedStyle(el);
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d'); context.font = s.font;
              return context.measureText(el.selectedOptions[0].textContent).width <= el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - 18;
            });
            assert(fits, locale + ': selected text truncated ' + selector + ' at ' + width);
          }
          if (controls.includes('#avoidFoldedInput')) {
            const left = measured['#avoidFoldedInput'];
            const right = await page.locator('.select-tree-box').boundingBox();
            assert.equal(left.height, right.height);
            assert.equal(left.y, right.y, 'Selection checkboxes align');
          }
          if (['zh', 'en', 'de'].includes(locale)) await page.screenshot({ path: path.join(output, width + '-' + locale + '-' + sheet + '.png') });
          await page.locator('#' + sheet + ' .mobile-sheet-heading button').click();
        }
        const language = measured['#languageSelect'], scope = measured['#dependencyModeSelect'];
        assert.equal(language.height, 48);
        assert.equal(scope.height, language.height);
        if (!desktop && width >= 480) assert.equal(scope.y, language.y, 'Field baselines match');
        if (desktop) {
          const search = await page.locator('.tree-filters #searchInput').boundingBox();
          assert(search && search.x >= 0 && search.x + search.width <= width && search.width >= 160, locale + ': search field ' + JSON.stringify(search));
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), locale + ': no horizontal page scrolling');
        }
      }
      await setLocale('zh');
      await page.locator('#mobileFiltersButton').click();
      const input = page.locator('#avoidFoldedInput');
      await input.click();
      assert.equal(await input.evaluate(el => getComputedStyle(el).boxShadow), 'none');
      await input.click();
      const select = page.locator('#selectTreeButton');
      await select.click(); assert.equal(await select.getAttribute('aria-checked'), 'true');
      await select.click(); assert.equal(await select.getAttribute('aria-checked'), 'false');
      await page.locator('#mobileFilters .mobile-sheet-heading button').click();
      if (width < 721) await page.locator('#mobileSearchButton').click();
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
