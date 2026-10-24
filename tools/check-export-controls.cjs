const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'logs/export-controls');
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
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      let downloads = 0;
      page.on('pageerror', error => errors.push(error.message));
      page.on('download', () => downloads++);
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof state !== 'undefined' && state.units.length && !treeSelectionLoading);
      await page.evaluate(async () => {
        setLanguage('en'); setLanguage('zh');
        els.countrySelect.value = 'israel'; els.typeSelect.value = 'ground';
        await loadTree();
        const target = state.units.find(unit => unit.rp > 1000);
        toggleUnitMode(target.data_unit_id, 'target');
        state.progressRp[target.data_unit_id] = 1000;
        saveState(); calculatePlan();
        await PlanStorage.settled();
        els.treeContainer.scrollTo(100, 500);
      });
      const snapshot = () => page.evaluate(() => ({
        payload: { ...WTRouteExport.buildPayload(), generatedAt: null },
        storage: Object.fromEntries(Object.entries(localStorage)),
        scroll: [els.treeContainer.scrollLeft, els.treeContainer.scrollTop],
      }));
      const before = await snapshot();
      const start = async () => {
        if (!await page.locator('#routeExportButton').isVisible()) await page.locator('#mobileMoreButton').click();
        await page.locator('#routeExportButton').click();
        await page.waitForFunction(() => RouteExporter.isBusy());
      };
      const idle = () => page.waitForFunction(() => !RouteExporter.isBusy() && !els.routeExportButton.disabled && !document.querySelector('.tree-export-dialog[open]'));
      const blocked = await page.locator('.tree-canvas .unit-tile > img').first().evaluate(img => img.src);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let requests = 0;
      await page.route(blocked, async route => { requests++; await gate; await route.abort().catch(() => {}); });
      await start();
      await page.waitForFunction(() => document.querySelector('.tree-export-dialog progress')?.hasAttribute('value'));
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await page.evaluate(value => setLanguage(value), locale);
        const layout = await page.locator('.tree-export-dialog').evaluate(dialog => {
          const rect = dialog.getBoundingClientRect();
          const status = dialog.querySelector('[data-export-status]');
          const progress = dialog.querySelector('progress');
          const button = dialog.querySelector('button');
          return {
            text: status.textContent, title: dialog.querySelector('h2').textContent,
            fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight &&
              [...dialog.querySelectorAll('h2,p,button')].every(el => el.scrollWidth <= el.clientWidth + 1),
            buttonHeight: button.getBoundingClientRect().height,
            completed: progress.value, total: progress.max, cancel: !button.disabled,
          };
        });
        assert(layout.fits && layout.cancel && layout.buttonHeight >= 44, JSON.stringify(layout));
        assert(layout.total > 0 && layout.completed < layout.total);
        if (locale !== 'zh' && locale !== 'ja') assert(!/[\u4e00-\u9fff]/.test(layout.text + layout.title));
        await page.screenshot({ path: path.join(output, `${mode}-${width}-${locale}.png`) });
      }
      await page.evaluate(() => setLanguage('zh'));
      await page.locator('[data-export-cancel]').click();
      await idle();
      release();
      await page.unroute(blocked);
      assert(requests > 0);
      assert.equal(await page.locator('#statusText').textContent(), '\u622a\u56fe\u5bfc\u51fa\u5df2\u53d6\u6d88');
      assert.equal(downloads, 0);
      assert.deepEqual(await snapshot(), before);

      // Control only the non-interruptible phases. Real full-size rendering is checked by check-export-hd.
      for (const phase of ['raster', 'encode', 'encode-error']) {
        await page.evaluate(phase => {
          window.exportOriginalCanvas = htmlToImage.toCanvas;
          htmlToImage.toCanvas = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 8;
            window.exportTestCanvas = canvas;
            if (phase === 'raster') await new Promise(resolve => { window.exportRelease = resolve; });
            else canvas.toBlob = callback => { window.exportRelease = () => callback(phase === 'encode-error' ? null : new Blob(['test'], { type: 'image/png' })); };
            return canvas;
          };
          window.exportRelease = null;
        }, phase);
        await start();
        await page.waitForFunction(() => typeof window.exportRelease === 'function', null, { timeout: 90000 });
        if (phase === 'raster') await page.keyboard.press('Escape');
        else await page.locator('[data-export-cancel]').click();
        const locked = await page.evaluate(async () => {
          let blocked = false;
          try { await WTRouteExport.render(); } catch { blocked = true; }
          return { blocked, busy: RouteExporter.isBusy(), disabled: document.querySelector('[data-export-cancel]').disabled };
        });
        assert(locked.blocked && locked.busy && locked.disabled);
        assert.equal(downloads, 0);
        await page.evaluate(() => exportRelease());
        await idle();
        assert.equal(await page.locator('#statusText').textContent(), '\u622a\u56fe\u5bfc\u51fa\u5df2\u53d6\u6d88');
        assert.equal(await page.evaluate(() => exportTestCanvas.width), 0);
        assert.equal(await page.locator('.tree-screenshot').count(), 0);
        assert.equal(downloads, 0);
        assert.deepEqual(await snapshot(), before);
        await page.evaluate(() => { htmlToImage.toCanvas = exportOriginalCanvas; });
      }
      await page.evaluate(() => {
        const original = htmlToImage.toCanvas;
        htmlToImage.toCanvas = async (...args) => {
          const canvas = await original(...args);
          window.exportCompletedCanvas = canvas;
          return canvas;
        };
      });
      const downloadEvent = page.waitForEvent('download', { timeout: 120000 });
      await start();
      const download = await downloadEvent;
      assert.equal(await download.failure(), null);
      const png = fs.readFileSync(await download.path());
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert(png.readUInt32BE(16) > 1000 && png.readUInt32BE(20) > 2000);
      await idle();
      assert.equal(downloads, 1, 'Only the successful retry may download a file');
      assert.equal(await page.evaluate(() => exportCompletedCanvas.width), 0);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(errors, []);
      reports.push({ mode, width, locales: 7, imageCancel: true, rasterCancel: true, encodeCancel: true, stateUnchanged: true, cancelledDownloads: 0, retryDownload: true, canvasReleased: true });
      console.log(JSON.stringify(reports.at(-1)));
      await page.close();
    }
  } finally {
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(reports, null, 2));
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
