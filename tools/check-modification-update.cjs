const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');
const { restoreCatalog } = require('./apply-modification-update.cjs');
const evidence = require('./fixtures/modification-update-20261029.json');
const catalog = require('../docs/database/modifications/catalog.json');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'logs/modification-update');

async function main() {
  fs.mkdirSync(output, {recursive:true});
  let legacy = true;
  const chunks = new Map();
  for (const id of Object.keys(evidence.vehicles)) {
    const meta=catalog.chunks[catalog.vehicles[id]];
    if (!chunks.has(meta.path)) chunks.set(meta.path, JSON.parse(fs.readFileSync(path.join(root,'docs',meta.path))));
  }
  const app=express();
  for (const prefix of ['', '/pages']) {
    app.get(prefix+'/database/modifications/catalog.json', (req,res) => res.set('Cache-Control','public, max-age=31536000').json(legacy?restoreCatalog(catalog):catalog));
    for (const [file,current] of chunks) app.get(prefix+'/'+file, (req,res) => {
      const value=structuredClone(current);
      if(legacy) for(const [id,entry] of Object.entries(evidence.vehicles)) if(value.v[id])value.v[id]=entry.previous;
      res.set('Cache-Control','public, max-age=31536000').type('json').send(JSON.stringify(value)+'\n');
    });
  }
  app.use('/pages',express.static(path.join(root,'docs')));
  app.use(require('../main'));
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  let browser;
  const results=[];
  try {
    browser=await chromium.launch(launchOptions());
    for(const mode of ['local','pages']) for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:940},isMobile:width<720,hasTouch:width<720});
      try {
        const page=await context.newPage(), errors=[], requests=[];
        page.on('pageerror',e=>errors.push(e.message));
        page.on('request',r=>{if(r.url().includes('/database/modifications/'))requests.push(r.url());});
        const records={};
        for(const id of ['f_102a_late','uk_challenger_1']) {
          const v=evidence.vehicles[id].previous;
          records['wt-research:modifications:'+id]={selected:[v.m[0][0],...(id==='uk_challenger_1'?['120mm_britain_L23A1_APDSFS_ammo_pack']:[])],researched:[v.m[1][0]],progressRp:{[v.m[0][0]]:1000},airCombat:false};
        }
        await page.addInitScript(records=>{
          if (location.protocol !== 'http:') return;
          if(!localStorage.getItem('mod-update-test-seeded')) {
            for(const [key,value] of Object.entries(records))localStorage.setItem(key,JSON.stringify(value));
            localStorage.setItem('mod-update-test-seeded','1');
          }
        },records);
        const url=`http://127.0.0.1:${server.address().port}/${mode==='pages'?'pages/':''}`;
        const ready=()=>page.waitForFunction(()=>window.ModificationWorkbench?.hasVehicle('f_102a_late'));
        const open=async id=>{
          await page.evaluate(id=>ModificationWorkbench.open(id),id);
          await page.waitForFunction(()=>document.getElementById('modificationDialog').dataset.loadState==='ready');
        };
        const dialog=page.locator('#modificationDialog');
        const action=name=>dialog.locator(`[data-modification-action="${name}"]`);
        const budget=()=>page.evaluate(()=>[document.getElementById('modificationRp').textContent,document.getElementById('modificationSl').textContent]);
        legacy=true; await page.goto(url); await ready();
        await open('f_102a_late'); assert.deepEqual(await budget(),['4,700','9,000']);
        await open('uk_challenger_1'); assert.equal(await dialog.locator('[data-mod-id*="L23A1"]').count(),1);
        legacy=false; await page.goto('about:blank'); await page.goto(url); await ready();
        await open('f_102a_late'); assert.deepEqual(await budget(),['3,600','7,300']);
        assert.match(await dialog.locator('[data-mod-id="f_4c_CdMin_Fuse"]').getAttribute('class'),/researched/);
        await open('uk_challenger_1'); assert.equal(await dialog.locator('[data-mod-id*="L23A1"]').count(),0);
        const challenger=chunks.get(catalog.chunks[catalog.vehicles.uk_challenger_1].path).v.uk_challenger_1;
        const selected=challenger.m[0];
        assert.deepEqual(await budget(),[(selected[7]-1000).toLocaleString('en-US'),selected[8].toLocaleString('en-US')]);
        for(const [key,value] of Object.entries(records)) assert.deepEqual(await page.evaluate(key=>PlanStorage.read(key),key),value,'Read-only loading must preserve saved records');
        for(const id of Object.keys(evidence.vehicles)) {
          await open(id); await action('clear').click(); await action('all').click();
          const v=chunks.get(catalog.chunks[catalog.vehicles[id]].path).v[id];
          assert.deepEqual(await budget(),v.t.map(n=>n.toLocaleString('en-US')),id);
          assert.equal(await dialog.locator('[data-mod-id]').count(),v.m.length);
          await page.waitForFunction(n=>document.querySelectorAll('#modificationTree path.modification-link').length===n,v.m.reduce((s,m)=>s+m[10].length,0));
          if(id.startsWith('f_102a')) {
            for(const locale of ['zh','en','ru','de','fr','ja','es']) {
              await page.evaluate(locale=>{WTI18n.missing.clear();setLanguage(locale);},locale);
              for(const [key,item] of Object.entries(evidence.additions)) {
                const tile=dialog.locator(`[data-mod-id="${key}"]`);
                assert.equal(await tile.locator('b').textContent(),item.names[locale]);
                assert(await tile.evaluate(el=>el.querySelector('b').scrollWidth<=el.querySelector('b').clientWidth+1
                  && el.querySelector('.modification-tile-copy').getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom+1),locale+': label overflow');
              }
              assert.deepEqual(await page.evaluate(()=>[...WTI18n.missing]),[]);
            }
            await page.evaluate(()=>setLanguage('zh'));
            await action('clear').click();
            await dialog.locator('[data-modification-air-combat]').uncheck();
            await dialog.locator('[data-mod-id="us_aim_26b"]').click(); await action('calculate').click();
            for(const key of ['us_aim_4g','us_aim_4f']) assert.match(await dialog.locator(`[data-mod-id="${key}"]`).getAttribute('class'),/dependency/);
            assert(!/dependency/.test(await dialog.locator('[data-mod-id="M163_Minigun_new_gun"]').getAttribute('class')));
            assert.deepEqual(await budget(),['39,100','61,300']);
          }
          await page.waitForFunction(()=>[...document.querySelectorAll('#modificationDialog img')].every(i=>i.complete&&i.naturalWidth>0));
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          await dialog.screenshot({path:path.join(output,`${mode}-${width}-${id}.png`)});
          results.push({mode,width,id,mods:v.m.length,totals:v.t,realImages:true});
        }
        for(const id of ['f_102a_late','uk_challenger_1']) {
          const key=catalog.vehicles[id];
          for(const digest of [evidence.previousChunks[key].sha256,catalog.chunks[key].sha256])assert(requests.some(url=>url.includes(digest.slice(0,16))),'Old and new versioned chunks must both load');
        }
        assert.deepEqual(errors,[]);
      } finally {await context.close();}
    }
    fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({pass:true,results},null,2)+'\n');
    console.log(JSON.stringify({pass:true,scenarios:results.length,warmCacheScenarios:4,newNodeLanguageChecks:56}));
  } finally {if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
