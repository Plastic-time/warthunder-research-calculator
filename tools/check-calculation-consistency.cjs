const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'logs/calculation-consistency');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const reports = [];
  try {
    browser = await chromium.launch(launchOptions());
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 720, hasTouch: width < 720 });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const ready = () => page.waitForFunction(() => typeof state !== 'undefined' && state.units.length && !treeSelectionLoading);
        const choose = async country => {
          await page.evaluate(async country => {
            els.countrySelect.value = country; els.typeSelect.value = 'ground'; await loadTree();
          }, country);
          await ready();
        };
        const budget = () => page.evaluate(() => ({
          rp: els.budgetRp.textContent, sl: els.budgetSl.textContent,
          rpLabel: els.budgetRpLabel.textContent, slLabel: els.budgetSlLabel.textContent,
          missing: state.missing.map(unit => unit.data_unit_id),
        }));
        await page.goto(`${base}/${mode === 'pages' ? 'pages/' : ''}`, { waitUntil: 'domcontentloaded' });
        await ready();
        await page.evaluate(() => setLanguage('zh'));
        await choose('germany');
        const unknownId = 'germ_garford_putilov';
        const unknown = page.locator(`[data-unit-id="${unknownId}"]`);
        await unknown.click();
        assert.deepEqual(await budget(), { rp: '0', sl: '0', rpLabel: '已知 RP', slLabel: '已知 SL', missing: [unknownId] });
        assert.equal(await page.evaluate(id => state.initialUnlocked.has(id), unknownId), false);
        assert.equal(await page.locator('#totalRpLabel').textContent(), '\u5df2\u77e5 RP');
        assert.equal(await page.locator('#totalSpLabel').textContent(), '\u5df2\u77e5 SL');
        assert.match(await unknown.locator('.pill.rp').innerText(), /未提供/);
        assert.match(await unknown.locator('.pill.sp').innerText(), /未提供/);
        await unknown.screenshot({ path: path.join(output, `${mode}-${width}-unknown.png`) });
        await page.screenshot({ path: path.join(output, `${mode}-${width}-budget.png`) });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready();
        await choose('germany');
        assert.deepEqual((await budget()).missing, [unknownId], 'Unknown costs must not discard a saved target');

        await choose('usa');
        const stuart = page.locator('[data-unit-id="us_m3_stuart"]');
        await stuart.click();
        await page.evaluate(() => editUnitProgress('us_m3_stuart'));
        await page.locator('#researchProgressInput').fill('1900');
        await page.locator('[data-progress-save]').click();
        const expected = { rp: '1,900', sl: '700', rpLabel: 'RP', slLabel: 'SL', missing: ['us_m3_stuart'] };
        assert.deepEqual(await budget(), expected);
        assert.equal(await page.evaluate(() => state.progressRp.us_m3_stuart), 1000, 'Storage still records invested RP');
        assert.equal(await page.evaluate(() => state.owned.has('us_m3_stuart')), false);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ready();
        await choose('usa');
        assert.deepEqual(await budget(), expected, 'Saved progress survives reload');
        const request = await page.evaluate(() => ({ plannedIds: [...state.planned], ownedIds: [...state.owned], progressRp: state.progressRp }));
        const response = await fetch(`${base}/api/calculate/usa/ground`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
        });
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.total_rp, 1900);
        assert.equal(data.raw_total_rp, 2900);
        assert.equal(data.total_sp, 700);
        await stuart.screenshot({ path: path.join(output, `${mode}-${width}-progress.png`) });
        await page.screenshot({ path: path.join(output, `${mode}-${width}-remaining.png`) });

        await page.evaluate(() => editUnitProgress('us_m3_stuart'));
        await page.locator('#researchProgressInput').fill('0');
        await page.locator('[data-progress-save]').click();
        assert.deepEqual(await budget(), { ...expected, rp: '0' }, 'Finished research still requires purchasing the vehicle');
        assert.equal(await page.evaluate(() => state.owned.has('us_m3_stuart')), false);
        assert.deepEqual(errors, []);
        reports.push({ mode, width, unknownCostsPreserved: true, savedProgressPreserved: true, apiMatches: true, slAndOwnershipUnchanged: true });
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ passed: reports.length, scenarios: reports }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
