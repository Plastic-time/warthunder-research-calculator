const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const output = path.resolve('logs/site-locales');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const mode of ['local', 'pages']) for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 940 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('.unit-tile') && !document.querySelector('.country-trigger').disabled);
      const selection = await page.evaluate(() => {
        const unit = state.units.find(unit => unit.section === 'researchable' && parseNumber(unit.rp) > 0);
        toggleUnitMode(unit.data_unit_id, 'target');
        runExactPlan();
        return unit.data_unit_id;
      });
      await page.waitForFunction(() => !els.planButton.disabled);
      const baseline = await page.evaluate(() => JSON.stringify({ planned: [...state.planned], owned: [...state.owned],
        waypoints: [...state.waypoints], selected: state.planResult.selectedIds,
        fillers: state.planResult.fillerIds, rp: state.planResult.totalRp, sl: state.planResult.totalSp }));
      for (const language of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        // The select lives in a sheet (More on desktop, Filters on mobile), so drive it without opening one.
        await page.locator('#languageSelect').evaluate((select, value) => {
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }, language);
        await page.evaluate(() => document.fonts.ready);
        const main = await page.evaluate(() => ({ locale: state.language, html: document.documentElement.lang,
          guide: els.guideButton.textContent, expectedGuide: tr('使用指南'),
          plan: els.planButton.querySelector('[data-plan-button-label]').textContent, expectedPlan: tr('精确规划'),
          missing: [...WTI18n.missing],
          preserved: JSON.stringify({ planned: [...state.planned], owned: [...state.owned], waypoints: [...state.waypoints],
            selected: state.planResult.selectedIds, fillers: state.planResult.fillerIds, rp: state.planResult.totalRp, sl: state.planResult.totalSp }),
          overflow: document.documentElement.scrollWidth > innerWidth,
          targetTitle: displayTitle(state.units.find(unit => state.planned.has(unit.data_unit_id))) }));
        assert.equal(main.locale, language);
        assert.equal(main.guide, main.expectedGuide);
        assert.equal(main.plan, main.expectedPlan);
        assert.equal(main.preserved, baseline, 'Language changes must preserve planning');
        assert(!main.overflow, 'No page-wide overflow');
        assert.deepEqual(main.missing, [], 'Missing main translation keys');
        const search = await page.evaluate(id => {
          const expected = state.localizedNames[id][state.language];
          const unit = state.unitMap.get(id);
          state.search = expected;
          els.searchInput.value = expected;
          renderTree();
          const found = unitMatchesSearch(unit) && !!document.querySelector(`[data-unit-id="${id}"]`);
          state.search = '';
          els.searchInput.value = '';
          renderTree();
          return { expected, shown: displayTitle(unit), found };
        }, selection);
        assert.equal(search.shown, search.expected, 'Vehicle names must use the chosen game locale');
        assert(search.found, 'Search must find localized names');
        await page.locator('#guideButton').click();
        assert(await page.locator('#usageGuideDialog').evaluate(dialog => dialog.open));
        const guideCopy = await page.locator('#usageGuideDialog').innerText();
        assert(guideCopy.includes(main.plan), `${language}: guide must name the planning button`);
        await page.screenshot({ path: path.join(output, `${mode}-${width}-${language}-guide.png`) });
        await page.locator('[data-guide-close]').first().click();
        await page.evaluate(id => ModificationWorkbench.open(id), selection);
        await page.waitForSelector('.modification-tile');
        const modBefore = await page.evaluate(() => document.querySelector('.modification-tile:not(:disabled)')?.dataset.modId);
        if (modBefore) await page.locator(`.modification-tile[data-mod-id="${modBefore}"]`).click();
        const mod = await page.evaluate(() => ({ missing: [...WTI18n.missing], title: document.querySelector('#modificationDialog h2')?.textContent,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth }));
        assert.deepEqual(mod.missing, [], 'Missing modification translation keys');
        assert(!mod.horizontalOverflow);
        const tierFiller = await page.evaluate(() => WTI18n.t('等级补足', {}, 'modifications'));
        assert((await page.locator('.modification-legend').innerText()).includes(tierFiller));
        const clipped = await page.locator('.modification-actions button').evaluateAll(buttons => buttons.flatMap(button => {
          const range = document.createRange();
          range.selectNodeContents(button);
          const bounds = button.getBoundingClientRect();
          const text = range.getBoundingClientRect();
          return text.left < bounds.left - 1 || text.right > bounds.right + 1 || text.bottom > bounds.bottom + 1
            ? [button.textContent.trim()] : [];
        }));
        assert.deepEqual(clipped, [], `${mode}/${width}/${language}: modification button text must fit`);
        await page.screenshot({ path: path.join(output, `${mode}-${width}-${language}-modifications.png`) });
        await page.evaluate(() => document.getElementById('modificationDialog').close());
        await page.screenshot({ path: path.join(output, `${mode}-${width}-${language}-tree.png`) });
        console.log(JSON.stringify({ mode, width, language, preserved: true, missing: 0 }));
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('.unit-tile'));
      assert.equal(await page.locator('#languageSelect').inputValue(), 'es', 'Persist chosen language');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
