const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const baseline = process.argv.includes('--baseline');
const output = path.resolve(process.env.WT_MOBILE_SCREENSHOTS || path.join(__dirname, '../logs/mobile-viewport'));
fs.mkdirSync(output, { recursive: true });
const base = process.argv.find(value => /^https?:/.test(value)) || 'http://127.0.0.1:3020/';
async function metrics(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
    };
    return { rail: rect('.rank-rail'), budget: rect('#floatingBudget'), tree: rect('#treeContainer'),
      tile: rect('.tree-canvas .unit-tile'), button: rect('#planButton') };
  });
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  try {
    for (const [width, height] of [[320,740], [390,844], [430,932], [720,900], [844,390], [1440,940]]) {
      const page = await browser.newPage({ viewport: {width, height}, isMobile: width < 900, hasTouch: width < 900 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => [...document.querySelectorAll('.tree-canvas .unit-tile > img')].slice(0, 6).every(img => img.complete && img.naturalWidth));
      await page.screenshot({path: path.join(output, `${baseline ? 'before' : 'after'}-${width}.png`)});
      const initial = await metrics(page);
      results.push({width, height, ...initial});
      if (!baseline && (width <= 720 || (width <= 900 && height <= 500))) {
        assert.equal(initial.rail.width, 44);
        assert(initial.budget.height < 96, 'Compact default dock');
        assert(initial.button.height >= 44);
        assert(initial.tree.bottom <= height + 1, 'Tree stays inside short viewport');
        assert(await page.evaluate(() => {
          const wrapper = document.createElement('div');
          wrapper.className = 'tree-screenshot';
          wrapper.style.cssText = 'position:absolute;left:-10000px;top:0';
          wrapper.append(document.querySelector('.tree-canvas').cloneNode(true));
          document.body.append(wrapper);
          try { return wrapper.querySelector('.rank-rail').getBoundingClientRect().width === 68; }
          finally { wrapper.remove(); }
        }), 'Export keeps full-size rank rail');
        for (const locale of ['zh','en','ru','de','fr','ja','es']) {
          await page.locator('#mobileFiltersButton').click();
          await page.locator('#languageSelect').selectOption(locale);
          await page.locator('#mobileFilters .mobile-sheet-heading button').click();
          await page.waitForFunction(() => !treeSelectionLoading);
          await page.waitForTimeout(120);
          assert(await page.locator('#floatingBudget').evaluate(el => {
            const box = el.getBoundingClientRect();
            return box.x >= 0 && box.right <= innerWidth && [...el.querySelectorAll('.budget-count, .budget-cost, #planButton, #budgetRp, #budgetSl')]
              .every(n => n.scrollWidth <= n.clientWidth + 1 && n.getBoundingClientRect().bottom <= box.bottom);
          }), `${width} ${locale}: budget text fits`);
          await page.locator('#mobileFiltersButton').click();
          await page.locator('#selectTreeButton').click();
          await page.locator('#mobileFilters .mobile-sheet-heading button').click();
          await page.waitForTimeout(120);
          assert(await page.locator('#floatingBudget').evaluate(el => [...el.querySelectorAll('#budgetRp, #budgetSl')].every(n => n.scrollWidth <= n.clientWidth + 1)), 'Full tree totals fit');
          await page.evaluate(() => { const tree = document.getElementById('treeContainer'); tree.scrollTop = tree.scrollHeight; });
          await page.waitForTimeout(100);
          assert(await page.evaluate(() => {
            const tree = document.getElementById('treeContainer');
            const dock = document.getElementById('floatingBudget').getBoundingClientRect();
            const lastBottom = Math.max(...[...tree.querySelectorAll('.unit-tile')].map(n => n.getBoundingClientRect().bottom));
            return lastBottom + 8 <= dock.top;
          }), 'Last row scrolls above budget');
          await page.locator('#mobileFiltersButton').click();
          await page.locator('#selectTreeButton').click();
          await page.locator('#mobileFilters .mobile-sheet-heading button').click();
        }
        await page.locator('#mobileFiltersButton').click();
        await page.locator('#languageSelect').selectOption('zh');
        await page.locator('#mobileFilters .mobile-sheet-heading button').click();
        await page.waitForFunction(() => !treeSelectionLoading);
        await page.evaluate(() => { const t = document.getElementById('treeContainer'); t.scrollTop = 0; t.scrollLeft = 400; });
        await page.waitForTimeout(150);
        assert.equal(Math.round((await metrics(page)).rail.x), 0, 'Rank rail stays at left edge');
        await page.screenshot({path: path.join(output, `after-${width}-scrolled.png`)});
        await page.locator('.rank-owned-trigger').first().click();
        assert(await page.locator('.bulk-owned-dialog').evaluate(el => el.open), 'Rank action remains usable');
        await page.locator('.bulk-owned-dialog').evaluate(el => el.close());
        if (width === 390) {
          const selected = await page.evaluate(() => [...state.planned]);
          for (const [w, h] of [[844,390], [1440,940], [390,844]]) {
            await page.setViewportSize({width:w, height:h});
            await page.waitForTimeout(150);
            assert.equal(await page.locator('#mobileFiltersButton').isVisible(), w !== 1440);
            assert.equal((await metrics(page)).rail.width, w === 1440 ? 68 : 44);
            assert.deepEqual(await page.evaluate(() => [...state.planned]), selected);
          }
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor:2});
          await page.waitForTimeout(100);
          assert(await page.locator('#treeScrollBar').isVisible());
          await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor:1});
          await page.waitForTimeout(100);
          assert.equal(Math.round((await metrics(page)).tree.width), 390);
        }
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({width,height,passed:true}));
      await page.close();
    }
    fs.writeFileSync(path.join(output, baseline ? 'before.json' : 'after.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
