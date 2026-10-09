const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');

(async () => {
  const output = path.resolve('logs/navigation-layout');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    for (const mode of ['local', 'pages']) for (const [width, height] of [[1920,1080], [1440,960], [1200,800], [1024,768], [768,1024], [390,844], [320,568], [844,390]]) {
      const mobile = width < 720 || height < 500;
      const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !treeSelectionLoading && document.querySelector('.unit-tile'));
      await page.waitForFunction(() => [...document.querySelectorAll('.unit-tile > img')].slice(0, 5).every(el => el.complete && el.naturalWidth));
      await page.evaluate(() => toggleUnitMode('us_m18_hellcat', 'target'));
      const saved = await page.evaluate(() => localStorage.getItem(storageKey()));
      for (const locale of ['zh','en','ru','de','fr','ja','es']) {
        await page.evaluate(locale => setLanguage(locale), locale);
        const geometry = await page.evaluate(() => {
          const box = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
          const visible = el => !!el.getBoundingClientRect().width && !el.closest('[hidden], dialog:not([open])');
          const controls = [...document.querySelectorAll('.topbar button, .tree-filters input:not([type="checkbox"]), .tree-filters select, .country-trigger, .mobile-tree-actions button')].filter(visible).map(el => ({ ...box(el), label: el.id || el.className, clipped: el.scrollWidth > el.clientWidth + 1 }));
          return {
            controls, topbar:box(document.querySelector('.topbar')), tree:box(els.treeContainer), tabs:box(document.querySelector('.branch-tabs')),
            branches:[...document.querySelectorAll('.branch-tab')].map(el => ({ ...box(el), clipped:el.scrollWidth > el.clientWidth + 1 })),
            bodyOverflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        assert(!geometry.bodyOverflow, `${mode} ${width} ${locale}: page overflow`);
        const accent = await page.locator('.branch-tab[aria-pressed="true"] .nav-icon').evaluate(el => getComputedStyle(el).color.match(/[\d.]+/g).slice(0, 3).map(Number));
        assert(accent[0] > accent[2] && accent[1] > accent[2], 'Selected navigation should use the existing warm accent, not blue');
        assert(geometry.tree.height > 120 && geometry.tree.bottom <= height + 1, `${width} ${locale}: tree squeezed`);
        assert(geometry.topbar.bottom <= geometry.tree.y, 'Header overlaps tree');
        geometry.controls.forEach(c => assert(c.width >= 40 && c.height >= 40 && c.x >= 0 && c.right <= width + 1 && !c.clipped, `${width} ${locale}: clipped/small ${JSON.stringify(c)}`));
        for (let i=0; i<geometry.controls.length; i++) for (const b of geometry.controls.slice(i+1)) {
          const a=geometry.controls[i];
          assert(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=1 || Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=1, `${width} ${locale}: controls overlap ${a.label} ${b.label}`);
        }
        if (width >= 1200) {
          assert(geometry.tabs.right <= geometry.tree.x && geometry.tabs.y >= geometry.topbar.bottom, 'Rail overlaps workspace');
          geometry.branches.forEach(b => assert(!b.clipped && b.x >= 0 && b.right <= geometry.tabs.right + 1, 'Rail label clipped'));
        }
        if (mobile) {
          await page.locator('#mobileFiltersButton').click();
          await page.locator('#mobileFilters').evaluate(async el => { for (const animation of el.getAnimations()) await animation.finished; });
          const sheet = await page.locator('#mobileFilters').boundingBox();
          assert(sheet.x >= 0 && sheet.y >= 0 && sheet.x + sheet.width <= width + 1 && sheet.y + sheet.height <= height + 1);
          assert(await page.locator('#selectTreeButton').isVisible());
          await page.screenshot({ path: path.join(output, `${mode}-${width}-${locale}-filters.png`) });
          await page.locator('#mobileFilters .mobile-sheet-heading button').click();
          await page.locator('#mobileMoreButton').click();
        }
        for (const id of ['guideButton', 'routeExportButton', 'clearButton']) {
          const icon = await page.locator('#'+id).evaluate(el => getComputedStyle(el, '::before').maskImage.match(/url\("?([^"\)]+)/)?.[1]);
          assert(icon, id + ': missing icon');
          assert((await page.request.get(icon)).ok());
        }
        if (mobile) await page.locator('#mobileMore .mobile-sheet-heading button').click();
        if (['zh', 'de'].includes(locale)) await page.screenshot({ path: path.join(output, `${mode}-${width}-${locale}.png`) });
        assert.equal(await page.evaluate(() => localStorage.getItem(storageKey())), saved, 'Layout/locale changes alter saved plan');
      }
      const activeTab = page.locator('.branch-tab[aria-pressed="true"]');
      const beforeHover = await activeTab.boundingBox();
      await activeTab.hover();
      assert.deepEqual(await activeTab.boundingBox(), beforeHover, 'Hover must not move navigation');
      await page.locator('.country-trigger').click();
      const countryPicker = page.locator('#countryPicker');
      assert(await countryPicker.evaluate(el => el.getAnimations().every(a => a.effect.getTiming().duration <= 140)), 'Menu animation is too long');
      await page.keyboard.press('Escape');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('.country-trigger').click();
      assert.equal(await countryPicker.evaluate(el => el.getAnimations().length), 0, 'Reduced motion must disable menu animation');
      await page.keyboard.press('Escape');
      if (mobile) {
        await page.locator('#mobileFiltersButton').click();
        assert.equal(await page.locator('#mobileFilters').evaluate(el => el.getAnimations().length), 0);
        await page.keyboard.press('Escape');
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, width, height, locales:7, layout:true, icons:true, planPreserved:true, pass:true }));
      await page.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
