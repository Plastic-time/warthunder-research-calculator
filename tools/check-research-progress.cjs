const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { checkMobileLongPress } = require('./check-mobile-long-press.cjs');

async function main() {
  const out = path.resolve('logs/research-progress-check');
  fs.mkdirSync(out, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:' + server.address().port + (mode === 'pages' ? '/pages/' : '/'), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => state.units.length && window.ModificationWorkbench && document.querySelector('.unit-tile'));
      if (width < 720) {
        const session = await page.context().newCDPSession(page);
        await checkMobileLongPress({
          evaluate: source => page.evaluate(source), call: (name, args) => session.send(name, args),
          artifacts: out, suffix: mode + '-progress',
        });
        await session.detach();
      }
      const unit = await page.evaluate(() => {
        els.clearButton.click();
        const unit = state.unitMap.get('us_m18_hellcat');
        toggleUnitMode(unit.data_unit_id, 'target');
        return { id: unit.data_unit_id, total: parseNumber(unit.rp), sl: parseNumber(unit.sp) };
      });
      const spent = Math.floor(unit.total * 0.6);
      const openUnit = async () => {
        await page.evaluate(id => openUnitContextMenu(id, 90, 220), unit.id);
        await page.locator('[data-edit-unit-progress]').click();
        await page.locator('.research-progress-dialog').waitFor({ state: 'visible' });
      };
      await openUnit();
      await page.locator('#researchProgressInput').fill(String(spent));
      await page.locator('[data-progress-cancel]').click();
      assert.equal(await page.evaluate(id => state.progressRp[id] || 0, unit.id), 0);
      await openUnit();
      for (const invalid of ['-1', '1.5', String(unit.total + 1)]) {
        await page.locator('#researchProgressInput').fill(invalid);
        await page.locator('[data-progress-save]').click();
        assert(await page.locator('.research-progress-dialog').isVisible());
      }
      await page.locator('#researchProgressInput').fill(String(spent));
      await page.screenshot({ path: path.join(out, mode + '-' + width + '-vehicle-editor.png') });
      await page.locator('[data-progress-save]').click();
      assert.equal(await page.evaluate(id => state.progressRp[id], unit.id), spent);
      assert.equal(await page.locator('#budgetRp').innerText(), (unit.total - spent).toLocaleString('zh-CN'));
      assert.equal(await page.locator('#budgetSl').innerText(), unit.sl.toLocaleString('zh-CN'));
      assert.equal(await page.evaluate(() => buildRouteExportPayload().totalRp), (unit.total - spent).toLocaleString('zh-CN'));
      assert.equal(await page.evaluate(id => parseNumber(state.unitMap.get(id).rp), unit.id), unit.total);
      await page.reload();
      await page.waitForFunction(() => state.units.length && document.querySelector('.unit-tile'));
      assert.equal(await page.evaluate(id => state.progressRp[id], unit.id), spent);
      await page.locator('#planButton').click();
      await page.waitForFunction(() => state.planResult && !state.planResult.dirty && !els.planButton.disabled);
      assert(await page.evaluate(() => state.planResult.totalRp === state.missing.reduce((sum, unit) => sum + (remainingUnitRp(unit) || 0), 0)));
      await page.evaluate(async () => {
        els.countrySelect.value = 'germany';
        await loadTree();
        const other = state.units.find(canEditUnitProgress);
        state.progressRp[other.data_unit_id] = 1;
        saveState();
      });
      assert.equal(await page.evaluate(id => state.progressRp[id] || 0, unit.id), 0);
      await page.evaluate(async () => { els.countrySelect.value = 'usa'; await loadTree(); });
      assert.equal(await page.evaluate(id => state.progressRp[id], unit.id), spent);
      await openUnit();
      await page.locator('#researchProgressInput').fill(String(unit.total));
      await page.locator('[data-progress-save]').click();
      assert(await page.evaluate(id => !state.owned.has(id) && !state.initialUnlocked.has(id) && state.planned.has(id), unit.id));
      await openUnit();
      await page.locator('#researchProgressInput').fill('0');
      await page.locator('[data-progress-save]').click();
      assert.equal(await page.evaluate(id => remainingUnitRp(state.unitMap.get(id)), unit.id), unit.total);
      // Editors follow all seven languages; no new dynamic key may silently fall back.
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await page.evaluate(locale => { setLanguage(locale); WTI18n.missing.clear(); }, locale);
        await openUnit();
        assert.deepEqual(await page.evaluate(() => [...WTI18n.missing]), []);
        assert(await page.evaluate(() => {
          const dialog = document.querySelector('.research-progress-dialog');
          const rect = dialog.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth;
        }));
        await page.locator('[data-progress-cancel]').click();
      }
      await page.evaluate(() => setLanguage('zh'));
      await page.evaluate(id => ModificationWorkbench.open(id), unit.id);
      await page.waitForSelector('.modification-tile:not(:disabled)');
      const mod = await page.locator('.modification-tile:not(:disabled)').first().evaluate(tile => ({
        id: tile.dataset.modId,
        total: Number(tile.querySelector('small').textContent.match(/([\d,]+) RP/)[1].replaceAll(',', '')),
      }));
      const tile = page.locator('[data-mod-id="' + mod.id + '"]');
      await tile.click();
      const sl = await page.locator('#modificationSl').innerText();
      await page.locator('[data-modification-mode="progress"]').click();
      await tile.click();
      const invested = Math.floor(mod.total / 2);
      await page.locator('#researchProgressInput').fill(String(invested));
      await page.locator('[data-progress-save]').click();
      assert.equal(await page.locator('#modificationRp').innerText(), (mod.total - invested).toLocaleString('zh-CN'));
      assert.equal(await page.locator('#modificationSl').innerText(), sl);
      assert(await page.locator('#modificationDialog').isVisible());
      await page.locator('[data-modification-action="calculate"]').click();
      assert.equal(await page.locator('#modificationRp').innerText(), (mod.total - invested).toLocaleString('zh-CN'));
      await page.screenshot({ path: path.join(out, mode + '-' + width + '-modifications.png') });
      await page.locator('[data-modification-close]').click();
      await page.evaluate(async current => {
        const other = state.units.find(unit => unit.data_unit_id !== current && ModificationWorkbench.hasVehicle(unit.data_unit_id));
        await ModificationWorkbench.open(other.data_unit_id);
      }, unit.id);
      assert.equal(await page.locator('.modification-rp-progress').count(), 0);
      await page.locator('[data-modification-close]').click();
      await page.evaluate(id => ModificationWorkbench.open(id), unit.id);
      assert.equal(await page.locator('#modificationRp').innerText(), (mod.total - invested).toLocaleString('zh-CN'));
      await page.reload();
      await page.waitForFunction(() => state.units.length && document.querySelector('.unit-tile'));
      await page.evaluate(id => ModificationWorkbench.open(id), unit.id);
      await page.waitForSelector('.modification-tile');
      assert.equal(await page.locator('#modificationRp').innerText(), (mod.total - invested).toLocaleString('zh-CN'));
      await page.locator('[data-modification-mode="progress"]').click();
      await tile.click();
      await page.locator('#researchProgressInput').fill(String(mod.total));
      await page.locator('[data-progress-save]').click();
      assert.equal(await page.locator('#modificationRp').innerText(), '0');
      assert.equal(await tile.evaluate(el => el.classList.contains('unlocked') || el.classList.contains('researched')), false);
      await tile.click();
      await page.locator('#researchProgressInput').fill('');
      await page.locator('[data-progress-save]').click();
      assert.equal(await page.locator('#modificationRp').innerText(), mod.total.toLocaleString('zh-CN'));
      await tile.click();
      await page.locator('#researchProgressInput').fill(String(invested));
      await page.locator('[data-progress-save]').click();
      await page.locator('[data-modification-action="clear"]').click();
      assert.equal(await page.locator('.modification-rp-progress').count(), 1, 'Clearing targets preserves research progress');
      await page.locator('[data-modification-mode="select"]').click();
      await tile.click();
      await page.locator('[data-modification-action="clear-owned"]').click();
      assert.equal(await page.locator('.modification-rp-progress').count(), 0);
      assert.equal(await page.locator('#modificationRp').innerText(), mod.total.toLocaleString('zh-CN'));
      await page.reload();
      await page.waitForFunction(() => state.units.length);
      await page.evaluate(id => ModificationWorkbench.open(id), unit.id);
      await page.waitForSelector('.modification-tile');
      assert.equal(await page.locator('.modification-rp-progress').count(), 0, 'Cleared modification progress stays cleared after reload');
      await page.locator('[data-modification-close]').click();
      await openUnit();
      await page.locator('#researchProgressInput').fill(String(spent));
      await page.locator('[data-progress-save]').click();
      const untouched = await page.evaluate(() => {
        const second = state.units.find(unit => canEditUnitProgress(unit) && unit.data_unit_id !== 'us_m18_hellcat');
        state.progressRp[second.data_unit_id] = 1;
        state.planned.delete(second.data_unit_id);
        saveState();
        return localStorage.getItem('wt-research:germany:ground');
      });
      if (width < 720) await page.locator('#mobileMoreButton').tap();
      await page.locator('#clearButton').click();
      assert(await page.evaluate(() => !state.planned.size && !state.owned.size && !state.waypoints.size && !Object.keys(state.progressRp).length));
      assert.equal(await page.locator('.unit-rp-progress').count(), 0);
      assert.equal(await page.locator('#budgetRp').innerText(), '0');
      assert.equal(await page.evaluate(() => localStorage.getItem('wt-research:germany:ground')), untouched, 'Other trees are not cleared');
      await page.reload();
      await page.waitForFunction(() => state.units.length);
      assert(await page.evaluate(() => !Object.keys(state.progressRp).length), 'Progress must stay cleared after reload');
      await page.evaluate(id => toggleUnitMode(id, 'target'), unit.id);
      assert.equal(await page.locator('#budgetRp').innerText(), unit.total.toLocaleString('zh-CN'));
      assert.deepEqual(errors, []);
      await page.close();
      console.log(JSON.stringify({ mode, width, persistence: true, budgets: true, export: true, locales: 7, fullRpNotOwnership: true, clearProgress: true, passed: true }));
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
