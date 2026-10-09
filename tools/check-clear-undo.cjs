const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

const output = path.resolve('logs/clear-undo-check');
fs.mkdirSync(output, { recursive: true });

async function sampleTooltip(page, phase) {
  const frames = await page.locator('[data-modification-action="clear"]').evaluate(button => new Promise(resolve => {
    const result = [];
    function frame() {
      const tip = button.querySelector('[role="tooltip"]');
      const r = tip.getBoundingClientRect();
      result.push({ width: r.width, height: r.height, left: r.left, right: r.right, scale: getComputedStyle(button).scale });
      if (result.length < 12) requestAnimationFrame(frame); else resolve(result);
    }
    requestAnimationFrame(frame);
  }));
  for (const r of frames) assert(r.width >= 120 && r.height <= 110 && r.left >= 0 && r.right <= page.viewportSize().width, `${phase}: ${JSON.stringify(r)}`);
}

async function main() {
  let server, browser;
  try {
    const app = express();
    app.use('/pages', express.static(path.resolve('docs')));
    app.use(require('../main'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    browser = await chromium.launch({ channel: 'chrome' });
    for (const mode of ['local', 'pages']) for (const [width, height] of [[1440, 960], [390, 844], [320, 568], [844, 390]]) {
      const mobile = width < 720 || height < 540;
      const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'no-preference' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`);
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading && ModificationWorkbench.hasVehicle('f_86em_greece'));
      await page.evaluate(() => ModificationWorkbench.open('f_86em_greece'));
      const clearMods = page.locator('[data-modification-action="clear"]');
      const touch = mobile ? await page.context().newCDPSession(page) : null;
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await page.evaluate(locale => setLanguage(locale), locale);
        if (mobile) {
          const r = await clearMods.boundingBox();
          await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] });
        } else { await clearMods.hover(); await page.mouse.down(); }
        await sampleTooltip(page, `${mode} ${width} ${locale} pointer held`);
        assert(await clearMods.locator('.modification-action-icon').evaluate(el => el.dataset.pressFeedback === 'pressed'));
        assert.equal(await clearMods.evaluate(el => getComputedStyle(el).scale), 'none');
        await page.screenshot({ path: path.join(output, `${mode}-${width}-${locale}-held.png`) });
        if (mobile) await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        else await page.mouse.up();
        await sampleTooltip(page, 'release animation');
        if (mobile) assert(!(await clearMods.locator('[role="tooltip"]').isVisible()));
        await page.keyboard.press('Tab');
        await clearMods.focus();
        await page.keyboard.down(' ');
        await sampleTooltip(page, 'keyboard held');
        await page.keyboard.up(' ');
        await sampleTooltip(page, 'keyboard release');
      }
      await touch?.detach();
      await page.locator('[data-modification-close]').click();
      await page.evaluate(() => {
        toggleUnitMode('us_m18_hellcat', 'target');
        const other = state.units.filter(u => canEditUnitProgress(u) && u.data_unit_id !== 'us_m18_hellcat').slice(0, 2);
        toggleUnitMode(other[0].data_unit_id, 'owned');
        toggleUnitMode(other[1].data_unit_id, 'waypoint');
        state.progressRp.us_m18_hellcat = 5000;
        saveState();
        runExactPlan();
      });
      await page.waitForFunction(() => state.planResult && !els.planButton.disabled);
      const snapshot = await page.evaluate(() => ({ saved: JSON.parse(localStorage.getItem(storageKey())), route: structuredClone(state.planResult) }));
      const clearTree = async () => {
        if (await page.locator('#mobileMoreButton').isVisible()) await page.locator('#mobileMoreButton').click();
        await page.locator('#clearButton').click();
      };
      const notice = page.locator('.bulk-owned-notice');
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await page.evaluate(locale => setLanguage(locale), locale);
        const budgets = await page.locator('#budgetRp, #budgetSl, #floatingPlanCount').allTextContents();
        const other = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key !== storageKey())));
        await clearTree();
        assert(await notice.isVisible());
        assert(await page.evaluate(() => !state.planned.size && !state.owned.size && !state.waypoints.size && !state.planResult && !Object.keys(state.progressRp).length));
        assert.equal(await page.locator('#budgetRp').innerText(), '0');
        assert.equal(await notice.locator('button').innerText(), await page.evaluate(() => tr('撤销清空')));
        const box = await notice.boundingBox();
        const budgetBox = await page.locator('#floatingBudget').boundingBox();
        assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= budgetBox.y, `${width} ${locale}: notice overlaps budget or leaves screen`);
        assert(await notice.evaluate(el => el.scrollWidth <= el.clientWidth));
        await page.screenshot({ path: path.join(output, `${mode}-${width}-${locale}-tree-undo.png`) });
        await clearTree();
        await notice.locator('button').click();
        assert(!(await notice.isVisible()));
        assert.deepEqual(await page.evaluate(() => ({ saved: JSON.parse(localStorage.getItem(storageKey())), route: structuredClone(state.planResult) })), snapshot);
        assert.deepEqual(await page.locator('#budgetRp, #budgetSl, #floatingPlanCount').allTextContents(), budgets);
        assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key !== storageKey()))), other);
      }
      await clearTree();
      await page.evaluate(() => toggleUnitMode('us_m18_hellcat', 'target'));
      assert(!(await notice.isVisible()), 'New edits invalidate undo');
      await clearTree();
      await page.evaluate(async () => { els.countrySelect.value = 'germany'; await loadTree(); });
      assert(!(await notice.isVisible()), 'Switching trees invalidates undo');
      await page.evaluate(async () => { els.countrySelect.value = 'usa'; await loadTree(); });
      assert.equal(await page.locator('#budgetRp').innerText(), '0');
      await page.evaluate(() => toggleUnitMode('us_m18_hellcat', 'target'));
      await clearTree();
      await page.reload();
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading);
      assert.equal(await page.locator('#budgetRp').innerText(), '0');
      assert(!(await notice.isVisible()), 'Reload keeps the cleared state');
      await page.evaluate(() => toggleUnitMode('us_m18_hellcat', 'target'));
      await page.clock.install();
      await clearTree();
      await page.mouse.move(0, 0);
      await page.clock.fastForward(15001);
      assert(!(await notice.isVisible()), 'Tree undo expires');
      await page.evaluate(() => toggleUnitMode('us_m18_hellcat', 'target'));
      await clearTree();
      await notice.locator('button').focus();
      await page.clock.fastForward(20000);
      assert(await notice.isVisible(), 'Focused undo does not expire');
      await page.locator('#planButton').focus();
      await page.clock.fastForward(15001);
      assert(!(await notice.isVisible()), 'Expiry resumes after focus leaves');
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, width, height, locales: 7, animatedPress: true, treeUndo: true, persisted: true, passed: true }));
      await page.close();
    }
  } finally {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
