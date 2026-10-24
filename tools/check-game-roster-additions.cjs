const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');
const additions = require('../config/game-roster-additions.json');
const { build } = require('./event-modifications.cjs');
const modifications = require('./fixtures/event-modifications-20261024.json');

async function main() {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'logs/game-roster-browser');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const reports = [];
  let browser;
  try {
    browser = await chromium.launch(launchOptions());
    for (const mode of ['local', 'pages']) for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 720, hasTouch: width < 720 });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + (mode === 'pages' ? '/pages/' : '/'), { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof state !== 'undefined' && state.units.length && !treeSelectionLoading);
        for (const c of additions.units) {
          await page.evaluate(async c => {
            els.countrySelect.value = c.country; els.typeSelect.value = c.type; await loadTree();
          }, c);
          await page.waitForFunction(id => state.unitMap.has(id) && !treeSelectionLoading, c.id);
          const card = page.locator('.unit-tile[data-unit-id="' + c.id + '"]');
          await card.scrollIntoViewIfNeeded();
          await page.waitForFunction(id => {
            const image = document.querySelector('.unit-tile[data-unit-id="' + id + '"] img');
            return image?.complete && image.naturalWidth > 0;
          }, c.id);
          const shell = card.locator('..');
          assert.equal(await shell.locator('[data-wiki-id]').count(), 0);
          await page.waitForFunction(id => document.querySelector('[data-modifications-id="' + id + '"]'), c.id);
          assert.equal(await shell.locator('[data-modifications-id]').count(), 1);
          const source = shell.locator('[data-game-source]');
          assert.equal(await source.getAttribute('href'), c.acquisition.url);
          assert.equal(await source.getAttribute('rel'), 'noopener noreferrer');
          assert.equal(await card.locator('.pill.rp, .pill.sp').count(), 0, 'Do not display internal reward prices');
          assert.equal(await page.evaluate(id => state.initialUnlocked.has(id) || state.owned.has(id), c.id), false, 'Reward availability does not grant ownership');
          const before = await page.evaluate(() => [els.budgetRp.textContent, els.budgetSl.textContent]);
          await card.click();
          assert.deepEqual(await page.evaluate(() => [els.budgetRp.textContent, els.budgetSl.textContent]), before);
          const response = await fetch(base + '/api/calculate/' + c.country + '/' + c.type, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plannedIds: [c.id], ownedIds: [] }),
          });
          assert.equal(response.status, 200);
          const result = await response.json();
          assert.equal(result.total_rp, 0); assert.equal(result.total_sp, 0);
          for (const language of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
            await page.evaluate(language => setLanguage(language), language);
            assert.equal(await card.locator('.unit-title').innerText(), c.names[language]);
            assert.equal(await source.getAttribute('title'), await page.evaluate(() => tr('查看官方活动来源')));
            const geometry = await card.evaluate(card => {
              const r = card.getBoundingClientRect();
              return [...card.querySelectorAll('.unit-title,.pill')].every(el => {
                const b = el.getBoundingClientRect();
                return b.left >= r.left - 1 && b.right <= r.right + 1 && b.bottom <= r.bottom + 1 && el.scrollWidth <= el.clientWidth + 1;
              });
            });
            assert(geometry, mode + '/' + width + '/' + c.id + '/' + language + ': text overflows');
          }
          await page.evaluate(() => setLanguage('zh'));
          await shell.screenshot({ path: path.join(output, mode + '-' + width + '-' + c.id + '.png') });
          const expected = build(modifications.units.find(u => u.id === c.id));
          await shell.locator('[data-modifications-id]').click();
          const dialog = page.locator('#modificationDialog');
          await page.waitForFunction(count => document.querySelectorAll('#modificationTree [data-mod-id]').length === count, expected.m.length);
          await page.waitForFunction(() => [...document.querySelectorAll('#modificationDialog img')].every(i => i.complete && i.naturalWidth > 0));
          assert.equal(await dialog.locator('[data-mod-id]').count(), expected.m.length);
          for (const language of ['zh','en','ru','de','fr','ja','es']) {
            await page.evaluate(language => setLanguage(language), language);
            const labels = await dialog.locator('[data-mod-id]').evaluateAll(tiles => tiles.map(tile => ({
              id:tile.dataset.modId, name:tile.querySelector('b').textContent,
              fits:tile.querySelector('b').scrollWidth <= tile.querySelector('b').clientWidth + 1
                && tile.querySelector('.modification-tile-copy').getBoundingClientRect().bottom <= tile.getBoundingClientRect().bottom + 1,
            })));
            for (const label of labels) {
              assert.equal(label.name, expected.l[label.id][language]);
              assert(label.fits, c.id + '/' + language + '/' + label.id + ': modification label overflows');
            }
          }
          await page.evaluate(() => setLanguage('zh'));
          const action = name => dialog.locator('[data-modification-action="' + name + '"]');
          if (c.premium) {
            assert.equal(await dialog.locator('[data-mod-id]:disabled').count(), expected.m.length);
            assert.equal(await page.locator('#modificationStatus').innerText(), '全部配件已解锁');
            for (const name of ['clear','all','calculate']) {
              await action(name).click();
              assert.equal(await page.locator('#modificationRp').innerText(),'0');
              assert.equal(await page.locator('#modificationSl').innerText(),'0');
            }
            assert.equal(await dialog.locator('[data-mod-id]:disabled').count(), expected.m.length);
          } else {
            await action('all').click();
            assert.equal(await page.locator('#modificationRp').innerText(),'8,410');
            assert.equal(await page.locator('#modificationSl').innerText(),'9,490');
            await action('clear').click();
            await dialog.locator('[data-mod-id="Bf-109F-4_SC500"]').click();
            await action('calculate').click();
            for (const id of ['Bf-109E-3_SC250','Bf-109E-3_4xSC50'])
              assert.match(await dialog.locator('[data-mod-id="' + id + '"]').getAttribute('class'), /dependency/);
          }
          assert.equal(await page.evaluate(id => state.initialUnlocked.has(id) || state.owned.has(id), c.id), false);
          await dialog.screenshot({path:path.join(output, mode + '-' + width + '-' + c.id + '-modifications.png')});
          await dialog.locator('[data-modification-close]').click();
          reports.push({mode, width, id:c.id, languages:7, realImage:true, officialSource:true, excludedCosts:true, modifications:expected.m.length, modLanguages:7});
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({pass:true,reports}, null, 2));
    console.log(JSON.stringify({pass:true, scenarios:reports.length, languageChecks:reports.length*7}));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
