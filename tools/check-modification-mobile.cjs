const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

async function checkHeader(page) {
  const geometry = await page.evaluate(() => {
    const dialog = document.getElementById('modificationDialog');
    const header = dialog.querySelector('.modification-titlebar');
    const image = document.getElementById('modificationVehicleImage');
    const title = document.getElementById('modificationTitle');
    const close = dialog.querySelector('.modification-close');
    const viewport = document.getElementById('modificationViewport');
    const visible = window.visualViewport;
    const inside = (a, b) => a.top >= b.top - 1 && a.left >= b.left - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
    const screen = {top: visible.offsetTop, left: visible.offsetLeft, right: visible.offsetLeft + visible.width, bottom: visible.offsetTop + visible.height};
    const box = header.getBoundingClientRect();
    return {
      headerVisible: inside(box, screen),
      dialogVisible: inside(dialog.getBoundingClientRect(), screen),
      contentsVisible: [image, title, close].every(element => inside(element.getBoundingClientRect(), box)),
      titleFits: title.scrollWidth <= title.clientWidth + 1 && title.scrollHeight <= title.clientHeight + 1,
      separate: title.getBoundingClientRect().right <= close.getBoundingClientRect().left,
      iconWidth: image.getBoundingClientRect().width,
      closeWidth: close.getBoundingClientRect().width,
      treeHeight: viewport.clientHeight,
      outerScroll: [dialog.scrollLeft, dialog.scrollTop],
    };
  });
  for (const field of ['headerVisible', 'dialogVisible', 'contentsVisible', 'titleFits', 'separate']) {
    assert(geometry[field], `${field}: ${JSON.stringify(geometry)}`);
  }
  assert.equal(geometry.iconWidth, 58);
  assert.equal(geometry.closeWidth, 44);
  assert(geometry.treeHeight > 80, JSON.stringify(geometry));
  assert.deepEqual(geometry.outerScroll, [0, 0]);
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'logs/modification-mobile-check');
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
      const page = await browser.newPage({viewport: {width: 360, height: 640}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => Boolean(window.ModificationWorkbench));
      for (const language of ['zh', 'en']) {
        // The language picker is a select inside a sheet, so set it directly.
        await page.locator('#languageSelect').evaluate((select, value) => {
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }, language);
        for (const vehicle of ['us_halftrack_m15', 'us_m1128_wolfpack', 'us_m1a2_sep2_abrams_trophy']) {
          await page.evaluate(id => ModificationWorkbench.open(id), vehicle);
          await page.waitForFunction(() => {
            const image = document.getElementById('modificationVehicleImage');
            return image.complete && image.naturalWidth > 0;
          });
          for (const size of [{width:320,height:568}, {width:390,height:664}, {width:390,height:844}, {width:844,height:390}]) {
            await page.setViewportSize(size);
            await checkHeader(page);
            await page.locator('#modificationViewport').evaluate(element => element.scrollTo(element.scrollWidth, element.scrollHeight));
            await page.locator('.modification-tile').last().focus();
            await checkHeader(page);
          }
          if (language === 'en' && vehicle === 'us_m1a2_sep2_abrams_trophy') {
            await page.screenshot({path: path.join(output, `${mode}-landscape.png`)});
            await page.setViewportSize({width:360,height:640});
            await page.locator('#modificationViewport').evaluate(element => element.scrollTo(0, 0));
            await checkHeader(page);
            await page.screenshot({path: path.join(output, `${mode}-portrait.png`)});
            const tile = page.locator('.modification-tile:not(:disabled)').first();
            await tile.tap();
            assert(await tile.evaluate(element => element.classList.contains('target')));
            assert.notEqual(await page.locator('#modificationRp').innerText(), '0');
          }
          await page.locator('[data-modification-close]').tap();
          assert.equal(await page.locator('#modificationDialog').evaluate(element => element.open), false);
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(JSON.stringify({mode, mobile: true, languages: 2, vehicles: 3, viewportSizes: 4, headerVisible: true, touchSelection: true}));
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
