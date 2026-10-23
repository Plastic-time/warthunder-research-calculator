const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'logs/export-hd-check');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  const reports = [];
  try {
    browser = await chromium.launch({...launchOptions(), args: ['--disable-gpu']});
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const mobile = width < 720;
      const page = await browser.newPage({viewport: {width, height: 844}, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1});
      const errors = [];
      let downloads = 0;
      page.on('pageerror', error => errors.push(error.message));
      page.on('download', () => downloads++);
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => typeof state !== 'undefined' && state.units.length && !treeSelectionLoading);
      await page.evaluate(() => setLanguage('zh'));
      const snapshot = () => page.evaluate(() => ({
        payload: {...WTRouteExport.buildPayload(), generatedAt: null},
        storage: Object.fromEntries(Object.entries(localStorage)),
        scroll: [els.treeContainer.scrollLeft, els.treeContainer.scrollTop],
      }));
      for (const country of (mode === 'pages' && mobile ? ['israel', 'usa', 'ussr'] : ['israel'])) {
        await page.evaluate(async value => {
          els.countrySelect.value = value;
          els.typeSelect.value = 'ground';
          await loadTree();
          const target = state.units.find(unit => unit.section === 'researchable' && unit.rp > 0);
          toggleUnitMode(target.data_unit_id, 'target');
          state.progressRp[target.data_unit_id] = Math.min(1000, target.rp);
          saveState(); calculatePlan();
          els.treeContainer.scrollTo(120, 600);
        }, country);
        if (country === 'israel') {
          const before = await snapshot();
          const blockedImage = await page.locator('.tree-canvas .unit-tile > img').first().evaluate(img => img.src);
          assert(blockedImage);
          let failedRequests = 0;
          // Fail an actual image fetch, then retry without changing production security or images.
          await page.route(blockedImage, route => {
            failedRequests++;
            return route.fulfill({status: 503, contentType: 'text/plain', body: 'Test image outage'});
          });
          if (!await page.locator('#routeExportButton').isVisible()) await page.locator('#mobileMoreButton').click();
          await page.locator('#routeExportButton').click();
          await page.waitForFunction(() => !RouteExporter.isBusy() && !els.routeExportButton.disabled, null, {timeout: 120000});
          const status = await page.locator('#statusText').textContent();
          console.log(JSON.stringify({mode, width, phase: 'image-failure', failedRequests, status}));
          assert(failedRequests > 0, 'The failure test must intercept a real export request');
          assert.match(status, /\u56fe\u7247\u672a\u80fd\u8bfb\u53d6/);
          assert.equal(downloads, 0, 'A failed export must not download an incomplete image');
          assert.equal(await page.locator('.tree-screenshot').count(), 0);
          assert.deepEqual(await snapshot(), before, 'Failed export must preserve plans, progress and scroll');
          await page.unroute(blockedImage);
        }
        const result = await page.evaluate(async () => {
          // generatedAt has minute resolution, so a render that crosses a minute boundary must not count as a state change.
          const snapshot = () => JSON.stringify({ ...WTRouteExport.buildPayload(), generatedAt: null });
          const before = snapshot();
          const scroll = [els.treeContainer.scrollLeft, els.treeContainer.scrollTop];
          let dimensions, budgets, images;
          const toCanvas = htmlToImage.toCanvas;
          htmlToImage.toCanvas = async (element, options) => {
            dimensions = {width: options.width, height: options.height, scale: options.pixelRatio};
            budgets = [...element.querySelectorAll('.tree-screenshot-totals')].map(group =>
              [...group.querySelectorAll('.tree-screenshot-cost')].map(cost => ({label: cost.querySelector('span').textContent, value: cost.querySelector('strong').textContent})));
            const embedded = [...element.querySelectorAll('img')];
            images = {count: embedded.length, loaded: embedded.every(img => img.src.startsWith('data:image/') && img.complete && img.naturalWidth > 0)};
            return toCanvas(element, options);
          };
          try {
            const canvas = await WTRouteExport.render();
            const context = canvas.getContext('2d');
            const bands = [0.05, 0.5, 0.95].map(fraction => {
              const pixels = context.getImageData(0, Math.floor(canvas.height * fraction), canvas.width, 80).data;
              let dark = 0, light = 0;
              for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) {
                if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) dark++;
                if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 140) light++;
              }
              return {dark, light};
            });
            const preview = document.createElement('canvas');
            preview.width = Math.min(1000, canvas.width);
            preview.height = 900;
            const stripHeight = 450 * canvas.width / preview.width;
            const previewContext = preview.getContext('2d');
            previewContext.drawImage(canvas, 0, 0, canvas.width, stripHeight, 0, 0, preview.width, 450);
            previewContext.drawImage(canvas, 0, canvas.height - stripHeight, canvas.width, stripHeight, 0, 450, preview.width, 450);
            const payload = WTRouteExport.buildPayload();
            const expectedBudget = [
              {label: payload.treeRpLabel, value: payload.treeRp}, {label: payload.treeSlLabel, value: payload.treeSl},
              {label: payload.rpLabel, value: payload.totalRp}, {label: payload.slLabel, value: payload.totalSl},
            ];
            const output = {dimensions, budgets, expectedBudget, images, width: canvas.width, height: canvas.height, bands,
              stateUnchanged: before === snapshot(),
              scrollUnchanged: scroll[0] === els.treeContainer.scrollLeft && scroll[1] === els.treeContainer.scrollTop,
              cleaned: !document.querySelector('.tree-screenshot') && !RouteExporter.isBusy(),
              preview: preview.toDataURL('image/png')};
            canvas.width = canvas.height = 0;
            return output;
          } finally { htmlToImage.toCanvas = toCanvas; }
        });
        const {dimensions: d, preview, ...checks} = result;
        const expected = Math.min(2, 16000 / d.width, 16000 / d.height, Math.sqrt(32000000 / (d.width * d.height)));
        assert.equal(d.scale, expected);
        assert(result.width >= Math.floor(d.width * expected));
        assert(result.height >= Math.floor(d.height * expected));
        assert(result.width <= 16000 && result.height <= 16000 && result.width * result.height <= 32000000);
        assert(result.stateUnchanged && result.scrollUnchanged && result.cleaned);
        assert(result.bands.every(({dark, light}) => dark > 20 && light > 20), JSON.stringify(checks));
        assert.deepEqual(result.budgets, [result.expectedBudget, result.expectedBudget], 'Top and bottom budgets must include current remaining RP');
        assert(result.images.count > 0 && result.images.loaded, 'Export must embed real decoded images');
        if (country === 'israel') assert.equal(d.scale, 2);
        fs.writeFileSync(path.join(output, `${mode}-${width}-${country}-detail.png`), Buffer.from(preview.split(',')[1], 'base64'));
        reports.push({mode, viewportWidth: width, country, ...d, ...checks, imageFailureRecovery: country === 'israel'});
        console.log(JSON.stringify(reports.at(-1)));
      }
      // Exercise the actual download button and inspect the lossless PNG dimensions.
      const before = await snapshot();
      if (!await page.locator('#routeExportButton').isVisible()) await page.locator('#mobileMoreButton').click();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120000 }),
        page.locator('#routeExportButton').click(),
      ]);
      const file = path.join(output, `${mode}-${width}-download.png`);
      await download.saveAs(file);
      const png = fs.readFileSync(file);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert(png.readUInt32BE(16) > (mobile ? 1365 : 1013));
      const decoded = await page.evaluate(async data => {
        const image = new Image();
        image.src = data;
        await image.decode();
        const bitmap = await createImageBitmap(image);
        const result = {width: bitmap.width, height: bitmap.height};
        bitmap.close();
        return result;
      }, `data:image/png;base64,${png.toString('base64')}`);
      assert.equal(decoded.width, png.readUInt32BE(16));
      assert.equal(decoded.height, png.readUInt32BE(20));
      assert(decoded.width <= 16000 && decoded.height <= 16000 && decoded.width * decoded.height <= 32000000);
      assert.deepEqual(await snapshot(), before);
      assert.equal(downloads, 1);
      assert.deepEqual(errors, []);
      reports.push({mode, viewportWidth: width, download: true, decoded, bytes: png.length, stateUnchanged: true});
      console.log(JSON.stringify(reports.at(-1)));
      await page.close();
    }
  } finally {
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(reports, null, 2));
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
