const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

(async () => {
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const output = path.resolve('logs/tree-search-check');
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    for (const mode of ['local', 'pages']) for (const [width, height] of [[1440,960], [390,844], [320,568], [844,390]]) {
      const mobile = width < 720 || height < 500;
      const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !treeSelectionLoading && state.units.length > 0);
      await page.evaluate(async () => { els.typeSelect.value = 'aviation'; await loadTree(); });
      const preserved = await page.evaluate(() => {
        const unit = state.units.find(unit => parseNumber(unit.rp) > 0 && !state.initialUnlocked.has(unit.data_unit_id));
        toggleUnitMode(unit.data_unit_id, 'target');
        state.progressRp[unit.data_unit_id] = 10;
        saveState(); calculatePlan();
        window.searchRenderCount = 0;
        new MutationObserver(records => { window.searchRenderCount += records.filter(record => record.type === 'childList').length; })
          .observe(els.treeContainer, { childList: true });
        return { storage: localStorage.getItem(`wt-research:${state.country}:${state.type}`), budget: els.budgetRp.textContent };
      });
      const openSearch = async () => { if (mobile && !await page.locator('#mobileSearch').evaluate(el => el.open)) await page.locator('#mobileSearchButton').click(); };
      await page.evaluate(() => { els.treeContainer.scrollTop = 600; els.treeContainer.scrollLeft = 250; });
      const position = await page.evaluate(() => ({ top: els.treeContainer.scrollTop, left: els.treeContainer.scrollLeft }));
      await openSearch();
      const input = page.locator('#searchInput');
      await input.pressSequentially('F15', { delay: 20 });
      await page.waitForFunction(() => state.search === 'F15');
      assert.equal(await page.evaluate(() => searchRenderCount), 1, 'Rapid typing should coalesce into one render');
      const ids = await page.evaluate(() => state.units.filter(unitMatchesSearch).map(unit => unit.data_unit_id));
      assert(ids.length > 0);
      for (const query of ['F-15', 'F 15', 'Ｆ－１５']) {
        await input.fill(query);
        await page.waitForFunction(query => state.search === query, query);
        assert.deepEqual(await page.evaluate(() => state.units.filter(unitMatchesSearch).map(unit => unit.data_unit_id)), ids);
      }
      await page.locator('#clearSearchButton').click();
      await page.waitForFunction(() => state.search === '');
      await page.waitForTimeout(100);
      const restored = await page.evaluate(() => ({ top: els.treeContainer.scrollTop, left: els.treeContainer.scrollLeft }));
      assert.deepEqual(restored, position, 'Clearing search must restore both scroll axes');
      assert.equal(await page.evaluate(() => localStorage.getItem(`wt-research:${state.country}:${state.type}`)), preserved.storage);
      assert.equal(await page.locator('#budgetRp').textContent(), preserved.budget);

      // Browser composition events retain the old tree until the IME commits.
      await input.evaluate(el => {
        window.beforeComposition = searchRenderCount;
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        el.value = '飞';
        el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      });
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => searchRenderCount - beforeComposition), 0);
      if (mobile) assert(await page.locator('#mobileSearch').evaluate(el => el.open));
      await input.evaluate(el => {
        el.value = 'F15';
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
      await page.waitForFunction(() => state.search === 'F15');
      assert.equal(await page.evaluate(() => searchRenderCount - beforeComposition), 1);
      for (const locale of ['zh','en','ru','de','fr','ja','es']) {
        await page.evaluate(locale => setLanguage(locale), locale);
        assert.equal(await page.locator('#searchResultCount').textContent(), await page.evaluate(count => tr('匹配 {count} 辆', { count }), ids.length));
        const layout = await page.evaluate(() => {
          const label = els.searchInput.closest('.search-label');
          const count = document.getElementById('searchResultCount');
          const button = document.getElementById('clearSearchButton');
          const a = label.getBoundingClientRect(), b = button.getBoundingClientRect(), c = count.getBoundingClientRect();
          const input = els.searchInput.getBoundingClientRect();
          return { overflow: document.documentElement.scrollWidth > innerWidth || label.scrollWidth > label.clientWidth + 1,
            clearFits: b.left >= input.left && b.right <= input.right + 1 && b.bottom <= input.bottom + 1,
            countFits: c.right <= a.right + 1 && c.bottom <= input.top + 1,
            hitSize: b.width >= 38 && b.height >= 38 };
        });
        assert(!layout.overflow && layout.clearFits && layout.countFits && layout.hitSize, JSON.stringify({ mode, width, locale, layout }));
        if (['zh', 'de'].includes(locale)) await page.screenshot({ path: path.join(output, `${mode}-${width}-${locale}-search.png`) });
      }
      await input.fill('does-not-exist-vehicle');
      await page.waitForFunction(() => state.search === 'does-not-exist-vehicle');
      assert.equal(await page.locator('#treeContainer .loading').textContent(), await page.evaluate(() => tr('没有匹配项')));
      assert.match(await page.locator('#searchResultCount').textContent(), /0/);
      await page.locator('#clearSearchButton').click();

      await input.fill('F15');
      await input.press('Enter');
      await page.waitForFunction(() => document.activeElement?.dataset.unitId === state.units.filter(unitMatchesSearch)[0]?.data_unit_id);
      const visible = await page.evaluate(() => {
        const card = document.activeElement.getBoundingClientRect(), tree = els.treeContainer.getBoundingClientRect();
        return card.top >= tree.top && card.left >= tree.left && card.right <= tree.right;
      });
      assert(visible, 'First search result must be in the tree viewport');
      await openSearch();
      await page.locator('#clearSearchButton').click();

      // Search a non-leading member, then locate it without changing the plan.
      const folded = await page.evaluate(() => {
        const group = state.groups.find(group => group.items?.length > 1);
        return group.items[1].data_unit_id;
      });
      await input.fill(folded);
      if (mobile) await page.locator('.mobile-search-done').click();
      else await input.press('Enter');
      await page.waitForFunction(id => document.activeElement?.dataset.unitId === id, folded);
      assert(await page.locator('.folder-popup').isVisible());
      if (mobile) assert.equal(await page.locator('#mobileSearch').evaluate(el => el.open), false);
      const card = page.locator(`.folder-popup [data-unit-id="${folded}"]`);
      await card.locator('img').evaluate(async image => { if (!image.complete) await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; }); });
      assert(await card.locator('img').evaluate(image => image.naturalWidth > 0));
      await page.screenshot({ path: path.join(output, `${mode}-${width}-folded-result.png`) });
      await page.locator('.folder-popup-close').click();
      assert.equal(await page.evaluate(() => localStorage.getItem(`wt-research:${state.country}:${state.type}`)), preserved.storage);
      await openSearch();
      await page.locator('#clearSearchButton').click();

      // A pending query must not repaint the old tree while the next one loads.
      await page.evaluate(async () => {
        els.searchInput.value = 'F15'; els.searchInput.dispatchEvent(new Event('input'));
        els.countrySelect.value = 'israel'; els.typeSelect.value = 'boats'; await loadTree();
      });
      await page.waitForTimeout(250);
      assert.equal(await page.locator('.wiki-empty').count(), 1);
      assert.match(await page.locator('#searchResultCount').textContent(), /0/);
      await page.locator('#clearSearchButton').click();
      assert.equal(await page.locator('#searchResultCount').isVisible(), false);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, width, locales: 7, matches: ids.length, debounce: true, composition: true, scrollRestore: true, foldedLocate: true, plansPreserved: true }));
      await page.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
