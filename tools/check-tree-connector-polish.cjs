const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const baseline = process.argv.includes('--baseline');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'logs', 'tree-connector-polish');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    for (const mode of ['pages', 'local']) for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 940 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`);
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => [...document.querySelectorAll('.tree-canvas .unit-tile > img')].slice(0, 6).every(i => i.complete && i.naturalWidth));
      await page.evaluate(() => renderTreeConnections());
      const edges = () => page.evaluate(() => [...document.querySelectorAll('.tree-canvas .tree-links > path')].map(p => [p.dataset.from, p.dataset.to].join(':')).sort());
      const original = await edges();
      const pair = await page.evaluate(() => {
        const canvas = els.treeContainer.querySelector('.tree-canvas');
        const tiles = new Map([...canvas.querySelectorAll('.unit-tile')].map(t => [t.dataset.unitId, t]));
        const edge = [...canvas.querySelectorAll('.tree-links > path')].find(p => {
          const a = tiles.get(p.dataset.from), b = tiles.get(p.dataset.to);
          return a && b && !a.matches('.unlocked,.owned') && !b.matches('.unlocked,.owned')
            && Math.abs(a.getBoundingClientRect().x - b.getBoundingClientRect().x) < 1;
        });
        return [edge.dataset.from, edge.dataset.to];
      });
      await page.screenshot({ path: path.join(output, `${baseline ? 'before' : 'after'}-${mode}-${width}-empty.png`) });
      // A target alone must not claim that its unselected prerequisite is budgeted.
      await page.evaluate(id => { toggleUnit(id); renderTreeConnections(); }, pair[1]);
      const pairSelector = `.tree-canvas .tree-links > path[data-from="${pair[0]}"][data-to="${pair[1]}"]`;
      if (!baseline) assert.equal(await page.locator(pairSelector).getAttribute('class'), '');
      await page.evaluate(id => { toggleUnit(id); renderTreeConnections(); }, pair[0]);
      const snapshot = () => page.evaluate(() => JSON.stringify([state.units, [...state.planned], [...state.owned], state.planResult, els.budgetRp.textContent, els.budgetSl.textContent]));
      const selected = await snapshot();
      await page.evaluate(() => renderTreeConnections());
      assert.equal(await snapshot(), selected, 'Rendering never changes budgets or planning state');
      assert.deepEqual(await edges(), original, 'No relationship added or removed');
      if (!baseline) {
        assert.equal(await page.locator(pairSelector).getAttribute('class'), 'is-route');
        assert.equal(await page.locator(pairSelector).evaluate(p => getComputedStyle(p).strokeWidth), '3px');
        await require('./check-tree-arrows.cjs').checkTreeArrows(expression => page.evaluate(expression));
        const stable = await page.evaluate(() => {
          const source = els.treeContainer.querySelector('.tree-canvas');
          const clone = source.cloneNode(true);
          const host = document.createElement('div');
          host.className = 'tree-screenshot';
          host.style.cssText = 'position:absolute;left:-100000px;top:0';
          host.append(clone); document.body.append(host);
          const old = state.planned;
          state.planned = new Set();
          try {
            renderTreeConnections(clone);
            return clone.querySelectorAll('path.is-route').length === source.querySelectorAll('path.is-route').length;
          } finally { state.planned = old; host.remove(); }
        });
        assert(stable, 'Export derives highlight from the captured cards');
      }
      await page.evaluate(id => {
        const tile = [...els.treeContainer.querySelectorAll('.unit-tile')].find(t => t.dataset.unitId === id);
        const r = tile.getBoundingClientRect(), tree = els.treeContainer.getBoundingClientRect();
        els.treeContainer.scrollTop += r.top - tree.top - 42;
        els.treeContainer.scrollLeft = 0;
      }, pair[0]);
      await page.waitForTimeout(180);
      await page.screenshot({ path: path.join(output, `${baseline ? 'before' : 'after'}-${mode}-${width}-route.png`) });
      if (!baseline) {
        await page.evaluate(id => { toggleUnit(id); renderTreeConnections(); }, pair[0]);
        assert.equal(await page.locator(pairSelector).getAttribute('class'), '', 'Deselect removes route emphasis');
        await page.evaluate(id => { toggleUnitMode(id, 'owned'); renderTreeConnections(); }, pair[0]);
        assert.equal(await page.locator(pairSelector).getAttribute('class'), 'is-route', 'Owned prerequisite connects to pending target');
        await page.evaluate(() => { state.search = 'm'; renderTree(); renderTreeConnections(); });
        assert(await page.locator('.tree-links > path').evaluateAll(paths => paths.every(p => !p.getAttribute('d').includes('NaN'))));
        await page.evaluate(() => { state.search = ''; renderTree(); renderTreeConnections(); });
        const folder = page.locator('[data-folder-key]').first();
        await folder.click();
        await page.waitForSelector('.folder-popup .tree-links > path', { state: 'attached' });
        assert.equal(await page.locator('.folder-popup .tree-links > path').first().evaluate(p => getComputedStyle(p).strokeWidth), '3px');
        assert.equal(await page.locator('.folder-popup .tree-links > path').first().evaluate(p => getComputedStyle(p).stroke), 'rgb(184, 51, 57)');
        await page.locator('.folder-popup-close').click();
        await page.evaluate(() => {
          state.planned = new Set(['us_m18_hellcat']);
          state.owned.clear(); state.waypoints.clear(); state.planResult = null;
          calculatePlan(); runExactPlan();
        });
        await page.waitForFunction(() => !els.planButton.disabled);
        await page.evaluate(() => renderTreeConnections());
        assert(await page.evaluate(() => state.planResult?.selectedIds.length > 1), 'Exact planning completes');
        assert(await page.locator('.tree-canvas .tree-links > path.is-route').count(), 'Automatically included route is emphasized');
        const exact = await snapshot();
        await page.evaluate(() => renderTreeConnections());
        assert.equal(await snapshot(), exact, 'Exact-plan cost remains unchanged');
        assert.deepEqual(await edges(), original);
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({mode,width,relations:original.length,passed:true}));
      await page.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
