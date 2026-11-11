const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');
const fixture = require('../config/eagles-shadow-aircraft.json');
async function main() {
  const app = express();
  app.use('/pages', express.static(path.resolve('docs'))); app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 940 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`);
      await page.waitForFunction(() => typeof state !== 'undefined' && state.units.length && !treeSelectionLoading);
      for (const c of fixture.units) {
        await page.evaluate(async country => { els.countrySelect.value = country; els.typeSelect.value = 'aviation'; await loadTree(); }, c.country);
        await page.waitForFunction(id => state.unitMap.has(id) && !treeSelectionLoading && window.ModificationWorkbench?.hasVehicle(id), c.id);
        const actual = await page.evaluate(id => { const u = state.unitMap.get(id); return [u.rp,u.sp,u.required_unit_id]; }, c.id);
        assert.deepEqual(actual, [c.unit.rp,c.unit.sp,c.unit.required_unit_id]);
        const card = page.locator('.unit-tile[data-unit-id="' + c.id + '"]');
        await card.scrollIntoViewIfNeeded();
        await card.locator('img').first().evaluate(img => img.decode());
        if (!c.unit.is_premium) {
          await page.evaluate(id => { els.clearButton.click(); toggleUnitMode(id, 'target'); }, c.id);
          assert.equal(await card.getAttribute('data-plan-state'), 'target');
        }
        await page.evaluate(id => ModificationWorkbench.open(id), c.id);
        await page.waitForFunction(() => document.getElementById('modificationDialog').dataset.loadState === 'ready');
        const dialog = page.locator('#modificationDialog');
        await dialog.locator('[data-modification-action="clear"]').click();
        await dialog.locator('[data-modification-action="all"]').click();
        const totals = await page.evaluate(() => [document.getElementById('modificationRp').textContent,document.getElementById('modificationSl').textContent]);
        assert.deepEqual(totals, c.modification.t.map(n => n.toLocaleString('en-US')), c.id);
        assert.equal(await dialog.locator('.modification-card').count() || await dialog.locator('[data-mod-id]').count(), c.modification.m.length);
        if (c.id === 'f_15ex') {
          fs.mkdirSync('logs/eagles-shadow-browser', { recursive: true });
          await page.screenshot({ path: `logs/eagles-shadow-browser/${mode}-${width}.png` });
        }
        await page.keyboard.press('Escape');
      }
      assert.deepEqual(errors, []); await page.close(); console.log(`${mode} ${width}: all nine aircraft and modification totals passed`);
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
