const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const baseline = process.argv.includes('--baseline');
  const output = path.resolve('logs/new-vehicle-status');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    for (const mode of ['pages', 'local']) for (const width of [1440, 390]) for (const zoom of [1, 1.5]) {
      const page = await browser.newPage({ viewport: { width: Math.round(width / zoom), height: Math.round(940 / zoom) },
        deviceScaleFactor: zoom, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`);
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading);
      await page.evaluate(async () => {
        els.countrySelect.value = 'china'; els.typeSelect.value = 'aviation';
        await loadTree();
      });
      for (const kind of ['target', 'required', 'filler', 'owned', 'waypoint']) {
        await page.evaluate(kind => {
          els.clearButton.click();
          if (kind === 'required' || kind === 'filler') {
            state.planResult = { selectedIds: ['j_16'], fillerIds: kind === 'filler' ? ['j_16'] : [] };
            calculatePlan();
          } else toggleUnitMode('j_16', kind);
        }, kind);
        const tile = page.locator('.tree-canvas [data-unit-id="j_16"]');
        await tile.locator(':scope > img').evaluate(img => img.decode());
        await tile.evaluate(tile => {
          const tree = els.treeContainer, r = tile.getBoundingClientRect(), t = tree.getBoundingClientRect();
          tree.scrollLeft += r.left - t.left - (t.width - r.width) / 2;
          tree.scrollTop += r.top - t.top - 80;
        });
        await page.waitForTimeout(100);
        const result = await tile.evaluate(tile => {
          const badge = tile.querySelector('.plan-status'), edge = tile.querySelector('.unit-update-edge');
          const b = badge.getBoundingClientRect(), e = edge.getBoundingClientRect();
          const x = Math.min(b.right, e.right) - 3, y = Math.max(b.top, e.top) + 2;
          // Enable hit testing temporarily to inspect paint order at the actual overlap.
          const badgeStyle = badge.style.pointerEvents, edgeStyle = edge.style.pointerEvents;
          badge.style.pointerEvents = edge.style.pointerEvents = 'auto';
          let top;
          try { top = document.elementFromPoint(x, y); }
          finally { badge.style.pointerEvents = badgeStyle; edge.style.pointerEvents = edgeStyle; }
          return { kind: tile.dataset.planState, badgeAbove: badge === top || badge.contains(top),
            overlap: x > b.left && x < b.right && y > b.top && y < b.bottom && y < e.bottom,
            title: tile.querySelector('.unit-title').textContent, width: tile.getBoundingClientRect().width };
        });
        assert.equal(result.kind, kind);
        assert(result.overlap, 'Regression point must cover the new-vehicle edge and status tab');
        if (!baseline) assert(result.badgeAbove, `${mode} ${width} ${zoom} ${kind}: new-vehicle edge hides status`);
        if (kind === 'target') {
          const r = await tile.boundingBox();
          await page.screenshot({ path: path.join(output, `${baseline ? 'before' : 'after'}-${mode}-${width}-${zoom}.png`),
            clip: { x: r.x, y: r.y - 24, width: r.width, height: r.height + 26 } });
        }
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, width, zoom, states: 5, baseline, passed: true }));
      await page.close();
    }
  } finally {
    await browser?.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
