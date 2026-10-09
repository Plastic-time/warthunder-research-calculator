const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const express = require('express');
const {chromium} = require('playwright');

async function main() {
  const output = path.resolve('logs/tree-navigation-check');
  fs.mkdirSync(output, {recursive: true});
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({channel: 'chrome', headless: true});
    for (const mode of ['local', 'pages']) for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({viewport: {width, height: 900}, isMobile: width < 720, hasTouch: width < 720});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('.country-trigger')?.disabled === false && document.querySelector('.unit-tile'));
      assert.equal(await page.locator('#countrySelect').isVisible(), false);
      assert.equal(await page.locator('#typeSelect').isVisible(), false);
      assert.equal(await page.locator('.branch-tab').count(), 5);
      assert.equal(await page.locator('.country-choice').count(), 10);
      assert(!/美国|陆战/.test(await page.locator('#statusText').innerText()));
      const saved = await page.evaluate(() => {
        const target = state.units.find(unit => parseNumber(unit.rp) > 0 && unit.section === 'researchable');
        toggleUnitMode(target.data_unit_id, 'target');
        return {id: target.data_unit_id, rp: els.budgetRp.textContent, sl: els.budgetSl.textContent};
      });
      await page.locator('.country-trigger').click();
      await page.waitForFunction(() => [...document.querySelectorAll('.country-choice img')].every(image => image.complete && image.naturalWidth > 0));
      const box = await page.locator('#countryPicker').boundingBox();
      assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 901);
      if (width < 720) assert(Math.abs(box.y + box.height - 900) < 2);
      await page.screenshot({path: path.join(output, `${mode}-${width}-countries.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.country-trigger').getAttribute('aria-expanded'), 'false');
      assert(await page.locator('.country-trigger').evaluate(element => element === document.activeElement));
      await page.locator('.country-trigger').click();
      await page.mouse.click(width - 2, 2);
      await page.waitForFunction(() => !document.querySelector('#countryPicker').open);
      await page.locator('.country-trigger').click();
      await page.locator('.country-picker-close').click();
      await page.waitForFunction(() => !document.querySelector('#countryPicker').open);
      await page.locator('.country-trigger').click();
      await page.locator('[data-country="israel"]').click();
      await page.waitForFunction(() => state.country === 'israel' && !document.querySelector('.country-trigger').disabled);
      assert.equal(await page.locator('.country-current').innerText(), '以色列');
      await page.locator('[data-type="aviation"]').click();
      await page.waitForFunction(() => state.type === 'aviation' && !document.querySelector('.country-trigger').disabled);
      assert.equal(await page.locator('.branch-tab[aria-pressed="true"]').getAttribute('data-type'), 'aviation');
      assert(await page.locator('.unit-tile').count() > 10);
      await page.waitForFunction(() => [...document.querySelectorAll('.unit-tile img')].slice(0, 5).every(image => image.complete && image.naturalWidth > 0));
      await page.screenshot({path: path.join(output, `${mode}-${width}-tree.png`)});
      await page.locator('.country-trigger').click();
      await page.locator('[data-country="usa"]').click();
      await page.waitForFunction(() => state.country === 'usa' && !document.querySelector('.country-trigger').disabled);
      for (const type of ['helicopters', 'ships', 'boats', 'ground']) {
        await page.locator(`[data-type="${type}"]`).click();
        await page.waitForFunction(expected => state.type === expected && !document.querySelector('.country-trigger').disabled, type);
        assert(await page.locator('.unit-tile').count() > 0);
      }
      const restored = await page.evaluate(id => ({selected: state.planned.has(id), rp: els.budgetRp.textContent, sl: els.budgetSl.textContent}), saved.id);
      assert(restored.selected);
      assert.equal(restored.rp, saved.rp);
      assert.equal(restored.sl, saved.sl);
      const route = mode === 'pages' ? '**/database/usa/usa_aviation.json*' : '**/api/tree/usa/aviation';
      let failedRequests = 0;
      // Fail the existing data loader, then verify controls unlock for recovery.
      await page.route(route, request => { failedRequests += 1; return request.abort(); });
      await page.locator('[data-type="aviation"]').click();
      await page.waitForFunction(() => !document.querySelector('.country-trigger').disabled);
      assert(failedRequests > 0, 'The failure test must intercept a data request');
      await page.unroute(route);
      await page.locator('[data-type="ground"]').click();
      await page.waitForFunction(() => state.type === 'ground' && !document.querySelector('.country-trigger').disabled);
      assert(await page.locator('.unit-tile').count() > 0);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({mode, width, flags: 10, branches: 5, savedPlanPreserved: true, escape: true, passed: true}));
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error.stack); process.exitCode = 1;});
