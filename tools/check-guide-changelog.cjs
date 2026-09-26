const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const output = path.resolve('logs/guide-changelog-check');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:' + server.address().port + (mode === 'pages' ? '/pages/' : '/'), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => state.units.length && document.querySelector('.unit-tile'));
      const saved = await page.evaluate(() => localStorage.getItem(storageKey()));
      if (width < 720) await page.locator('#mobileMoreButton').tap();
      await page.locator('#guideButton').click();
      assert(await page.locator('#usageGuideQuickStart').isVisible());
      assert(!await page.locator('#usageGuideChangelog').isVisible());
      assert.equal(await page.locator('#usageGuideQuickStart time, #usageGuideQuickStart [data-game-correction-scope]').count(), 0);
      assert.equal(await page.locator('#usageGuideQuickStart .usage-guide-steps li').count(), 6);
      await page.screenshot({ path: path.join(output, mode + '-' + width + '-quick.png') });
      await page.locator('#usageGuideLogTab').click();
      assert(await page.locator('#usageGuideChangelog').isVisible());
      assert(!await page.locator('#usageGuideQuickStart').isVisible());
      const log = await page.locator('#usageGuideChangelog').innerText();
      assert(log.includes('2026.09.26') && log.includes('未打包') && log.includes('v1.0.13'));
      assert(log.includes('14,000 SL') && log.includes('不代表全量数据升级'));
      await page.screenshot({ path: path.join(output, mode + '-' + width + '-log.png') });
      await page.locator('#usageGuideLogTab').focus();
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.locator('#usageGuideQuickTab').getAttribute('aria-selected'), 'true');
      await page.keyboard.press('End');
      assert.equal(await page.locator('#usageGuideLogTab').getAttribute('aria-selected'), 'true');
      await page.keyboard.press('Escape');
      await page.evaluate(() => openUsageGuide());
      assert(await page.locator('#usageGuideQuickStart').isVisible());
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await page.evaluate(locale => setLanguage(locale), locale);
        await page.locator('#usageGuideLogTab').click();
        assert(await page.evaluate(() => {
          const dialog = els.usageGuideDialog;
          const rect = dialog.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth
            && document.querySelectorAll('[data-guide-tab][aria-selected="true"]').length === 1;
        }));
        if (locale !== 'zh' && locale !== 'ja') assert(!/[\u4e00-\u9fff]/.test(await page.locator('#usageGuideChangelog').innerText()));
      }
      assert.equal(await page.evaluate(() => localStorage.getItem(storageKey())), saved);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(JSON.stringify({ mode, width, quickStartSeparated: true, keyboard: true, locales: 7, stateUnchanged: true, passed: true }));
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
