const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
async function main() {
  const output = path.resolve('logs/f4u7-check');
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
      endpoints = [['desktop-app', base + '/'], ['pages', base + '/pages/']];
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const [mode, url] of endpoints) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 960 }, isMobile: width < 720, hasTouch: width < 720, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      assert.equal(await page.locator('[data-game-version]').innerText(), '2.59.0.38');
      assert((await page.locator('#usageGuideChangelog').textContent()).includes('v1.0.18'));
      await page.waitForFunction(() => ModificationWorkbench.hasVehicle('f4u-7'));
      await page.evaluate(async () => {
        const plan = ModificationPlanner.plan;
        ModificationPlanner.plan = (...args) => { window.testF4uData = args[0]; return window.testF4uResult = plan(...args); };
        await ModificationWorkbench.open('f4u-7');
      });
      const cannon = page.locator('[data-mod-id="anm3_new_gun"]');
      await cannon.scrollIntoViewIfNeeded();
      await cannon.click();
      await page.locator('[data-modification-action="calculate"]').click();
      const result = await page.evaluate(() => ({ data: testF4uData, result: testF4uResult }));
      assert.equal(result.result.rp, 3700);
      assert.equal(result.result.sl, 6800);
      assert.equal(result.data.mods.find(m => m.id === 'anm3_new_gun').tier, 2);
      assert.deepEqual(result.data.mods.find(m => m.id === 'frc_mk3').requires, ['fr_matra_t_10_150']);
      const overlap = await page.locator('[data-mod-id]').evaluateAll(tiles => {
        const boxes = tiles.map(el => el.getBoundingClientRect());
        return boxes.some((a, i) => boxes.slice(i + 1).some(b => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
      });
      assert(!overlap, 'Modification tiles overlap');
      await page.waitForFunction(() => [...document.querySelectorAll('[data-mod-id] img')].every(img => img.complete && img.naturalWidth > 0));
      await page.screenshot({ path: path.join(output, mode + '-' + width + '-cannon.png') });
      await page.locator('[data-modification-action="all"]').click();
      await page.locator('[data-modification-action="calculate"]').click();
      assert.equal(await page.locator('#modificationRp').innerText(), '47,800');
      assert.equal(await page.locator('#modificationSl').innerText(), '86,900');
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, width, cannonTier: 2, cannonRp: 3700, allRp: 47800, allSl: 86900, overlap: false, passed: true }));
      await page.close();
    }
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
