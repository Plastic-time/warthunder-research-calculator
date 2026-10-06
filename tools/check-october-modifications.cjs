const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const output = path.resolve('logs/october-modifications');
fs.mkdirSync(output, { recursive: true });
async function main() {
  let server, browser;
  try {
    let endpoints = [['remote', process.argv[2]]];
    if (!process.argv[2]) {
      const app = express(); app.use('/pages', express.static(path.resolve('docs'))); app.use(require('../main'));
      server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
      const base = 'http://127.0.0.1:' + server.address().port;
      endpoints = [['local', base + '/'], ['pages', base + '/pages/']];
    }
    browser = await chromium.launch({ channel: 'chrome' });
    for (const [mode,url] of endpoints) for (const width of [1440,390]) {
      const page = await browser.newPage({ viewport: { width,height:960 }, isMobile: width < 720, hasTouch: width < 720, reducedMotion: 'reduce' });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      assert.equal(await page.locator('[data-game-version]').innerText(), '2.59.0.50');
      await page.waitForFunction(() => ModificationWorkbench.hasVehicle('f_86em_greece'));
      await page.evaluate(() => {
        const plan = ModificationPlanner.plan;
        ModificationPlanner.plan = (...args) => { window.checkedData = args[0]; return window.checkedResult = plan(...args); };
      });
      for (const [id,target,total] of [['f_86em_greece','us_aim_9b',[145800,226000]],['mig_23m','il_28sh_s24',[197800,311600]],['ussr_object_416','new_tank_engine',[88600,147600]]]) {
        await page.evaluate(id => ModificationWorkbench.open(id), id);
        const tile = page.locator(`[data-mod-id="${target}"]`);
        await tile.scrollIntoViewIfNeeded(); await tile.click();
        await page.locator('[data-modification-action="calculate"]').click();
        const { data,result } = await page.evaluate(() => ({ data: checkedData,result: checkedResult }));
        assert(result.includedIds.includes(target));
        if (id === 'f_86em_greece') assert.deepEqual(data.mods.find(m => m.id === target).requires, []);
        if (id === 'mig_23m') for (const req of ['mig_21_ub32','yak_38_b8m1']) assert(result.includedIds.includes(req));
        if (id === 'ussr_object_416') assert.equal(await page.locator('[data-mod-id="art_support"]').count(), 0);
        const overlaps = await page.locator('[data-mod-id]').evaluateAll(tiles => {
          const boxes = tiles.map(el => el.getBoundingClientRect());
          return boxes.some((a,i) => boxes.slice(i+1).some(b => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
        });
        assert(!overlaps);
        await page.waitForFunction(() => [...document.querySelectorAll('[data-mod-id] img')].every(i => i.complete && i.naturalWidth > 0));
        await page.screenshot({ path: path.join(output, `${mode}-${width}-${id}.png`) });
        await page.locator('[data-modification-action="all"]').click();
        await page.locator('[data-modification-action="calculate"]').click();
        assert.deepEqual(await page.evaluate(() => [checkedResult.rp,checkedResult.sl]), total);
        await page.locator('[data-modification-close]').click();
      }
      for (const locale of ['zh','en','ru','de','fr','ja','es']) {
        await page.evaluate(locale => setLanguage(locale), locale);
        await page.evaluate(() => ModificationWorkbench.open('f_86em_greece'));
        assert.equal(await page.locator('[data-mod-id="us_aim_9b"]').count(), 1);
        assert((await page.locator('[data-mod-id="us_aim_9b"]').innerText()).includes('AIM-9B'));
        await page.locator('[data-modification-close]').click();
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode,width,vehicles:3,locales:7,images:true,planning:true,passed:true }));
      await page.close();
    }
  } finally { await browser?.close(); if(server){server.closeAllConnections();await new Promise(resolve => server.close(resolve));} }
}
main().catch(e => { console.error(e);process.exitCode=1; });
