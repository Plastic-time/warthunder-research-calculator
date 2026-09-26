const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const output = path.resolve('logs/bulk-owned-check');
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
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`);
      await page.waitForFunction(() => document.querySelector('.unit-tile') && state.units.length);
      await page.evaluate(() => { els.clearButton.click(); toggleUnitMode('us_m18_hellcat', 'target'); runExactPlan(); });
      await page.waitForFunction(() => state.planResult && !els.planButton.disabled);
      const candidates = await page.evaluate(() => getRankOwnedCandidates('II').map(unit => unit.data_unit_id));
      assert(candidates.length > 3);
      assert(await page.evaluate(() => getRankOwnedCandidates('II').some(unit => unit.parent_group_id)));
      // Start with a target and waypoint in the affected rank, plus an existing owned unit.
      await page.evaluate(ids => {
        toggleUnitMode(ids[0], 'target'); toggleUnitMode(ids[1], 'waypoint'); toggleUnitMode(ids[2], 'owned');
      }, candidates);
      const snapshot = () => page.evaluate(() => ({
        owned: [...state.owned], planned: [...state.planned], waypoints: [...state.waypoints],
        route: state.planResult, missing: state.missing.map(unit => unit.data_unit_id),
        saved: localStorage.getItem(storageKey()),
      }));
      const before = await snapshot();
      const trigger = page.locator('[data-owned-rank="II"]');
      const activate = async locator => width < 720 ? locator.tap() : locator.click();
      await activate(trigger);
      assert(await page.locator('.bulk-owned-dialog').isVisible());
      assert.equal(await page.locator('.bulk-owned-dialog li').count(), candidates.length - 1);
      await page.screenshot({ path: path.join(output, `${mode}-${width}-confirm.png`) });
      await activate(page.locator('[data-bulk-cancel]'));
      assert.deepEqual(await snapshot(), before);
      await activate(trigger);
      await activate(page.locator('[data-bulk-confirm]'));
      const after = await snapshot();
      assert.deepEqual([...after.owned].sort(), [...new Set([...before.owned, ...candidates])].sort());
      assert.deepEqual(after.planned, before.planned.filter(id => !candidates.includes(id)));
      assert.deepEqual(after.waypoints, before.waypoints.filter(id => !candidates.includes(id)));
      assert.deepEqual(after.route.selectedIds, before.route.selectedIds.filter(id => !candidates.includes(id)));
      assert(after.route.dirty);
      assert(!after.missing.some(id => candidates.includes(id)));
      assert(await page.locator('.bulk-owned-notice').isVisible());
      const geometry = await page.evaluate(() => {
        const notice = bulkOwnedNotice.getBoundingClientRect();
        const budget = document.querySelector('.floating-budget').getBoundingClientRect();
        return { left: notice.left, right: notice.right, bottom: notice.bottom, budgetTop: budget.top };
      });
      assert(geometry.left >= 0 && geometry.right <= width && geometry.bottom <= geometry.budgetTop);
      await page.screenshot({ path: path.join(output, `${mode}-${width}-marked.png`) });
      await activate(page.locator('.bulk-owned-notice button'));
      assert.deepEqual(await snapshot(), before);
      // Search must not narrow the bulk operation to only matching cards.
      await page.evaluate(() => { state.search = 'M4'; els.searchInput.value = 'M4'; renderTree(); });
      assert.deepEqual(await page.evaluate(() => getRankOwnedCandidates('II').map(unit => unit.data_unit_id)), candidates.filter(id => id !== before.owned[0]));
      await page.evaluate(() => { state.search = ''; els.searchInput.value = ''; renderTree(); });
      await activate(trigger);
      await activate(page.locator('[data-bulk-confirm]'));
      await page.reload();
      await page.waitForFunction(() => state.units.length && document.querySelector('.unit-tile'));
      assert.deepEqual((await snapshot()).owned.sort(), after.owned.sort());
      assert(!await page.locator('.bulk-owned-notice').isVisible());
      await activate(page.locator('[data-owned-rank="II"]'));
      assert(await page.locator('[data-bulk-confirm]').isDisabled());
      await page.keyboard.press('Escape');
      // Clearing or editing after a batch cannot leave a destructive stale undo action.
      await page.evaluate(() => { els.clearButton.click(); markRankOwned('II'); toggleUnitMode('us_m18_hellcat', 'target'); });
      assert(!await page.locator('.bulk-owned-notice').isVisible());
      await page.evaluate(() => { els.clearButton.click(); markRankOwned('II'); els.clearButton.click(); undoBulkOwned(); });
      assert.equal((await snapshot()).owned.length, 0);
      // A second batch can be undone without reverting the first batch.
      await page.evaluate(() => { markRankOwned('I'); });
      const firstBatch = await snapshot();
      await page.evaluate(() => { markRankOwned('II'); undoBulkOwned(); });
      assert.deepEqual(await snapshot(), firstBatch);
      await page.evaluate(() => { els.clearButton.click(); });
      await page.evaluate(() => { markRankOwned('II'); });
      await page.evaluate(async () => { els.countrySelect.value = 'germany'; await loadTree(); undoBulkOwned(); });
      assert.equal((await snapshot()).owned.length, 0);
      assert(!await page.locator('.bulk-owned-notice').isVisible());
      // Missing classification is never treated as proof that a vehicle is standard.
      assert(await page.evaluate(() => {
        const original = RosterAudit.info;
        try { RosterAudit.info = () => null; return getRankOwnedCandidates('II').length === 0; }
        finally { RosterAudit.info = original; }
      }));
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await page.evaluate(locale => { setLanguage(locale); openRankOwnedDialog('II'); }, locale);
        assert(await page.evaluate(() => {
          const dialog = bulkOwnedDialog.getBoundingClientRect();
          return dialog.left >= 0 && dialog.right <= innerWidth && bulkOwnedDialog.scrollWidth <= bulkOwnedDialog.clientWidth;
        }));
        if (locale !== 'zh' && locale !== 'ja') assert(!/[\u4e00-\u9fff]/.test(await page.locator('#bulkOwnedTitle').innerText()));
        await page.locator('[data-bulk-cancel]').click();
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(JSON.stringify({ mode, width, candidates: candidates.length, cancel: true, undo: true, persist: true, routePreserved: true, locales: 7, passed: true }));
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
