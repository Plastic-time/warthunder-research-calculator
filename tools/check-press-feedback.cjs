const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const express = require('express');
const {chromium} = require('playwright');
const {checkMobileLongPress} = require('./check-mobile-long-press.cjs');

async function main() {
  const output = path.resolve('logs/press-feedback-check');
  fs.mkdirSync(output, {recursive: true});
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({channel: 'chrome', headless: true});
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const page = await browser.newPage({viewport: {width, height: 940}, isMobile: width < 720, hasTouch: width < 720});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('.unit-tile') && !document.querySelector('.country-trigger').disabled);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      const openMore = async () => {
        if (width < 720) await page.locator('#mobileMoreButton').click();
      };
      const closeSheet = async id => {
        await page.locator('#' + id + ' .mobile-sheet-heading button').click();
      };
      const probe = async selector => page.evaluate(async selector => {
        const control = document.querySelector(selector);
        if (!control) throw Error('Missing control: ' + selector);
        const rect = control.getBoundingClientRect();
        if (!rect.width || !rect.height || control.closest('dialog:not([open])')) throw Error('Hidden control: ' + selector);
        const point = {clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2};
        const before = [rect.width, rect.height];
        control.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 31, isPrimary: true, button: 0, pointerType: 'mouse', ...point}));
        await new Promise(resolve => setTimeout(resolve, 110));
        const surfaces = [control, ...control.querySelectorAll('[data-press-feedback]')];
        if (!surfaces.some(el => el.dataset.pressFeedback === 'pressed' && parseFloat(getComputedStyle(el).scale) < 1)) throw Error('No press: ' + selector + ' ' + JSON.stringify(surfaces.map(el => ({state:el.dataset.pressFeedback, scale:getComputedStyle(el).scale}))));
        if (control.matches('.unit-tile, .modification-tile')) {
          const r = control.getBoundingClientRect();
          if (r.width !== before[0] || r.height !== before[1]) throw Error('Card bounds changed');
        }
        control.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 31, isPrimary: true, button: 0, pointerType: 'mouse', ...point}));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (!surfaces.some(el => el.dataset.pressFeedback === 'release')) throw Error('No spring: ' + selector);
      }, selector);
      if (width < 720) {
        await page.locator('#guideButton').dispatchEvent('pointerdown', {pointerId: 31, isPrimary: true, button: 0});
        assert.equal(await page.locator('[data-press-feedback="pressed"]').count(), 0, 'Hidden menu items must not animate');
        for (const selector of ['#mobileMoreButton', '#mobileSearchButton', '#mobileFiltersButton']) await probe(selector);
      }
      await openMore();
      for (const selector of ['#guideButton', '#clearButton', '#routeExportButton']) await probe(selector);
      if (width < 720) {
        await closeSheet('mobileMore');
        await page.locator('#mobileFiltersButton').click();
      }
      await probe('.planner-option');
      if (width < 720) await closeSheet('mobileFilters');
      for (const selector of ['.country-trigger', '.branch-tab',
        '.tree-canvas .unit-tile', '[data-wiki-id]', '[data-modifications-id]', '[data-folder-key]']) await probe(selector);
      await openMore();
      await page.locator('#guideButton').click();
      if (width < 720) assert(!(await page.locator('#mobileMore').evaluate(el => el.open)));
      await probe('[data-guide-close]');
      await page.locator('[data-guide-close]').first().click();
      await page.locator('.country-trigger').click();
      await probe('.country-choice');
      await probe('.country-picker-close');
      await page.locator('.country-picker-close').click();

      const id = await page.evaluate(() => state.units.find(unit => parseNumber(unit.rp) > 0 && unit.section === 'researchable').data_unit_id);
      const card = page.locator(`.tree-canvas .unit-tile[data-unit-id="${id}"]`).first();
      await card.click({position: {x: 20, y: 70}});
      assert(await page.evaluate(id => state.planned.has(id), id));
      await page.waitForFunction(id => document.querySelector(`#treeContainer [data-unit-id="${id}"] [data-press-feedback="release"]`), id);
      await page.waitForTimeout(420);
      await page.locator(`[data-modifications-id="${id}"]`).first().click();
      await page.waitForSelector('.modification-tile:not(:disabled)');
      await probe('.modification-tile:not(:disabled)');
      await probe('[data-modification-action="calculate"]');
      await probe('[data-modification-close]');
      const mod = page.locator('.modification-tile:not(:disabled)').first();
      const modId = await mod.getAttribute('data-mod-id');
      await mod.click();
      await page.waitForFunction(id => document.querySelector(`[data-mod-id="${id}"].target [data-press-feedback="release"]`), modId);
      await page.waitForTimeout(420);
      await page.screenshot({path: path.join(output, `${mode}-${width}-modifications.png`)});
      await page.locator('[data-modification-close]').click();
      await page.waitForTimeout(450);
      await openMore();
      await page.locator('#clearButton').click();
      await page.waitForTimeout(450);
      assert(await page.evaluate(() => !state.planned.size));

      // Search fields and scroll ranges retain their native editing/drag behavior.
      await page.locator('#searchInput').dispatchEvent('pointerdown', {pointerId: 32, isPrimary: true, button: 0});
      assert.equal(await page.locator('#searchInput').getAttribute('data-press-feedback'), null);
      await page.locator('#searchInput').dispatchEvent('pointercancel', {pointerId: 32});
      await page.locator('#languageSelect').dispatchEvent('pointerdown', {pointerId: 34, isPrimary: true, button: 0});
      assert.equal(await page.locator('#languageSelect').getAttribute('data-press-feedback'), null);
      await page.locator('#languageSelect').dispatchEvent('pointercancel', {pointerId: 34});
      await page.locator('#treeScrollRange').dispatchEvent('pointerdown', {pointerId: 33, isPrimary: true, button: 0});
      assert.equal(await page.locator('#treeScrollRange').getAttribute('data-press-feedback'), null);
      await page.locator('#treeScrollRange').dispatchEvent('pointercancel', {pointerId: 33});
      if (width < 720) {
        const session = await page.context().newCDPSession(page);
        await checkMobileLongPress({evaluate: source => page.evaluate(source), call: (name, args) => session.send(name, args), artifacts: output, suffix: mode});
        await session.detach();
      }
      await page.waitForTimeout(450);
      await page.emulateMedia({reducedMotion: 'reduce'});
      await openMore();
      await page.locator('#guideButton').dispatchEvent('pointerdown', {pointerId: 34, isPrimary: true, button: 0});
      assert.equal(await page.locator('[data-press-feedback="pressed"]').count(), 0);
      await page.locator('#guideButton').dispatchEvent('pointercancel', {pointerId: 34});
      await page.locator('#guideButton').focus();
      await page.keyboard.press('Enter');
      assert(await page.locator('#usageGuideDialog').evaluate(el => el.open));
      await page.locator('[data-guide-close]').first().click();
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({mode, width, controlGroups: 16, replacedCards: true, cardBoundsFixed: true, keyboard: true, excludedInputs: true, passed: true}));
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error.stack); process.exitCode = 1;});
