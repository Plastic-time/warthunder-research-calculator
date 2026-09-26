const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const express = require('express');
const {chromium} = require('playwright');

async function main() {
  const output = path.resolve('logs/editable-route-check');
  fs.mkdirSync(output, {recursive: true});
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({channel: 'chrome', headless: true});
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const page = await browser.newPage({viewport: {width, height: 900}, isMobile: width < 720, hasTouch: width < 720});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('.unit-tile') && window.LocalPlanner);
      await page.evaluate(async () => {
        els.countrySelect.value = 'usa'; els.typeSelect.value = 'ground';
        await loadTree(); els.clearButton.click(); toggleUnitMode('us_m18_hellcat', 'target');
      });
      const plan = async () => {
        await page.locator('#planButton').click();
        await page.waitForFunction(() => state.planResult && !state.planResult.dirty && !els.planButton.disabled);
      };
      const snapshot = () => page.evaluate(() => ({
        selected: [...state.planResult.selectedIds], fillers: [...state.planResult.fillerIds],
        targets: [...state.planned], owned: [...state.owned], dirty: !!state.planResult.dirty,
        rp: state.missing.reduce((sum, unit) => sum + parseNumber(unit.rp), 0),
        sl: state.missing.reduce((sum, unit) => sum + parseNumber(unit.sp), 0),
        missing: state.missing.map(unit => unit.data_unit_id),
      }));
      await plan();
      const original = await snapshot();
      assert(original.fillers.length > 1);
      const removed = original.fillers[0];
      const price = await page.evaluate(id => [parseNumber(state.unitMap.get(id).rp), parseNumber(state.unitMap.get(id).sp)], removed);
      // Invoke the same selection callback used by tree clicks and mobile taps.
      await page.evaluate(id => toggleUnit(id), removed);
      let edited = await snapshot();
      assert.deepEqual(edited.selected, original.selected.filter(id => id !== removed));
      assert.deepEqual(edited.targets, original.targets);
      assert(edited.dirty);
      assert.equal(edited.rp, original.rp - price[0]);
      assert.equal(edited.sl, original.sl - price[1]);
      const visualState = id => page.evaluate(id => {
        const container = document.createElement('div');
        container.innerHTML = renderUnit(state.unitMap.get(id), true);
        const tile = container.querySelector('[data-unit-id]');
        return {classes: [...tile.classList], labels: [...tile.querySelectorAll('.target-label, .filler-label, .auto-planned-label, .waypoint-label')].map(el => el.className)};
      }, id);
      const unselected = await visualState(removed);
      assert(!unselected.classes.some(name => ['planned', 'missing', 'rank-filler', 'auto-planned', 'waypoint'].includes(name)));
      assert.deepEqual(unselected.labels, []);
      assert(!(await page.locator('#plannerStatus').innerText()).includes('已找到最低'));
      await page.reload({waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('.unit-tile') && state.planResult?.dirty);
      assert.deepEqual((await snapshot()).selected, edited.selected);
      await page.evaluate(id => toggleUnit(id), removed);
      const restored = await snapshot();
      assert.deepEqual([...restored.selected].sort(), [...original.selected].sort());
      assert.deepEqual(restored.targets, original.targets);
      assert(restored.fillers.includes(removed));
      assert(!(await visualState(removed)).classes.includes('planned'));
      assert((await visualState(removed)).classes.includes('rank-filler'));
      await page.evaluate(id => toggleUnit(id), removed);
      assert.deepEqual((await snapshot()).selected, edited.selected);
      assert.deepEqual((await visualState(removed)).labels, []);

      const owned = edited.fillers[0];
      await page.evaluate(id => openUnitContextMenu(id, 100, 200), owned);
      await page.locator('[data-context-action="owned"]').click();
      const afterOwned = await snapshot();
      assert.deepEqual(afterOwned.selected, edited.selected.filter(id => id !== owned));
      assert(afterOwned.owned.includes(owned));
      assert(!afterOwned.missing.includes(owned));
      assert.deepEqual(afterOwned.targets, original.targets);
      assert(await page.evaluate(() => [...document.querySelectorAll('[data-folder-group]')].every(button => {
        const group = state.groupMap.get(button.dataset.folderGroup);
        const expected = group.items.filter(unit => state.planResult.selectedIds.includes(unit.data_unit_id) && !state.owned.has(unit.data_unit_id)).length;
        return Number(button.closest('.folder-tile').querySelector('.folder-selection-count')?.dataset.selectedCount || 0) === expected;
      })));
      await page.screenshot({path: path.join(output, `${mode}-${width}-edited.png`)});
      await plan();
      edited = await snapshot();
      assert(!edited.owned.some(id => edited.selected.includes(id)));
      assert.deepEqual(edited.targets, original.targets);
      assert(await page.evaluate(() => state.planResult.feasible));
      // Changing a filler to a waypoint must not discard the rest of the route.
      const waypoint = edited.fillers[0];
      await page.evaluate(id => toggleUnitMode(id, 'waypoint'), waypoint);
      assert.deepEqual((await snapshot()).selected, edited.selected);
      await page.evaluate(id => toggleUnit(id), waypoint);
      assert.deepEqual((await snapshot()).selected, edited.selected.filter(id => id !== waypoint));
      const beforeFailure = (await snapshot()).selected;
      await page.evaluate(() => { window.savedPlanner = LocalPlanner.plan; LocalPlanner.plan = () => {throw Error('test failure');}; runExactPlan(); });
      await page.waitForFunction(() => !els.planButton.disabled);
      assert.deepEqual((await snapshot()).selected, beforeFailure);
      await page.evaluate(() => {LocalPlanner.plan = window.savedPlanner; delete window.savedPlanner;});
      if (width < 720) await page.locator('#mobileMoreButton').click();
      await page.locator('#clearButton').click();
      assert(await page.evaluate(() => !state.planResult && !state.planned.size && !state.owned.size && !state.waypoints.size && !state.missing.length));
      await page.reload({waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('.unit-tile'));
      assert(await page.evaluate(() => !state.planResult && !state.owned.size && !state.missing.length));
      assert.deepEqual(errors, []);
      await page.close();
      console.log(JSON.stringify({mode, width, preserveRoute: true, ownedExcluded: true, persisted: true, replan: true, clear: true, passed: true}));
    }
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error.stack); process.exitCode = 1;});
