const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

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
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
    for (const mode of ['local', 'pages']) {
      const mobile = mode === 'pages';
      const page = await browser.newPage({viewport: {width: mobile ? 390 : 1440, height: 844}, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1});
      await page.goto(`http://127.0.0.1:${server.address().port}/${mobile ? 'pages/' : ''}`, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('.tree-canvas'));
      for (const country of (mobile ? ['israel', 'usa', 'ussr'] : ['israel'])) {
        await page.evaluate(async value => {
          els.countrySelect.value = value;
          await loadTree();
          const target = state.units.find(unit => unit.section === 'researchable' && unit.rp > 0);
          toggleUnitMode(target.data_unit_id, 'target');
          els.treeContainer.scrollTo(120, 600);
        }, country);
        const result = await page.evaluate(async () => {
          const before = JSON.stringify(WTRouteExport.buildPayload());
          const scroll = [els.treeContainer.scrollLeft, els.treeContainer.scrollTop];
          let dimensions;
          const toCanvas = htmlToImage.toCanvas;
          htmlToImage.toCanvas = async (element, options) => {
            dimensions = {width: options.width, height: options.height, scale: options.pixelRatio};
            return toCanvas(element, options);
          };
          try {
            const canvas = await WTRouteExport.render();
            const context = canvas.getContext('2d');
            const bands = [0.05, 0.5, 0.95].map(fraction => {
              const pixels = context.getImageData(0, Math.floor(canvas.height * fraction), canvas.width, 80).data;
              let dark = 0;
              for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100 && pixels[i + 3]) dark++;
              return dark;
            });
            const preview = document.createElement('canvas');
            preview.width = Math.min(1000, canvas.width);
            preview.height = 900;
            preview.getContext('2d').drawImage(canvas, 0, 0);
            const output = {dimensions, width: canvas.width, height: canvas.height, bands,
              stateUnchanged: before === JSON.stringify(WTRouteExport.buildPayload()),
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
        assert(result.bands.every(count => count > 20), JSON.stringify(checks));
        if (country === 'israel') assert.equal(d.scale, 2);
        fs.writeFileSync(path.join(output, `${mode}-${country}-detail.png`), Buffer.from(preview.split(',')[1], 'base64'));
        console.log(JSON.stringify({mode, country, ...d, ...checks}));
      }
      // Exercise the actual download button and inspect the lossless PNG dimensions.
      if (mobile) await page.locator('#mobileMoreButton').click();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120000 }),
        page.locator('#routeExportButton').click(),
      ]);
      const file = path.join(output, `${mode}-download.png`);
      await download.saveAs(file);
      const png = fs.readFileSync(file);
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert(png.readUInt32BE(16) > (mobile ? 1365 : 1013));
      console.log(JSON.stringify({mode, download: true, bytes: png.length}));
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
