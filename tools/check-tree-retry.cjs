const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');

async function main() {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'logs/tree-retry');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const reports = [];
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    for (const mode of ['local', 'pages']) for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 720, hasTouch: width < 720 });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const records = {
          'wt-research:usa:ground': JSON.stringify({ planned: ['us_m3_stuart'], owned: ['us_m2_medium'], progressRp: { us_m3_stuart: 1000 } }),
          'wt-research:modifications:us_m3_stuart': JSON.stringify({ selected: ['engine'], researched: [], progressRp: { engine: 100 } }),
        };
        await page.addInitScript(records => { for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value); }, records);
        let metadataFailed = true, metadataRequests = 0, fault = 'http', blockedCountry = 'usa', requests = 0, release;
        const held = async () => {
          const deadline = Date.now() + 10000;
          while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
          assert(release, 'Retry request did not reach the controlled delay');
        };
        const metadataPath = mode === 'pages' ? '/pages/database/manifest.json' : '/api/meta';
        await page.route(url => url.pathname === metadataPath, async route => {
          metadataRequests++;
          if (metadataFailed) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
          else await route.continue();
        });
        await page.route(url => mode === 'pages' ? /^\/pages\/database\/[^/]+\/[^/]+\.json$/.test(url.pathname) : url.pathname.startsWith('/api/tree/'), async route => {
          const pathname = new URL(route.request().url()).pathname;
          const country = pathname.split('/')[3];
          if (country !== blockedCountry) return route.continue();
          requests++;
          if (fault === 'http') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
          if (fault === 'abort') return route.abort('failed');
          if (fault === 'hold') {
            await new Promise(resolve => { release = resolve; });
            return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
          }
          if (fault === 'integrity') {
            const response = await route.fetch();
            return route.fulfill({ response, body: (await response.text()) + ' ' });
          }
          return route.continue();
        });
        const retry = page.locator('[data-tree-retry]');
        const failed = async () => { await retry.waitFor({ state: 'visible' }); await page.waitForFunction(() => !treeSelectionLoading && state.treeLoadError); };
        const ready = () => page.waitForFunction(() => !treeSelectionLoading && !state.treeLoadError && state.units.length > 0);
        const saved = () => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(records));
        await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, { waitUntil: 'domcontentloaded' });
        await failed();
        assert.equal(requests, 0, 'Metadata failure must not start an unverified tree request');
        metadataFailed = false;
        await retry.click(); await failed();
        assert.equal(metadataRequests, 2);
        assert.equal(requests, 1);
        assert.deepEqual(await saved(), records);
        for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
          await page.evaluate(locale => { WTI18n.missing.clear(); setLanguage(locale); }, locale);
          const layout = await retry.evaluate(button => {
            const rect = button.getBoundingClientRect(), panel = button.parentElement;
            return { text: panel.textContent, fits: rect.left >= 0 && rect.right <= innerWidth && rect.height >= 44 && rect.bottom <= innerHeight && panel.scrollWidth <= panel.clientWidth && button.scrollWidth <= button.clientWidth, icon: getComputedStyle(button.querySelector('.nav-icon')).maskImage };
          });
          assert(layout.fits, JSON.stringify(layout));
          assert.notEqual(layout.icon, 'none');
          assert.deepEqual(await page.evaluate(() => [...WTI18n.missing]), []);
          if (!['zh', 'ja'].includes(locale)) assert(!/[\u4e00-\u9fff]/.test(layout.text));
          await page.screenshot({ path: path.join(output, `${mode}-${width}-${locale}.png`) });
        }
        await page.evaluate(() => setLanguage('zh'));
        fault = 'abort';
        await retry.focus(); await page.keyboard.press('Enter'); await failed();
        assert.equal(requests, 2, 'Keyboard retry should send exactly one request');
        fault = 'hold';
        await retry.evaluate(button => { button.click(); button.click(); });
        await page.waitForFunction(() => treeSelectionLoading);
        await held();
        assert.equal(requests, 3, 'Repeated clicks must not create duplicate requests');
        assert.equal(await retry.count(), 0);
        release(); release = undefined; await failed();
        fault = '';
        await retry.click(); await ready();
        assert.equal(requests, 4);
        assert.deepEqual(await saved(), records);
        assert.equal(await page.evaluate(() => state.progressRp.us_m3_stuart), 1000);
        assert(await page.evaluate(() => state.planned.has('us_m3_stuart') && state.owned.has('us_m2_medium')));
        assert.equal(await retry.count(), 0);
        if (mode === 'pages') {
          fault = 'integrity';
          await page.evaluate(() => loadTree()); await failed();
          assert.match(await page.locator('#statusText').textContent(), /校验失败/);
          assert.deepEqual(await saved(), records);
          fault = ''; await retry.click(); await ready();
        }
        // A late failure from the previous country cannot replace a newer tree.
        blockedCountry = 'germany'; fault = 'http';
        await page.evaluate(async () => { els.countrySelect.value = 'germany'; await loadTree(); }); await failed();
        fault = 'hold'; await retry.click();
        await held();
        await page.evaluate(async () => { els.countrySelect.value = 'france'; await loadTree(); }); await ready();
        release(); release = undefined;
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => state.country), 'france');
        assert.equal(await page.evaluate(() => state.treeLoadError), false);
        assert.equal(await retry.count(), 0);
        await page.evaluate(async () => { els.countrySelect.value = 'israel'; els.typeSelect.value = 'boats'; await loadTree(); });
        await page.locator('.wiki-empty').waitFor({ state: 'visible' });
        assert.equal(await retry.count(), 0, 'An empty Wiki tree is not a network error');
        assert.deepEqual(await saved(), records);
        assert.deepEqual(errors, []);
        reports.push({ mode, width, locales: 7, startupRetry: true, repeatFailure: true, keyboard: true, deduplicated: true, progressPreserved: true, staleResponseIgnored: true, emptyTreeDistinct: true, integrityChecked: mode === 'pages' });
        console.log(JSON.stringify(reports.at(-1)));
      } finally { await context.close(); }
    }
  } finally {
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(reports, null, 2));
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
