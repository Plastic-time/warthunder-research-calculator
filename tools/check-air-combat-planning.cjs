const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const output = path.resolve('logs/air-combat-planning-check');
  fs.mkdirSync(output, { recursive: true });
  let server, browser;
  try {
    const app = express();
    app.use('/pages', express.static(path.resolve('docs')));
    app.use(require('../main'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const mode of ['local', 'pages']) for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const open = async () => {
        await page.waitForFunction(() => ModificationWorkbench.hasVehicle('rafale_eg_greece'));
        await page.evaluate(async () => {
          const plan = ModificationPlanner.plan;
          ModificationPlanner.plan = (...args) => {
            const result = plan(...args);
            window.testAirCombatResult = result;
            return result;
          };
          await ModificationWorkbench.open('rafale_eg_greece');
        });
      };
      await page.goto(base + (mode === 'pages' ? '/pages/' : '/'), { waitUntil: 'domcontentloaded' });
      await open();
      const toggle = page.locator('[data-modification-air-combat]');
      const calculate = page.locator('[data-modification-action="calculate"]');
      const mawId = 'MAW_system_heli_false_thermal_targets_large';
      await page.locator('[data-mod-id="fr_mica_em"]').click();
      assert(await toggle.isChecked(), 'Default enabled');
      await calculate.click();
      let result = await page.evaluate(() => testAirCombatResult);
      assert.deepEqual(result.priorityIds, [mawId]);
      assert.equal(result.rp, 63000);
      assert.equal(result.sl, 95000);
      assert.equal(result.tierCounts[1], 1);
      assert.equal(result.tierCounts[2], 3);
      await page.waitForFunction(() => document.querySelectorAll('.modification-link').length === 2);
      assert.equal(await page.locator('.modification-link').count(), 2);
      assert.equal(await page.locator('.modification-tile.priority').count(), 1);
      await page.screenshot({ path: path.join(output, mode + '-' + width + '-enabled.png') });
      for (const id of ['new_compressor_jet', 'hydravlic_power', 'structure_str', 'f_4c_g_suit']) {
        await page.locator('[data-mod-id="' + id + '"]').click({ button: 'right' });
      }
      await calculate.click();
      assert.equal(await page.evaluate(() => testAirCombatResult.rp), 27000);
      await toggle.uncheck();
      const pointerFocus = await toggle.evaluate(input => ({
        shadow: getComputedStyle(input).boxShadow,
        height: input.getBoundingClientRect().height,
      }));
      assert.equal(pointerFocus.shadow, 'none', 'No green focus shadow after clicking');
      assert.equal(pointerFocus.height, 18, 'Checkbox must not inherit the text input height');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      assert(await toggle.evaluate(input => document.activeElement === input && input.matches(':focus-visible')
        && getComputedStyle(input).outlineStyle === 'solid'), 'Keep keyboard focus visible');
      assert.deepEqual(await page.evaluate(() => testAirCombatResult.includedIds), ['fr_mica_em']);
      assert.equal(await page.evaluate(() => testAirCombatResult.rp), 15000);
      assert.equal(await page.locator('.modification-tile.priority').count(), 0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await open();
      assert(!await toggle.isChecked(), 'Remember disabled after refresh');
      await toggle.check();
      await page.locator('[data-mod-id="' + mawId + '"]').click({ button: 'right' });
      await calculate.click();
      assert.equal(await page.evaluate(() => testAirCombatResult.rp), 15000);
      assert.deepEqual(await page.evaluate(() => testAirCombatResult.priorityIds), []);
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await page.evaluate(locale => WTI18n.setLocale(locale), locale);
        const label = await page.locator('.modification-air-combat span').innerText();
        assert(label.length);
        if (locale !== 'zh') assert(!label.includes('空战'));
        const geometry = await page.evaluate(() => {
          const bounds = selector => {
            const e = document.querySelector(selector), r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, overflow: e.scrollWidth > e.clientWidth + 1 };
          };
          return { dialog: bounds('#modificationDialog'), label: bounds('.modification-air-combat'),
            title: bounds('.modification-titlebar'), viewport: bounds('#modificationViewport'), footer: bounds('.modification-footer') };
        });
        assert(geometry.label.left >= geometry.dialog.left && geometry.label.right <= geometry.dialog.right);
        assert(!geometry.label.overflow, locale + ': label overflow');
        assert(geometry.viewport.height > 150, locale + ': usable tree viewport');
        assert(geometry.title.bottom <= geometry.viewport.top);
        assert(geometry.viewport.bottom <= geometry.footer.top + 1);
        if (locale === 'fr') await page.screenshot({ path: path.join(output, mode + '-' + width + '-fr.png') });
      }
      await page.locator('[data-modification-action="clear"]').click();
      await calculate.click();
      assert.deepEqual(await page.evaluate(() => testAirCombatResult.includedIds), []);
      await page.locator('[data-modification-close]').click();
      await page.evaluate(() => ModificationWorkbench.open('f_15c_golden_eagle'));
      await page.locator('[data-mod-id="us_aim_120d"]').click();
      await calculate.click();
      const golden = await page.evaluate(() => testAirCombatResult);
      await page.waitForFunction(() => document.querySelectorAll('.modification-link').length === 5);
      assert.equal(await page.locator('.modification-link').count(), 5);
      assert.deepEqual(new Set(golden.dependencyIds), new Set(['us_aim_9m', 'us_aim_120c']));
      assert(golden.fillerIds.includes('hydravlic_power'));
      assert(golden.fillerIds.includes('f_4c_g_suit'));
      assert(golden.fillerIds.includes('uk_ltc_bol'));
      assert(!golden.includedIds.includes('structure_str'));
      assert.equal(golden.rp, 104600);
      assert.equal(golden.sl, 163000);
      await page.evaluate(() => {
        WTI18n.setLocale('zh');
        document.getElementById('modificationViewport').scrollLeft = 0;
      });
      await page.screenshot({ path: path.join(output, mode + '-' + width + '-golden-eagle.png') });
      await page.locator('[data-modification-close]').click();
      for (const [vehicle, target, arrows] of [
        ['f_15i_raam', 'hp_105_jet', 8],
        ['f_14b', 'uk_ltc_bol', 6],
        ['saab_ja37d', 'swd_ltc_bol', 3],
      ]) {
        await page.evaluate(id => ModificationWorkbench.open(id), vehicle);
        await page.locator('[data-mod-id="' + target + '"]').click();
        await calculate.click();
        await page.waitForFunction(count => document.querySelectorAll('.modification-link').length === count, arrows);
        const checked = await page.evaluate(() => testAirCombatResult);
        if (vehicle === 'f_15i_raam') {
          assert(!checked.dependencyIds.includes('new_compressor_jet'));
          assert(!checked.dependencyIds.includes('hydravlic_power'));
          assert(!checked.dependencyIds.includes('cd_98'));
        } else {
          assert(checked.dependencyIds.includes('countermeasures_belt_pack'));
          await toggle.uncheck();
          assert((await page.evaluate(() => testAirCombatResult)).dependencyIds.includes('countermeasures_belt_pack'));
        }
        await page.evaluate(() => { document.getElementById('modificationViewport').scrollLeft = 0; });
        await page.screenshot({ path: path.join(output, mode + '-' + width + '-' + vehicle + '.png') });
        await page.locator('[data-modification-close]').click();
      }
      await page.evaluate(() => ModificationWorkbench.open('us_m2a4'));
      assert(!await toggle.isVisible(), 'No aircraft preference on tanks');
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, width, defaultOn: true, persistentToggle: true, noFakeArrows: true, locales: 7, passed: true }));
      await page.close();
    }
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
