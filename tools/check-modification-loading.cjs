const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'logs/modification-loading');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  const reports = [];
  try {
    browser = await chromium.launch(launchOptions());
    for (const mode of ['local', 'pages']) for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 720, hasTouch: width < 720 });
      const releases = [];
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const records = {
          'wt-research:usa:ground': JSON.stringify({ planned: ['us_m3_stuart'], owned: ['us_m2_medium'], progressRp: { us_m3_stuart: 1000 } }),
          'wt-research:modifications:us_m2a4': JSON.stringify({ selected: ['engine'], researched: [], progressRp: { engine: 100 }, airCombat: true }),
        };
        await page.addInitScript(records => { for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value); }, records);
        const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/database/modifications/catalog.json')));
        const first = 'us_m2a4', second = 'germ_garford_putilov';
        const chunkPath = catalog.chunks[catalog.vehicles[first]].path;
        const body = fs.readFileSync(path.join(root, 'docs', chunkPath), 'utf8');
        let fault = 'hold', count = 0, catalogFault = false, release;
        await page.route('**/database/modifications/catalog.json*', route => catalogFault
          ? route.fulfill({ status: 503, body: '{}' }) : route.continue());
        await page.route('**/' + chunkPath + '*', async route => {
          count++;
          if (fault === 'hold' || fault === 'hold-error') {
            const status = fault === 'hold-error' ? 503 : 200;
            await new Promise(resolve => { release = resolve; releases.push(resolve); });
            return route.fulfill({ status, contentType: 'application/json', body }).catch(() => {});
          }
          if (fault === 'http') return route.fulfill({ status: 503, body: '{}' });
          if (fault === 'network') return route.abort('failed');
          if (fault === 'integrity') return route.fulfill({ contentType: 'application/json', body: body + ' ' });
          return route.fulfill({ contentType: 'application/json', body });
        });
        const base = `http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`;
        const open = id => page.evaluate(id => { window.pendingModificationOpen = ModificationWorkbench.open(id); }, id);
        const state = value => page.waitForFunction(value => document.getElementById('modificationDialog').dataset.loadState === value, value);
        const settled = () => page.evaluate(() => window.pendingModificationOpen);
        const held = async () => {
          const deadline = Date.now() + 10000;
          while (!release && Date.now() < deadline) await page.waitForTimeout(10);
          assert(release, 'The request did not reach the controlled delay');
        };
        const saved = () => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(records));
        const retry = page.locator('[data-modification-retry]');
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.ModificationWorkbench?.hasVehicle('us_m2a4'));
        await open(first); await state('loading');
        assert(await page.locator('#modificationDialog').evaluate(dialog => dialog.open));
        assert(await page.locator('[data-modification-action="calculate"]').isDisabled());
        await page.waitForFunction(() => document.getElementById('modificationTree').innerText.includes('…'));
        await page.screenshot({ path: path.join(output, `${mode}-${width}-loading.png`) });
        await held();
        await page.evaluate(() => { window.olderModificationOpen = window.pendingModificationOpen; });
        await open(second); await settled(); await state('ready');
        const secondTitle = await page.locator('#modificationTitle').innerText();
        release(); release = null;
        await page.evaluate(() => window.olderModificationOpen);
        assert.equal(await page.locator('#modificationTitle').innerText(), secondTitle, 'Old request replaced the latest vehicle');
        assert.deepEqual(await saved(), records);

        // Fresh page drops the successful chunk cache; closing must invalidate a pending open.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.ModificationWorkbench?.hasVehicle('us_m2a4'));
        await open(first); await state('loading');
        await held();
        await page.locator('[data-modification-close]').click();
        release(); release = null; await settled();
        assert.equal(await page.locator('#modificationDialog').evaluate(dialog => dialog.open), false);
        assert.deepEqual(await saved(), records);

        // Escape and immediate reopening must not let an older error replace the new tree.
        fault = 'hold-error';
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.ModificationWorkbench?.hasVehicle('us_m2a4'));
        await open(first); await state('loading'); await held();
        await page.evaluate(() => { window.olderModificationOpen = window.pendingModificationOpen; });
        await page.keyboard.press('Escape');
        await open(second); await settled(); await state('ready');
        const reopenedTitle = await page.locator('#modificationTitle').innerText();
        release(); release = null;
        await page.evaluate(() => window.olderModificationOpen);
        assert.equal(await page.locator('#modificationTitle').innerText(), reopenedTitle);
        assert.equal(await retry.count(), 0);

        fault = 'http';
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.ModificationWorkbench?.hasVehicle('us_m2a4'));
        await open(first); await state('error');
        for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
          await page.evaluate(locale => { WTI18n.missing.clear(); setLanguage(locale); }, locale);
          assert.equal(await page.evaluate(() => WTI18n.missing.size), 0);
          assert(await retry.evaluate(button => { const rect = button.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44 && rect.left >= 0 && rect.right <= innerWidth && button.scrollWidth <= button.clientWidth; }));
          assert(await page.locator('.modification-load-state p').evaluate(p => p.scrollWidth <= p.clientWidth));
        }
        await page.screenshot({ path: path.join(output, `${mode}-${width}-error.png`) });
        for (const next of ['network', 'integrity']) {
          fault = next;
          await retry.click(); await state('error');
          assert.deepEqual(await saved(), records);
        }
        catalogFault = true;
        const beforeCatalog = count;
        await retry.click(); await state('error');
        assert.equal(count, beforeCatalog, 'Bad catalog must not start a chunk request');
        catalogFault = false;
        fault = 'hold';
        const beforeRetry = count;
        await retry.evaluate(button => { button.click(); button.click(); });
        await state('loading');
        await held();
        assert.equal(count, beforeRetry + 1, 'Double retry duplicated the download');
        if (width === 1440) {
          // Exercise the real 15-second timer and abort, without replacing production timers.
          await state('error');
          assert((await page.locator('.modification-load-state').innerText()).includes('demasiado'));
          release(); release = null;
          fault = '';
          await retry.click(); await state('ready');
        } else {
          release(); release = null;
          await state('ready');
        }
        assert.deepEqual(await saved(), records);
        assert(await page.locator('.modification-tile').count() > 0);
        assert(await page.locator('[data-modification-action="calculate"]').isEnabled());
        await page.locator('[data-modification-action="calculate"]').click();
        assert.equal(await page.locator('#modificationDialog').getAttribute('data-load-state'), 'ready');
        await page.evaluate(() => PlanStorage.settled());
        const calculated = await saved();
        await page.locator('[data-modification-action="clear"]').click();
        await page.evaluate(() => PlanStorage.settled());
        assert(await page.locator('[data-modification-undo]').isVisible());
        assert.deepEqual(JSON.parse((await saved())['wt-research:modifications:us_m2a4']).selected, []);
        await page.locator('[data-modification-undo]').click();
        await page.evaluate(() => PlanStorage.settled());
        assert.deepEqual(await saved(), calculated, 'Undo after retry must restore the same saved records');
        assert.deepEqual(errors, []);
        reports.push({ mode, width, lastSelectionWins: true, closeStaysClosed: true, retry: true, preservedRecords: true, realTimeout: width === 1440 });
      } finally { releases.forEach(resolve => resolve()); await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify(reports));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
