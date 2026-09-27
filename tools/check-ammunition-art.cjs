const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const before = process.argv.includes('--before');
  const aircraft = ['j_16', 'su_30sm2', 'f_15c_golden_eagle', 'f_15i_raam', 'f_16a_block_10'];
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'logs/ammunition-art-check');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
  const errors = [];
  try {
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => Boolean(window.ModificationWorkbench));
      for (const vehicle of ['us_halftrack_m15', 'us_m1a2_abrams', ...aircraft, 'ah_1g']) {
        await page.evaluate(async id => {
          document.getElementById('modificationDialog').close();
          await ModificationWorkbench.open(id);
        }, vehicle);
        const originalBeltIcon = !before && aircraft.includes(vehicle);
        await page.waitForFunction(original => {
          const images = [...document.querySelectorAll(original ? '.modification-tile > img[src$="/ammo.png"]' : '.modification-ammunition img')];
          return images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0);
        }, originalBeltIcon);
        if (originalBeltIcon) {
          assert.equal(await page.locator('.modification-ammunition').count(), 0, vehicle + ': aircraft belt previews must not replace research icons');
          const icon = page.locator('.modification-tile > img[src$="/ammo.png"]').first();
          const tile = icon.locator('..');
          await tile.click();
          assert(await tile.evaluate(element => element.classList.contains('target')));
          await tile.click();
          assert(!await tile.evaluate(element => element.classList.contains('target')));
        }
        if (vehicle === 'us_halftrack_m15') {
          assert.equal(await page.locator('.modification-ammunition').count(), 5);
          const tile = page.locator('[data-mod-id="37mm_usa_m54_HE_ammo_pack"]');
          await tile.click();
          assert(await tile.evaluate(element => element.classList.contains('target')));
          assert.notEqual(await page.locator('#modificationRp').innerText(), '0');
        }
        if (width === 390) await page.locator(originalBeltIcon ? '.modification-tile > img[src$="/ammo.png"]' : '.modification-ammunition').first().scrollIntoViewIfNeeded();
        assert(await page.locator('.modification-ammunition').evaluateAll(nodes => nodes.every(node => {
          const box = node.getBoundingClientRect();
          return box.width === 52 && box.height === 52 && [...node.querySelectorAll('img')].every(image => {
            const r = image.getBoundingClientRect();
            return r.left >= box.left - 1 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1;
          });
        })));
        await page.screenshot({path: path.join(output, `${before ? 'before-' : ''}${mode}-${width}-${vehicle}.png`)});
      }
      await page.evaluate(async () => {
        document.getElementById('modificationDialog').close();
        await ModificationWorkbench.open('us_m1128_wolfpack');
      });
      assert(await page.locator('.modification-tile').filter({has:page.locator('.modification-ammunition')}).first().isDisabled());
      await page.close();
      console.log(JSON.stringify({mode, width, before, aircraftOriginalIcons: !before, imagery:true, selection:true, unlocked:true}));
    }
    const page = await browser.newPage();
    await page.route('**/images/ammunition/armor_big.png', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/pages/`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => Boolean(window.ModificationWorkbench));
    await page.evaluate(() => ModificationWorkbench.open('us_m1a2_abrams'));
    const dart = page.locator('[data-mod-id="120mm_M829A_APDS_FS_ammo_pack"]');
    await page.waitForFunction(() => Boolean(document.querySelector('[data-mod-id="120mm_M829A_APDS_FS_ammo_pack"] > img')));
    await dart.click();
    assert(await dart.evaluate(element => element.classList.contains('target')));
    await page.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({missingAssetFallback:true, browserErrors:0, passed:true}));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
