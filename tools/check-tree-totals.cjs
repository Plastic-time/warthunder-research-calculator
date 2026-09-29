const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
async function main() {
  const output = path.resolve('logs/tree-totals-check');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const mode of ['app', 'pages']) for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 720, hasTouch: width < 720, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:' + server.address().port + (mode === 'pages' ? '/pages/' : '/'), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => state.units.length > 0 && !treeSelectionLoading);
      const expected = await page.evaluate(async () => {
        els.typeSelect.value = 'aviation';
        await loadTree();
        const standard = state.units.filter(u => {
          const info = RosterAudit.info(state.country, state.type, u.data_unit_id);
          return u.section === 'researchable' && info?.category === 'standard' && !info.hidden && !isSquadronUnit(u);
        });
        const payable = standard.filter(u => u.rp > 1000);
        state.owned.add(payable[0].data_unit_id);
        state.progressRp[payable[1].data_unit_id] = 500;
        els.searchInput.value = 'F-15';
        state.search = 'F-15';
        calculatePlan();
        const candidates = standard.filter(u => !state.owned.has(u.data_unit_id) && !state.initialUnlocked.has(u.data_unit_id));
        const sum = (list, field) => list.reduce((s, u) => s + parseNumber(u[field]), 0);
        return { owned: payable[0].data_unit_id, partial: payable[1].data_unit_id,
          count: candidates.length, fullRp: sum(standard, 'rp'), fullSl: sum(standard, 'sp'),
          rp: sum(candidates, 'rp') - 500, sl: sum(candidates, 'sp'),
          folded: candidates.filter(u => u.parent_group_id).map(u => u.data_unit_id) };
      });
      if (width < 720) await page.locator('#mobileFiltersButton').click();
      const autofill = page.locator('#avoidFoldedInput');
      const originalAutofill = await autofill.isChecked();
      for (let click = 0; click < 2; click++) {
        await autofill.click();
        assert.equal(await autofill.evaluate(el => getComputedStyle(el).boxShadow), 'none');
        assert.equal(await autofill.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
      }
      assert.equal(await autofill.isChecked(), originalAutofill);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      assert(await autofill.evaluate(el => el.matches(':focus-visible')));
      assert.equal(await autofill.evaluate(el => getComputedStyle(el).outlineWidth), '2px');
      assert.equal(await autofill.evaluate(el => getComputedStyle(el).boxShadow), 'none');
      assert(await page.locator('#selectTreeButton').isVisible());
      assert(await page.locator('#selectTreeButton').isEnabled());
      assert.equal(await page.locator('#selectTreeButton .select-tree-label').textContent(), '全选');
      assert.equal(await page.locator('#selectTreeButton .nav-icon').evaluate(el => getComputedStyle(el).visibility), 'hidden');
      await page.locator('#selectTreeButton').click();
      const actual = await page.evaluate(() => ({
        count: state.missing.length, rp: Number(els.totalRp.textContent.replaceAll(',', '')),
        sl: Number(els.totalSp.textContent.replaceAll(',', '')), planned: [...state.planned],
        owned: [...state.owned], progress: state.progressRp, payload: WTRouteExport.buildPayload(),
      }));
      assert.equal(actual.count, expected.count);
      assert.equal(actual.rp, expected.rp);
      assert.equal(actual.sl, expected.sl);
      assert.equal(Number(actual.payload.treeRp.replaceAll(',', '')), expected.fullRp);
      assert.equal(Number(actual.payload.treeSl.replaceAll(',', '')), expected.fullSl);
      assert(actual.owned.includes(expected.owned));
      assert.equal(actual.progress[expected.partial], 500);
      assert(expected.folded.length && expected.folded.every(id => actual.planned.includes(id)));
      assert(await page.locator('#selectTreeButton').isEnabled());
      assert.equal(await page.locator('#selectTreeButton').getAttribute('aria-checked'), 'true');
      assert.equal(await page.locator('#selectTreeButton .nav-icon').evaluate(el => getComputedStyle(el).visibility), 'visible');
      const rect = await page.locator('#selectTreeButton').boundingBox();
      const avoidRect = await page.locator('#avoidFoldedInput').locator('..').boundingBox();
      assert(avoidRect.x + avoidRect.width <= rect.x, 'Select all should be to the right of autofill');
      assert(Math.abs(avoidRect.y + avoidRect.height / 2 - rect.y - rect.height / 2) < 2);
      const leftBox = await page.locator('#avoidFoldedInput').boundingBox();
      const rightBox = await page.locator('#selectTreeButton .select-tree-box').boundingBox();
      const leftText = await page.locator('.tree-selection-options .planner-option span').boundingBox();
      const rightText = await page.locator('#selectTreeButton .select-tree-label').boundingBox();
      for (const key of ['y', 'height', 'width']) assert(Math.abs(leftBox[key] - rightBox[key]) < 0.1, 'Checkboxes should match: ' + key);
      for (const key of ['y', 'height']) assert(Math.abs(leftText[key] - rightText[key]) < 0.1, 'Labels should align: ' + key);
      assert(rect.x >= 0 && rect.x + rect.width <= width);
      if (width < 720) {
        const metadata = await page.locator('.mobile-tree-tools .header-metadata').boundingBox();
        const actions = await page.locator('.mobile-tree-actions').boundingBox();
        assert(metadata.x + metadata.width <= actions.x + 1);
        assert(rect.width >= 44 && rect.height >= 44);
      }
      await page.screenshot({ path: path.join(output, mode + '-' + width + '.png') });
      // A saved exact route must not resurrect targets after deselecting.
      await page.evaluate(() => {
        const ids = [...state.planned];
        state.waypoints.add(ids[0]); state.planned.delete(ids[0]);
        state.planResult = { selectedIds: ids, fillerIds: ids.slice(0, 2), removedAutoRoles: {}, dirty: true };
      });
      await page.locator('#selectTreeButton').click();
      assert.equal(await page.locator('#selectTreeButton').getAttribute('aria-checked'), 'false');
      assert.equal(await page.evaluate(() => state.missing.length), 0);
      assert.equal(await page.evaluate(() => state.planned.size + state.waypoints.size), 0);
      assert.equal(await page.evaluate(() => state.planResult?.selectedIds.length || 0), 0);
      assert(await page.evaluate(id => state.owned.has(id), expected.owned));
      assert.equal(await page.evaluate(id => state.progressRp[id], expected.partial), 500);
      await page.locator('#selectTreeButton').click();
      assert.equal(await page.evaluate(() => state.missing.length), expected.count);
      await page.evaluate(() => {
        state.planned.delete([...state.planned][0]);
        refreshTreeSelectionButton();
      });
      assert.equal(await page.locator('#selectTreeButton').getAttribute('aria-checked'), 'mixed');
      await page.locator('#selectTreeButton').click();
      assert.equal(await page.locator('#selectTreeButton').getAttribute('aria-checked'), 'true');
      await page.reload();
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading);
      await page.evaluate(async () => { els.typeSelect.value = 'aviation'; await loadTree(); });
      assert.equal(await page.evaluate(() => state.missing.length), expected.count);
      await page.evaluate(async () => { els.countrySelect.value = 'germany'; await loadTree(); });
      assert.equal(await page.evaluate(() => state.planned.size), 0);
      await page.evaluate(async () => { els.countrySelect.value = 'usa'; await loadTree(); });
      assert.equal(await page.evaluate(() => state.missing.length), expected.count);
      await page.evaluate(() => { state.units.find(u => state.planned.has(u.data_unit_id)).rp = null; calculatePlan(); });
      assert(await page.evaluate(() => WTRouteExport.buildPayload().treeUnknownCount > 0 && WTRouteExport.buildPayload().pendingUnknownCount > 0));
      assert.equal(await page.evaluate(() => WTRouteExport.buildPayload().rpLabel), '已知 RP');
      if (mode === 'pages' && width === 390) {
        await page.evaluate(async () => {
          await loadTree();
          els.searchInput.value = ''; state.search = ''; renderTree();
        });
        const image = await page.evaluate(async () => {
          let summary;
          const original = htmlToImage.toCanvas;
          htmlToImage.toCanvas = async (sheet, options) => {
            summary = { groups: sheet.querySelectorAll('.tree-screenshot-budget').length, text: sheet.querySelector('.tree-screenshot-totals').textContent, width: options.width, height: options.height };
            return original(sheet, options);
          };
          try {
            const canvas = await WTRouteExport.render();
            const scale = canvas.width / summary.width;
            const background = [...canvas.getContext('2d').getImageData(5, Math.round(80 * scale), 1, 1).data];
            const preview = document.createElement('canvas');
            preview.width = Math.min(canvas.width, 1900); preview.height = 440;
            preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, canvas.height * preview.width / canvas.width);
            return { ...summary, background, preview: preview.toDataURL(), png: canvas.toDataURL() };
          } finally { htmlToImage.toCanvas = original; }
        });
        assert.equal(image.groups, 4);
        assert(image.background.slice(0, 3).every(value => value < 65), 'Summary must retain the dark theme');
        assert(image.text.includes('科技树总额') && image.text.includes('当前选择还需'));
        fs.writeFileSync(path.join(output, 'usa-aviation-full.png'), Buffer.from(image.png.split(',')[1], 'base64'));
        fs.writeFileSync(path.join(output, 'usa-aviation-summary.png'), Buffer.from(image.preview.split(',')[1], 'base64'));
        console.log(JSON.stringify({ export: true, width: image.width, height: image.height, summary: image.text }));
      }
      await page.evaluate(() => { RosterAudit.info = () => null; refreshTreeSelectionButton(); });
      assert(await page.locator('#selectTreeButton').isDisabled());
      assert(await page.evaluate(() => WTRouteExport.buildPayload().treeUnavailable && WTRouteExport.buildPayload().treeRp === '未提供'));
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, width, ...expected, folded: expected.folded.length, passed: true }));
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
