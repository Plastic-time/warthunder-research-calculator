const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

const output = path.resolve('logs/modification-controls');
fs.mkdirSync(output, { recursive: true });
async function main() {
  let server, browser;
  try {
    const app = express();
    app.use('/pages', express.static(path.resolve('docs')));
    app.use(require('../main'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chrome' });
    for (const mode of ['local', 'pages']) {
      for (const [width, height] of [[1440, 960], [390, 844], [320, 568], [844, 390]]) {
        const mobile = width < 720 || height < 540;
        const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`${base}/${mode === 'pages' ? 'pages/' : ''}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => ModificationWorkbench.hasVehicle('f_86em_greece'));
        await page.evaluate(() => {
          const plan = ModificationPlanner.plan;
          ModificationPlanner.plan = (...args) => window.controlResult = plan(...args);
          return ModificationWorkbench.open('f_86em_greece');
        });
        const action = name => page.locator(`[data-modification-action="${name}"]`);
        const target = page.locator('[data-mod-id="us_aim_9b"]');
        const toggle = page.locator('[data-modification-air-combat]');
        assert(await toggle.isChecked());
        await toggle.uncheck();
        assert(!(await toggle.isChecked()));
        assert.equal(await toggle.evaluate(el => getComputedStyle(el).boxShadow), 'none');
        await toggle.check();
        await target.click();
        await action('calculate').click();
        const before = await page.evaluate(() => ({ rp: controlResult.rp, sl: controlResult.sl }));
        await page.locator('[data-modification-mode="progress"]').click();
        assert.equal(await page.locator('[data-modification-mode="progress"]').getAttribute('aria-pressed'), 'true');
        await target.click();
        assert.equal(await page.locator('#researchProgressInput').inputValue(), '16000');
        await page.locator('#researchProgressInput').fill('11000');
        await page.locator('[data-progress-save]').click();
        assert.deepEqual(await page.evaluate(() => ({ rp: controlResult.rp, sl: controlResult.sl })), { rp: before.rp - 5000, sl: before.sl });
        await page.locator('[data-modification-mode="select"]').click();
        await page.locator('[data-mod-id]:not([data-mod-id="us_aim_9b"]):not([disabled])').first().click({ button: 'right' });
        await toggle.uncheck();
        const otherRecords = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key !== 'wt-research:modifications:f_86em_greece')));
        const populated = await page.evaluate(() => JSON.parse(localStorage.getItem('wt-research:modifications:f_86em_greece')));
        assert(populated.selected.length > 0 && populated.researched.length > 0 && Object.keys(populated.progressRp).length > 0);
        assert.equal(await page.locator('[data-modification-action="clear-owned"]').count(), 0);
        await action('clear').click();
        assert.equal(await page.locator('#modificationRp').innerText(), '0');
        assert.equal(await page.locator('#modificationSl').innerText(), '0');
        assert.equal(await target.locator('.modification-rp-progress').count(), 0);
        const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem('wt-research:modifications:f_86em_greece')));
        assert.deepEqual(cleared.selected, []);
        assert.deepEqual(cleared.researched, []);
        assert.deepEqual(cleared.progressRp, {});
        assert.equal(cleared.airCombat, false);
        assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key !== 'wt-research:modifications:f_86em_greece'))), otherRecords);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => ModificationWorkbench.hasVehicle('f_86em_greece'));
        await page.evaluate(() => {
          const plan = ModificationPlanner.plan;
          ModificationPlanner.plan = (...args) => window.controlResult = plan(...args);
          return ModificationWorkbench.open('f_86em_greece');
        });
        assert(!(await toggle.isChecked()));
        assert.equal(await page.locator('#modificationRp').innerText(), '0');
        assert.equal(await page.locator('.modification-rp-progress').count(), 0);
        await toggle.check();
        await action('all').click();
        assert.deepEqual(await page.evaluate(() => [controlResult.rp, controlResult.sl]), [145800, 226000]);
        await action('clear').click();
        await target.click();
        await action('calculate').click();
        await page.waitForFunction(() => [...document.querySelectorAll('[data-mod-id] img')].every(i => i.complete && i.naturalWidth > 0));
        for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
          await page.evaluate(locale => setLanguage(locale), locale);
          const layout = await page.locator('#modificationDialog').evaluate(dialog => {
            const box = el => { const r = el.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
            const selectors = ['.modification-titlebar', '.modification-toolbar', '.modification-viewport', '.modification-footer'];
            const regions = selectors.map(s => box(dialog.querySelector(s)));
            const controls = [...dialog.querySelectorAll('[data-modification-mode], [data-modification-action], .modification-air-combat')].filter(el => el.getBoundingClientRect().width).map(el => ({ ...box(el), text: el.getAttribute('aria-label') || el.textContent.trim(), clipped: el.scrollWidth > el.clientWidth + 1 }));
            const legends = [...dialog.querySelectorAll('.modification-legend > span')].filter(el => el.getBoundingClientRect().width).map(box);
            return { regions, controls, legends, legendBox: box(dialog.querySelector('.modification-legend')), treeHeight: regions[2].height, outerScroll: dialog.scrollHeight - dialog.clientHeight };
          });
          assert(layout.treeHeight > 80, `${mode} ${width} ${locale}: tree too short ${layout.treeHeight}`);
          assert(layout.outerScroll < 2, `${mode} ${width} ${locale}: outer scroll`);
          layout.regions.forEach((r, i) => {
            assert(r.left >= 0 && r.right <= width + 1 && r.top >= 0 && r.bottom <= height + 1, `${locale}: region outside screen`);
            if (i) assert(layout.regions[i - 1].bottom <= r.top + 1, `${locale}: overlapping regions`);
          });
          layout.controls.forEach(c => {
            assert(c.height >= 40 && c.width >= 44, `${locale}: small control ${c.text}`);
            assert(!c.clipped, `${locale}: clipped control ${c.text}`);
            assert(c.left >= 0 && c.right <= width + 1, `${locale}: control offscreen ${c.text}`);
          });
          layout.legends.forEach(l => assert(l.left >= layout.legendBox.left - 1 && l.right <= layout.legendBox.right + 1, `${locale}: legend exceeds its column`));
          for (let i = 0; i < layout.controls.length; i++) for (const b of layout.controls.slice(i + 1)) {
            const a = layout.controls[i];
            assert(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1, `${locale}: controls overlap`);
          }
          for (const name of ['clear', 'all']) {
            assert.equal(await action(name).locator('.modification-action-icon').count(), 1);
            assert((await action(name).getAttribute('aria-label')).length > 0);
            assert.equal(await action(name).getAttribute('aria-label'), await action(name).locator('.modification-action-label').textContent());
          }
          const iconUrls = await page.locator('.modification-action-icon').evaluateAll(icons => icons.map(el => getComputedStyle(el).maskImage.match(/url\("?([^"\)]+)/)?.[1]));
          for (const url of iconUrls) {
            assert(url);
            const response = await page.request.get(url);
            assert(response.ok());
            assert((await response.text()).includes('<svg'));
          }
          await page.screenshot({ path: path.join(output, `${mode}-${width}-${locale}.png`) });
        }
        if (!mobile) {
          await action('clear').hover();
          assert(await action('clear').locator('.modification-action-label').isVisible());
          await action('clear').focus();
          await page.keyboard.press('Tab');
          assert(await action('all').evaluate(el => el.matches(':focus-visible')));
        }
        await page.locator('[data-modification-close]').click();
        await page.evaluate(() => ModificationWorkbench.open('ussr_object_416'));
        assert(!(await toggle.isVisible()));
        await action('all').click();
        assert.deepEqual(await page.evaluate(() => [controlResult.rp, controlResult.sl]), [88600, 147600]);
        await page.screenshot({ path: path.join(output, `${mode}-${width}-ground.png`) });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ mode, width, height, locales: 7, progress: true, clear: true, costs: true, images: true, passed: true }));
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
