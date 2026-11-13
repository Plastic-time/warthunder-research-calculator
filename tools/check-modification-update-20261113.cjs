const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const express=require('express');
const {chromium}=require('playwright');
const {launchOptions}=require('./browser-test-runtime.cjs');
const fixture=require('./fixtures/modification-update-20261113.json');
const {correctVehicle,restoreCatalog,restoreChunk}=require('./apply-modification-update-20261113.cjs');
const catalog=require('../docs/database/modifications/catalog.json');
async function main() {
  const app=express(); let legacy=false;
  for(const prefix of ['', '/pages']) {
    app.get(prefix+'/database/modifications/catalog.json',(req,res)=>res.json(legacy?restoreCatalog(catalog):catalog));
    for(const meta of Object.values(fixture.previousChunks)) {
      const chunk=JSON.parse(fs.readFileSync('docs/'+meta.path));
      app.get(prefix+'/'+meta.path,(req,res)=>res.set('Cache-Control','public, max-age=31536000').type('json').send(JSON.stringify(legacy?restoreChunk(chunk):chunk)+'\n'));
    }
  }
  app.use('/pages',express.static(path.resolve('docs')));app.use(require('../main'));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');let browser;
  try {
    browser=await chromium.launch(launchOptions());
    fs.mkdirSync('logs/update-20261113/browser',{recursive:true});
    for(const mode of ['local','pages']) for(const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:940},isMobile:width<720,hasTouch:width<720});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const url=`http://127.0.0.1:${server.address().port}/${mode==='pages'?'pages/':''}`;
      const ready=()=>page.waitForFunction(()=>typeof state!=='undefined'&&state.units.length&&!treeSelectionLoading);
      const open=async id=>{
        await page.keyboard.press('Escape');
        await page.evaluate(async country=>{els.countrySelect.value=country;els.typeSelect.value='aviation';await loadTree();},id==='saab_jas39a'?'sweden':'germany');
        await page.waitForFunction(id=>window.ModificationWorkbench?.hasVehicle(id),id);
        await page.evaluate(id=>ModificationWorkbench.open(id),id);
        await page.waitForFunction(()=>document.getElementById('modificationDialog').dataset.loadState==='ready');
      };
      legacy=true;await page.goto(url);await ready();
      for(const [id,entry] of Object.entries(fixture.vehicles)) {
        await open(id);assert.equal(await page.locator('[data-mod-id]').count(),entry.previous.m.length);
        await page.locator('[data-modification-action="clear"]').click();
        await page.locator(`[data-mod-id="${entry.previous.m[0][0]}"]`).click();
      }
      const saved=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('wt-research:modifications:'))));
      legacy=false;await page.goto('about:blank');await page.goto(url);await ready();
      for(const [id,entry] of Object.entries(fixture.vehicles)) {
        await open(id);const v=correctVehicle(entry.previous),dialog=page.locator('#modificationDialog');
        assert.equal(await dialog.locator('[data-mod-id]').count(),v.m.length);
        assert.deepEqual(await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.keys(saved).filter(k=>k.endsWith(':'+id))),Object.fromEntries(Object.entries(saved).filter(([k])=>k.endsWith(':'+id))));
        await dialog.locator('[data-modification-action="all"]').click();
        assert.deepEqual(await page.evaluate(()=>['modificationRp','modificationSl'].map(id=>document.getElementById(id).textContent)),v.t.map(n=>n.toLocaleString('en-US')));
        const target=id==='saab_jas39a'?'swd_rb99':'us_agm_65g';
        await dialog.locator('[data-modification-action="clear"]').click();
        await dialog.locator('[data-modification-air-combat]').uncheck();
        await dialog.locator(`[data-mod-id="${target}"]`).click();
        await dialog.locator('[data-modification-action="calculate"]').click();
        for(const req of id==='saab_jas39a'?['swd_rb74m']:['us_agm_65b','us_agm_65d']) assert.match(await dialog.locator(`[data-mod-id="${req}"]`).getAttribute('class'),/dependency/);
        if(id!=='saab_jas39a') assert(!/dependency/.test(await dialog.locator('[data-mod-id="f4c_zuni"]').getAttribute('class')));
        await dialog.screenshot({path:`logs/update-20261113/browser/${mode}-${width}-${id}.png`});
      }
      assert.deepEqual(errors,[]);await page.close();console.log(`${mode} ${width}: both trees, warm cache, saved selections, totals and prerequisite planning passed`);
    }
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
