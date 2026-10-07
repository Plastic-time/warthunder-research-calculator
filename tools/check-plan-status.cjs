const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const output = path.resolve('logs/plan-status');
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    const remote = process.argv.find(arg => /^https?:/.test(arg));
    for (const mode of remote ? ['remote'] : ['pages', 'local']) for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 940 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      await page.goto(remote || `http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`);
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading);
      for (const name of ['target', 'route', 'layers', 'map-pin', 'check']) {
        assert((await page.request.get(new URL(`assets/navigation/${name}.svg`, page.url()).href)).ok());
      }
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await page.evaluate(locale => { els.clearButton.click(); setLanguage(locale); }, locale);
        await page.evaluate(() => document.fonts.ready);
        const result = await page.evaluate(() => {
          const tiles = [...els.treeContainer.querySelectorAll('.unit-tile')].filter(tile => !tile.matches('.unlocked,.squadron,.premium'));
          const ids = tiles.slice(0, 5).map(tile => tile.dataset.unitId);
          const dimensions = ids.map(id => {
            const r = els.treeContainer.querySelector(`[data-unit-id="${id}"]`).getBoundingClientRect();
            return [r.width, r.height];
          });
          // Isolated presentation fixture covers every state, including priority conflicts.
          state.planned = new Set([ids[0]]);
          state.owned = new Set([ids[3]]);
          state.waypoints = new Set([ids[4]]);
          state.planResult = { selectedIds: ids, fillerIds: [ids[2]], targetIds: [ids[0]] };
          const snapshot = JSON.stringify([state.planResult, [...state.planned], [...state.owned], [...state.waypoints], state.progressRp]);
          renderTree();
          const failures = [];
          const kinds = ['target', 'required', 'filler', 'owned', 'waypoint'];
          const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          ids.forEach((id, index) => {
            const tile = els.treeContainer.querySelector(`[data-unit-id="${id}"]`);
            const r = tile.getBoundingClientRect(), label = tile.querySelector('.plan-status');
            const rect = label.getBoundingClientRect(), shell = tile.parentElement;
            if (tile.dataset.planState !== kinds[index]) failures.push('wrong state: ' + id);
            if (tile.querySelectorAll('.plan-status').length !== 1) failures.push('duplicate labels');
            if (r.width !== dimensions[index][0] || r.height !== dimensions[index][1]) failures.push('resized card: ' + id);
            if (label.scrollWidth > label.clientWidth + 1) failures.push('label overflow: ' + label.textContent);
            if (rect.left < r.left || rect.right > r.right) failures.push('label outside card width');
            for (const el of shell.querySelectorAll('.unit-wiki-launch,.unit-modifications-launch,.unit-title')) {
              if (overlap(rect, el.getBoundingClientRect())) failures.push('label overlaps ' + el.className);
            }
            if (getComputedStyle(label.querySelector('.plan-status-icon')).maskImage === 'none') failures.push('missing icon');
          });
          if (snapshot !== JSON.stringify([state.planResult, [...state.planned], [...state.owned], [...state.waypoints], state.progressRp])) failures.push('render changed plan');
          state.planned.add(ids[3]);
          if (getUnitCardStatus(ids[3]).kind !== 'owned') failures.push('ownership precedence');
          state.planned.delete(ids[3]);
          state.planResult.fillerIds.push(ids[0]);
          if (getUnitCardStatus(ids[0]).kind !== 'target') failures.push('target precedence');
          state.planResult.fillerIds.pop();
          return { ids, failures };
        });
        assert.deepEqual(result.failures, [], `${mode} ${width} ${locale}`);
        if (locale === 'zh') {
          await page.waitForFunction(() => [...document.querySelectorAll('.tree-canvas .unit-tile > img')].slice(0, 6).every(i => i.complete && i.naturalWidth));
          await page.screenshot({ path: path.join(output, `${mode}-${width}-status-fixture.png`) });
        }
        await page.evaluate(() => els.clearButton.click());
        assert.equal(await page.locator('.tree-canvas .plan-status').count(), 0, 'Clear restores neutral cards');
      }
      // Exercise the real planner separately from the visual state fixture.
      await page.evaluate(() => {
        setLanguage('zh');
        const unit = state.units.find(u => u.rank === 'III' && !u.parent_group_id && parseNumber(u.rp) > 10000 && !isInitialUnlockedUnit(u));
        if (!unit) throw new Error('Missing real planning target');
        toggleUnit(unit.data_unit_id);
        runExactPlan();
      });
      await page.waitForFunction(() => state.planResult && !els.planButton.disabled);
      assert(await page.locator('.tree-canvas [data-plan-state="target"]').count());
      assert(await page.locator('.tree-canvas [data-plan-state="required"]').count());
      const unchanged = await page.evaluate(() => {
        const before = JSON.stringify([state.planResult, state.missing, els.budgetRp.textContent, els.budgetSl.textContent]);
        renderTree();
        return before === JSON.stringify([state.planResult, state.missing, els.budgetRp.textContent, els.budgetSl.textContent]);
      });
      assert(unchanged, 'Real plan and budget unchanged by presentation');
      await page.screenshot({ path: path.join(output, `${mode}-${width}-real-plan.png`) });
      const exported = await page.evaluate(() => {
        const source = els.treeContainer.querySelector('.tree-canvas');
        const host = document.createElement('div');
        host.className = 'tree-screenshot';
        host.style.cssText = 'position:absolute;left:-100000px;top:0';
        const clone = source.cloneNode(true);
        host.append(clone); document.body.append(host);
        try {
          return [...clone.querySelectorAll('.plan-status')].every(label =>
            getComputedStyle(label).position === 'absolute' &&
            getComputedStyle(label.querySelector('.plan-status-icon')).maskImage !== 'none') &&
            clone.querySelectorAll('.plan-status').length === source.querySelectorAll('.plan-status').length;
        } finally { host.remove(); }
      });
      assert(exported, 'Export clone retains status icons and labels');
      const removed = await page.evaluate(() => {
        const tile = els.treeContainer.querySelector('[data-plan-state="required"]');
        const id = tile.dataset.unitId;
        const targets = [...state.planned];
        toggleUnit(id);
        return { neutral: !els.treeContainer.querySelector(`[data-unit-id="${id}"]`).dataset.planState,
          sameTargets: JSON.stringify(targets) === JSON.stringify([...state.planned]) };
      });
      assert(removed.neutral && removed.sameTargets, 'Removing an automatic pick restores neutral state without creating targets');
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, width, languages: 7, passed: true }));
      await page.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
