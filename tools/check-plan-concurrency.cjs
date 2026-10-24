const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');

async function main() {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'logs/plan-concurrency');
  fs.mkdirSync(output, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  const reports = [];
  try {
    browser = await chromium.launch(launchOptions());
    for (const mode of ['local', 'pages']) for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 720, hasTouch: width < 720 });
      const errors = [];
      const a = await context.newPage(), b = await context.newPage();
      const ready = page => page.waitForFunction(() => typeof state !== 'undefined' && state.units.length && !treeSelectionLoading);
      for (const page of [a, b]) {
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`);
        await ready(page);
      }
      const record = await a.evaluate(async () => {
        const unit = state.units.find(unit => unit.rp > 1000);
        state.progressRp[unit.data_unit_id] = 1000;
        saveState(); await PlanStorage.settled();
        return { key: storageKey(), id: unit.data_unit_id, saved: localStorage.getItem(storageKey()) };
      });
      await b.evaluate(async id => { toggleUnitMode(id, 'target'); await PlanStorage.settled(); }, record.id);
      assert.equal(await b.evaluate(key => localStorage.getItem(key), record.key), record.saved);
      assert(await b.evaluate(() => PlanStorage.hasConflicts() && PlanStorage.hasPending()));
      for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
        await b.evaluate(value => setLanguage(value), locale);
        const layout = await b.locator('.plan-storage-warning').evaluate(el => {
          const rect = el.getBoundingClientRect();
          return { text: el.textContent, fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && el.scrollWidth <= el.clientWidth + 1,
            buttons: [...el.querySelectorAll('button')].every(button => button.getBoundingClientRect().height >= 44 && button.scrollWidth <= button.clientWidth + 1) };
        });
        assert(layout.fits && layout.buttons, JSON.stringify(layout));
        if (!['zh', 'ja'].includes(locale)) assert(!/[\u4e00-\u9fff]/.test(layout.text));
        await b.screenshot({ path: path.join(output, `${mode}-${width}-${locale}.png`) });
      }
      await b.evaluate(() => setLanguage('zh'));
      await b.locator('.plan-storage-warning button').first().click();
      const downloadEvent = b.waitForEvent('download');
      await b.locator('[data-backup-export]').click();
      const download = await downloadEvent;
      const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      const draft = backup.records.find(row => row.key === record.key).value;
      assert(draft.planned.includes(record.id));
      assert.equal(draft.progressRp[record.id], undefined);
      await b.locator('[data-backup-close]').click();
      b.once('dialog', dialog => dialog.dismiss());
      await b.locator('[data-storage-reload]').click();
      assert(await b.evaluate(() => PlanStorage.hasPending()));
      b.once('dialog', dialog => dialog.accept());
      await b.locator('[data-storage-reload]').click();
      await b.waitForLoadState('domcontentloaded'); await ready(b);
      assert.equal(await b.evaluate(id => state.progressRp[id], record.id), 1000);
      assert(!await b.evaluate(() => PlanStorage.hasPending()));
      await b.evaluate(async id => { state.progressRp[id] = 2000; saveState(); await PlanStorage.settled(); }, record.id);
      assert.equal(await b.evaluate(({key,id}) => JSON.parse(localStorage.getItem(key)).progressRp[id], record), 2000);

      // Cached modification dialogs must also detect a newer record from another tab.
      await a.reload(); await ready(a);
      for (const page of [a, b]) await page.evaluate(() => ModificationWorkbench.open('us_m18_hellcat'));
      const modId = await a.locator('[data-mod-id]').first().getAttribute('data-mod-id');
      const modKey = 'wt-research:modifications:us_m18_hellcat';
      const savedMod = await a.evaluate(async ({key,id}) => {
        await PlanStorage.write(key, { progressRp: { [id]: 100 }, researched: [], selected: [], airCombat: true });
        return localStorage.getItem(key);
      }, { key: modKey, id: modId });
      await b.locator('[data-mod-id]').first().click();
      await b.evaluate(() => PlanStorage.settled());
      assert.equal(await b.evaluate(key => localStorage.getItem(key), modKey), savedMod);
      const warning = b.locator('#modificationDialog .plan-storage-warning');
      await warning.waitFor({ state: 'visible' });
      assert(await warning.locator('[data-storage-reload]').isVisible());
      await b.screenshot({ path: path.join(output, `${mode}-${width}-mods.png`) });
      await b.evaluate(() => document.getElementById('modificationDialog').close());
      await b.locator('body > .plan-storage-warning').waitFor({ state: 'visible' });

      // Queue two writes behind an actual cross-tab Web Lock, not simulated timing.
      for (let round = 0; round < 20; round++) {
        const country = ['germany', 'ussr', 'britain', 'japan'][Math.floor(round / 5)];
        const type = ['ground', 'aviation', 'helicopters', 'ships', 'boats'][round % 5];
        const race = `wt-research:${country}:${type}`;
        for (const page of [a, b]) await page.evaluate(key => PlanStorage.read(key), race);
        await a.evaluate(() => {
          window.raceLocked = false;
          navigator.locks.request('wt-research-plan-write', () => new Promise(resolve => { window.releaseRace = resolve; window.raceLocked = true; }));
        });
        await a.waitForFunction(() => raceLocked);
        await a.evaluate(key => { window.raceResult = PlanStorage.write(key, { progressRp: { test: 1000 } }); }, race);
        await b.evaluate(key => { window.raceResult = PlanStorage.write(key, { progressRp: { test: 2000 } }); }, race);
        await a.evaluate(() => releaseRace());
        const first = await a.evaluate(() => raceResult), second = await b.evaluate(() => raceResult);
        assert.equal(first, true); assert.equal(second, false, `${mode} ${width} round ${round}`);
        assert.equal(await b.evaluate(key => JSON.parse(localStorage.getItem(key)).progressRp.test, race), 1000);
      }
      const rollback = await a.evaluate(async () => {
        const key = 'wt-research:france:aviation';
        PlanStorage.read(key);
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) { if (this.name === 'revisions') throw new DOMException('Test quota', 'QuotaExceededError'); return put.apply(this, args); };
        let result;
        try { result = await PlanStorage.write(key, { progressRp: { test: 3000 } }); }
        finally { IDBObjectStore.prototype.put = put; }
        const rolledBack = localStorage.getItem(key) === null;
        const draft = PlanStorage.capture().records.find(row => row.key === key).value.progressRp.test;
        const retried = await PlanStorage.write(key, { progressRp: { test: 3000 } });
        return { result, rolledBack, draft, retried };
      });
      assert.deepEqual(rollback, { result: false, rolledBack: true, draft: 3000, retried: true });
      const restoreKey = 'wt-research:china:aviation';
      await a.evaluate(async key => {
        window.conflictTicket = await PlanStorage.preview({format:'war-thunder-research-plans',version:1,createdAt:new Date().toISOString(),records:[{key,value:{}}]});
      }, restoreKey);
      await b.evaluate(key => PlanStorage.write(key, { progressRp: { test: 4000 } }), restoreKey);
      const rejected = await a.evaluate(async key => {
        const get = Storage.prototype.getItem;
        Storage.prototype.getItem = function (name) { return name === key ? null : get.call(this, name); };
        try { await PlanStorage.restore(conflictTicket); return false; }
        catch (error) { return error.code === 'changed'; }
        finally { Storage.prototype.getItem = get; }
      }, restoreKey);
      assert(rejected, 'A stale preview must fail even when localStorage still exposes its old snapshot');
      assert.equal(await b.evaluate(key => JSON.parse(localStorage.getItem(key)).progressRp.test, restoreKey), 4000);
      assert.deepEqual(errors, []);
      reports.push({ mode, width, locales: 7, newerProgressPreserved: true, draftBackup: true, reloadConfirmation: true, modificationConflict: true, simultaneousWrites: 20, journalRollback: true, staleRestore: true });
      console.log(JSON.stringify(reports.at(-1)));
      await context.close();
    }
  } finally {
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(reports, null, 2));
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
