const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const express = require('express');
const {chromium} = require('playwright');

async function main() {
  const output = path.resolve('logs/wiki-viewer-check');
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
      const page = await browser.newPage({viewport: {width, height: 940}, isMobile: width < 720, hasTouch: width < 720});
      const errors = [];
      page.on('pageerror', e => {
        if (e.stack?.includes('127.0.0.1:')) errors.push(e.message);
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('[data-wiki-id]') && document.querySelector('[data-modifications-id]'));
      assert.equal(await page.locator('#wikiDialog iframe').count(), 0);
      const shell = page.locator('.tree-canvas .has-unit-actions').filter({has: page.locator('[data-modifications-id]')}).filter({has: page.locator('.unit-tile:not(.unlocked)')}).first();
      const wiki = shell.locator('[data-wiki-id]');
      const mod = shell.locator('[data-modifications-id]');
      const tile = shell.locator('[data-unit-id]');
      await wiki.scrollIntoViewIfNeeded();
      const [w, m, t] = await Promise.all([wiki.boundingBox(), mod.boundingBox(), tile.boundingBox()]);
      const bookmark = await wiki.locator('.wiki-bookmark').boundingBox();
      const icon = await wiki.locator('img').boundingBox();
      assert.deepEqual([bookmark.width, bookmark.height, icon.width, icon.height], [22, 24, 14, 14]);
      // The modifications entry is a compact corner icon for mouse users and a full touch target on phones.
      const minModTarget = width < 720 ? 44 : 24;
      assert(w.width >= 44 && w.height >= 44 && m.width >= minModTarget && m.height >= minModTarget);
      assert(m.x - (w.x + w.width) >= 40);
      assert(w.y < t.y && w.x >= t.x && w.x + w.width <= t.x + t.width);
      const shellBox = await shell.boundingBox();
      assert.equal(shellBox.height, t.height, 'Bookmark must not add a footer or increase card height');
      const before = await page.evaluate(() => JSON.stringify({planned: [...state.planned], owned: [...state.owned], waypoints: [...state.waypoints], route: state.planResult, scroll: [els.treeContainer.scrollLeft, els.treeContainer.scrollTop]}));
      const unchanged = async () => assert.equal(await page.evaluate(() => JSON.stringify({planned: [...state.planned], owned: [...state.owned], waypoints: [...state.waypoints], route: state.planResult, scroll: [els.treeContainer.scrollLeft, els.treeContainer.scrollTop]})), before);
      const tap = (x, y) => width < 720 ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
      await page.evaluate(() => {
        window.tapLog = [];
        for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, e => window.tapLog.push({type, x: e.clientX, y: e.clientY, target: e.target.outerHTML.slice(0, 130)}), true);
      });
      // The space above the card between the bookmark and gear stays inert.
      await tap(w.x + w.width + 12, t.y - 4);
      await tap(w.x + w.width + 28, t.y - 4);
      await unchanged();
      assert(!(await page.locator('#wikiDialog').evaluate(el => el.open)), JSON.stringify({w, m, t, log: await page.evaluate(() => window.tapLog)}));
      assert(!(await page.locator('#modificationDialog').evaluate(el => el.open)), JSON.stringify({w, m, t, log: await page.evaluate(() => window.tapLog)}));
      await page.screenshot({path: path.join(output, `${mode}-${width}-buttons.png`)});
      await tap(w.x + 2, w.y + 2);
      await page.waitForFunction(() => document.getElementById('wikiDialog').open);
      await unchanged();
      const id = await wiki.getAttribute('data-wiki-id');
      const frame = await page.locator('#wikiDialog iframe').elementHandle();
      const content = await frame.contentFrame();
      await content.waitForSelector('body', {timeout: 30000});
      await content.waitForFunction(() => document.body.innerText.includes('General information'), {timeout: 30000});
      await content.waitForLoadState('load', {timeout: 30000});
      await content.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      assert(content.url().includes('/unit/' + id));
      assert.equal(await page.locator('[data-wiki-external]').getAttribute('href'), `https://wiki.warthunder.com/unit/${id}`);
      assert.equal(await page.locator('[data-wiki-external]').getAttribute('rel'), 'noopener noreferrer');
      await page.screenshot({path: path.join(output, `${mode}-${width}-window.png`)});
      await page.locator('[data-wiki-close]').click();
      assert.equal(await page.locator('#wikiDialog iframe').count(), 0);
      await unchanged();
      await mod.click();
      await page.waitForFunction(() => document.getElementById('modificationDialog').open);
      assert(!(await page.locator('#wikiDialog').evaluate(el => el.open)));
      await page.evaluate(() => document.getElementById('modificationDialog').close());
      await unchanged();
      await page.locator('[data-folder-key]').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.locator('[data-folder-key]').first().click();
      const folderWiki = page.locator('.folder-popup [data-wiki-id]').first();
      await folderWiki.click();
      assert(await page.locator('#wikiDialog').evaluate(el => el.open));
      await page.locator('[data-wiki-close]').click();
      assert(await page.locator('.folder-popup').isVisible());
      await page.evaluate(() => VehicleFolders.close());
      await page.evaluate(() => WikiViewer.open('../bad', 'Invalid'));
      assert(!(await page.locator('#wikiDialog').evaluate(el => el.open)));
      await wiki.scrollIntoViewIfNeeded();
      await wiki.click();
      await page.keyboard.press('Escape');
      assert(!(await page.locator('#wikiDialog').evaluate(el => el.open)));
      assert.deepEqual(errors, []);
      await page.close();
      console.log(JSON.stringify({mode, width, hitArea: 44, buttonSeparation: m.x - (w.x + w.width), cardHeightUnchanged: true, inertGaps: true, iframeLoaded: true, passed: true}));
    }
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error.stack); process.exitCode = 1;});
