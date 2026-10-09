const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const output = path.resolve('logs/readme-capture');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use(express.static(path.resolve('docs')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    for (const locale of ['zh', 'en']) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: width < 720 ? 844 : 960 }, deviceScaleFactor: 1, isMobile: width < 720, hasTouch: width < 720, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading && ModificationWorkbench.hasVehicle('rafale_c_f3'));
      await page.evaluate(async locale => { setLanguage(locale); await document.fonts.ready; }, locale);
      if (width === 1440) {
        await page.evaluate(() => {
          toggleUnitMode('us_m18_hellcat', 'target');
          openUnitContextMenu('us_m18_hellcat', 90, 220);
        });
        await page.locator('[data-edit-unit-progress]').click();
        await page.locator('#researchProgressInput').fill('16000');
        await page.locator('[data-progress-save]').click();
        await page.locator('#planButton').click();
        await page.waitForFunction(() => state.planResult && !state.planResult.dirty && !els.planButton.disabled);
        const target = page.locator('.tree-canvas [data-unit-id="us_m18_hellcat"]');
        await target.evaluate(tile => {
          const tree = document.getElementById('treeContainer');
          const r = tile.getBoundingClientRect(), t = tree.getBoundingClientRect();
          tree.scrollTop += r.top - t.top - 270;
          tree.scrollLeft += r.left - t.left - 350;
        });
        await page.waitForFunction(() => [...document.querySelectorAll('.tree-canvas .unit-tile > img')].filter(i => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }).every(i => i.complete && i.naturalWidth > 0));
        assert.equal(await page.evaluate(() => remainingUnitRp(state.unitMap.get('us_m18_hellcat'))), 16000);
        await page.mouse.move(1430, 5);
        await page.screenshot({ path: path.join(output, `research-tree-${locale}.png`) });
      }
      await page.evaluate(async () => {
        els.countrySelect.value = 'france';
        els.typeSelect.value = 'aviation';
        await loadTree();
        await ModificationWorkbench.open('rafale_c_f3');
      });
      const mica = page.locator('[data-mod-id="fr_mica_em"]');
      await page.locator('[data-modification-mode="progress"]').click();
      await mica.click();
      await page.locator('#researchProgressInput').fill('6000');
      await page.locator('[data-progress-save]').click();
      await page.locator('[data-modification-mode="select"]').click();
      await mica.click();
      await page.locator('[data-modification-action="calculate"]').click();
      await page.waitForFunction(() => [...document.querySelectorAll('#modificationDialog img')].every(i => i.complete && i.naturalWidth > 0));
      assert.equal(await page.locator('[data-modification-action="clear-owned"]').count(), 0);
      assert(await page.locator('[data-modification-air-combat]').isChecked());
      assert((await mica.locator('.modification-rp-progress').textContent()).includes('6,000'));
      if (width < 720) await mica.evaluate(tile => {
        const viewport = document.getElementById('modificationViewport');
        viewport.scrollLeft += tile.getBoundingClientRect().left - viewport.getBoundingClientRect().left - 6;
      });
      await page.screenshot({ path: path.join(output, `modifications-${width < 720 ? 'mobile-' : ''}${locale}.png`) });
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ locale, width, imagesLoaded: true, passed: true }));
      await page.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
