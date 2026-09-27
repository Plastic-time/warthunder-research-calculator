const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { vehicleIds } = require('./update-rafale-modifications.cjs');
async function main() {
  const output = path.resolve('logs/rafale-prerequisites-check');
  fs.mkdirSync(output, { recursive: true });
  let server, browser;
  try {
    let endpoints = [['remote', process.argv[2]]];
    if (!process.argv[2]) {
      const app = express();
      app.use('/pages', express.static(path.resolve('docs')));
      app.use(require('../main'));
      server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = 'http://127.0.0.1:' + server.address().port;
      endpoints = [['local', base + '/'], ['pages', base + '/pages/']];
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const [mode, url] of endpoints) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 960 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => ModificationWorkbench.hasVehicle('rafale_c_f3'));
      await page.evaluate(() => {
        const plan = ModificationPlanner.plan;
        ModificationPlanner.plan = (...args) => { const result = plan(...args); window.testModResult = result; return result; };
      });
      for (const id of vehicleIds) {
        await page.evaluate(async id => {
          localStorage.setItem('wt-research:modifications:' + id, JSON.stringify({
            selected: [], researched: ['hydravlic_power', 'structure_str', 'f_4c_g_suit'],
          }));
          await ModificationWorkbench.open(id);
        }, id);
        await page.waitForFunction(() => document.querySelectorAll('.modification-link').length === 2);
        const mica = page.locator('[data-mod-id="fr_mica_em"]');
        await mica.scrollIntoViewIfNeeded();
        await mica.click();
        await page.locator('[data-modification-action="calculate"]').click();
        assert.deepEqual(await page.evaluate(() => testModResult.includedIds), ['fr_mica_em']);
        assert.deepEqual(await page.evaluate(() => testModResult.dependencyIds), []);
        assert.equal(await page.locator('#modificationRp').innerText(), '15,000');
        assert.equal(await page.locator('#modificationSl').innerText(), '23,000');
        assert.equal(await page.locator('.modification-link').count(), 2);
        await page.screenshot({ path: path.join(output, mode + '-' + width + '-' + id + '.png') });
        await page.locator('[data-modification-action="clear"]').click();
        const bomb = page.locator('[data-mod-id="fr_aasm_250_sbu_54"]');
        await bomb.scrollIntoViewIfNeeded();
        await bomb.click();
        await page.locator('[data-modification-action="calculate"]').click();
        const required = await page.evaluate(() => testModResult.dependencyIds);
        assert(required.includes('us_gbu_laser'));
        assert(required.includes(id === 'rafale_m_f3r' ? 'fr_talios_pod' : 'fr_damocles_pod'));
        await page.locator('[data-modification-close]').click();
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, width, variants: vehicleIds.length, micaWithoutCannon: true, realArrows: 2, laserPrerequisites: true, passed: true }));
      await page.close();
    }
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
