const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const before = process.argv.includes('--before');
const base = process.argv.find(value => /^https?:/.test(value)) || 'http://127.0.0.1:3020/';
async function main() {
  const output = path.resolve('logs/selection-contrast');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 960 }, isMobile: width < 720, hasTouch: width < 720, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading);
      const ids = await page.evaluate(() => {
        state.planned.clear(); state.owned.clear(); state.waypoints.clear(); state.planResult = null;
        const units = getTreeResearchUnits().filter(u => parseNumber(u.rp) > 0 && !u.parent_group_id && u.rank === state.tree[0].rank);
        const ids = units.slice(0, 4).map(u => u.data_unit_id);
        state.planned.add(ids[0]);
        state.owned.add(ids[1]);
        state.planResult = { selectedIds: [ids[0], ids[2], ids[3]], fillerIds: [ids[3]], removedAutoRoles: {}, dirty: true };
        calculatePlan();
        return ids;
      });
      assert.equal(ids.length, 4);
      const target = page.locator('.tree-canvas [data-unit-id="' + ids[0] + '"]');
      await target.scrollIntoViewIfNeeded();
      await page.waitForFunction(id => {
        const image = document.querySelector('.tree-canvas [data-unit-id="' + id + '"] > img');
        return image?.complete && image.naturalWidth > 0;
      }, ids[0]);
      await page.screenshot({ path: path.join(output, (before ? 'before-' : 'after-') + width + '.png') });
      await target.screenshot({ path: path.join(output, (before ? 'before-card-' : 'after-card-') + width + '.png') });
      const styles = await page.evaluate(ids => ids.map(id => {
        const card = document.querySelector('.tree-canvas [data-unit-id="' + id + '"]');
        const style = getComputedStyle(card);
        const badge = card.querySelector('.target-label');
        const rect = card.getBoundingClientRect();
        return { id, background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow, width: rect.width, height: rect.height,
          badge: badge ? { color: getComputedStyle(badge).color, background: getComputedStyle(badge).backgroundColor, icon: getComputedStyle(badge, '::before').maskImage } : null };
      }), ids);
      if (before) fs.writeFileSync(path.join(output, 'baseline-' + width + '.json'), JSON.stringify(styles));
      else {
        const baseline = require('./fixtures/selection-contrast.json');
        for (let i = 0; i < styles.length; i++) {
          assert.equal(styles[i].width, baseline[i].width);
          assert.equal(styles[i].height, baseline[i].height);
        }
        assert(styles[0].badge.icon.includes('check.svg'));
        assert.notEqual(styles[0].badge.background, baseline[0].badge.background);
        assert.equal(styles[1].background, baseline[1].background, 'Owned state should not change');
        assert.equal(styles[3].background, baseline[3].background, 'Filler state should not change');
        const budget = await page.evaluate(() => [els.totalRp.textContent, els.totalSp.textContent]);
        await target.click();
        assert.equal(await target.locator('.target-label').count(), 0);
        await target.click();
        assert.equal(await target.locator('.target-label').count(), 1);
        assert.deepEqual(await page.evaluate(() => [els.totalRp.textContent, els.totalSp.textContent]), budget);
        for (const locale of ['en', 'ru', 'de', 'fr', 'ja', 'es', 'zh']) {
          await page.evaluate(locale => WTI18n.setLocale(locale), locale);
          const badge = target.locator('.target-label');
          const a = await badge.boundingBox(), b = await target.boundingBox();
          assert(a.x >= b.x && a.x + a.width <= b.x + b.width);
          assert(a.y + a.height <= b.y + b.height);
        }
        const folder = page.locator('.tree-canvas [data-folder-key]').first();
        await folder.scrollIntoViewIfNeeded();
        await folder.click();
        const folded = page.locator('.folder-popup .unit-tile:not(.planned):not(.owned):not(.unlocked)').first();
        const foldedId = await folded.getAttribute('data-unit-id');
        await folded.click();
        const selected = page.locator('.folder-popup [data-unit-id="' + foldedId + '"]');
        assert.equal(await selected.locator('.target-label').evaluate(el => getComputedStyle(el).backgroundColor), styles[0].badge.background);
        assert.equal(await selected.locator('.target-label').evaluate(el => getComputedStyle(el).color), styles[0].badge.color);
        await page.locator('.folder-popup').screenshot({ path: path.join(output, 'folder-' + width + '.png') });
        await selected.click();
        assert.equal(await selected.locator('.target-label').count(), 0);
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ before, width, states: styles, passed: true }));
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
