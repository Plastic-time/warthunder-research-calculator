const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const express = require('express');
const {chromium} = require('playwright');
const {launchOptions} = require('./browser-test-runtime.cjs');

(async () => {
  const root=path.resolve(__dirname,'..');
  const app=express();
  app.use('/pages',express.static(path.join(root,'docs')));
  app.use(require('../main'));
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const output=path.join(root,'logs/plan-backup');fs.mkdirSync(output,{recursive:true});
  let browser;
  const reports=[],backups={};
  try {
    browser=await chromium.launch(launchOptions());
    for (const [width,height] of [[1440,960],[390,844],[320,568],[844,390]]) for (const mode of ['local','pages']) {
      const mobile=width<720||height<500;
      const page=await browser.newPage({viewport:{width,height},isMobile:mobile,hasTouch:mobile,acceptDownloads:true});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode==='pages'?'pages/':''}`);
      await page.waitForFunction(()=>!treeSelectionLoading&&state.units.length>0);
      await page.evaluate(()=>{setLanguage('en');setLanguage('zh');});
      await page.evaluate(()=>ModificationWorkbench.open('us_m18_hellcat'));
      const modId=await page.locator('[data-mod-id]').first().getAttribute('data-mod-id');
      await page.evaluate(()=>document.getElementById('modificationDialog').close());
      const expected=await page.evaluate(async modId=>{
        const tree=storageKey(),mods='wt-research:modifications:us_m18_hellcat';
        PlanStorage.write(tree,{planned:['us_m18_hellcat'],owned:['us_m2a4'],waypoints:['us_m4a1_1942'],progressRp:{us_m18_hellcat:1000},avoidFolded:true,
          route:{selectedIds:['us_m18_hellcat','us_m4a1_1942'],fillerIds:[],removedAutoRoles:{us_m4a2_1944:'filler'}}});
        PlanStorage.write(mods,{selected:[modId],researched:[],progressRp:{[modId]:100},airCombat:false});
        localStorage.setItem('unrelated-test-setting','keep-me');
        await PlanStorage.settled();
        loadSavedState();calculatePlan();
        return {tree,mods,modId,values:{[tree]:PlanStorage.read(tree),[mods]:PlanStorage.read(mods)},budget:[els.budgetRp.textContent,els.budgetSl.textContent]};
      },modId);
      if(!await page.locator('#planBackupButton').isVisible())await page.locator('#mobileMoreButton').click();
      await page.locator('#planBackupButton').click();
      const downloadEvent=page.waitForEvent('download');
      await page.locator('[data-backup-export]').click();
      const download=await downloadEvent;
      const backupPath=path.join(output,`${mode}-${width}.json`);await download.saveAs(backupPath);
      const backup=fs.readFileSync(backupPath,'utf8');
      assert.equal(JSON.parse(backup).records.length,2);
      assert(!backup.includes('unrelated-test-setting'));
      assert(!backup.includes('wt-research:language'));
      backups[mode]=backup;
      const otherMode=mode==='local'?'pages':'local';
      const importSource=backups[otherMode]?otherMode:mode;
      const imported=backups[importSource];
      await page.evaluate(async ({tree,mods})=>{
        PlanStorage.write(tree,{});PlanStorage.write(mods,{});
        PlanStorage.write('wt-research:germany:aviation',{planned:['bf-109e-1']});
        await PlanStorage.settled();
        loadSavedState();calculatePlan();
      },expected);
      const snapshot=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
      const cleared=await snapshot();
      const file={name:'warthunder-plans-test.json',mimeType:'application/json',buffer:Buffer.from(imported)};
      await page.locator('[data-backup-file]').setInputFiles(file);
      await page.locator('[data-backup-confirm]').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>state.planned.size),0,'Preview must not restore');
      assert.deepEqual(await snapshot(),cleared,'Preview must not write any storage');
      for(const locale of ['zh','en','ru','de','fr','ja','es']) {
        await page.evaluate(locale=>setLanguage(locale),locale);
        const geometry=await page.locator('#planBackupDialog').evaluate(dialog=>{
          const r=dialog.getBoundingClientRect();
          const clipped=[...dialog.querySelectorAll('button,h2,h3,p')].filter(el=>el.getClientRects().length)
            .filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.textContent);
          return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,clipped,viewport:[innerWidth,innerHeight]};
        });
        assert(geometry.left>=0&&geometry.right<=width+1&&geometry.top>=0&&geometry.bottom<=height+1,JSON.stringify(geometry));
        assert.deepEqual(geometry.clipped,[],`${mode} ${width} ${locale}: clipped copy`);
        const confirmBox=await page.locator('[data-backup-confirm]').boundingBox();
        assert(confirmBox.y>=0&&confirmBox.y+confirmBox.height<=height, 'Confirmation must stay visible without scrolling');
        assert.equal(await page.locator('[data-backup-confirm]').isEnabled(),true);
        if(['zh','de'].includes(locale))await page.screenshot({path:path.join(output,`${mode}-${width}-${locale}.png`)});
      }
      await page.evaluate(()=>setLanguage('zh'));
      await page.locator('[data-backup-cancel]').click();
      assert.equal(await page.evaluate(()=>state.planned.size),0,'Cancel must not restore');
      assert.deepEqual(await snapshot(),cleared,'Cancel must preserve all original records');
      const valid=JSON.parse(imported);
      for(const [name,text] of [
        ['broken','{bad'],['version',JSON.stringify({...valid,version:999})],
        ['duplicate',JSON.stringify({...valid,records:[valid.records[0],valid.records[0]]})],
        ['oversized',' '.repeat(5*1024*1024+1)],
      ]) {
        await page.locator('[data-backup-file]').setInputFiles({name:`${name}.json`,mimeType:'application/json',buffer:Buffer.from(text)});
        await page.waitForFunction(()=>document.querySelector('[data-backup-status]').textContent.length>0 && !document.querySelector('[data-backup-import]').disabled);
        assert(await page.locator('[data-backup-confirm]').isHidden());
        assert.deepEqual(await snapshot(),cleared,`${name} file must not change storage`);
      }
      await page.locator('[data-backup-file]').setInputFiles(file);
      await page.locator('[data-backup-confirm]').waitFor({state:'visible'});
      await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({planned:['us_m3_stuart']})),expected.tree);
      const newer=await snapshot();
      await page.locator('[data-backup-confirm]').click();
      await page.waitForFunction(()=>document.querySelector('[data-backup-status]').textContent.includes('\u5df2\u53d1\u751f\u53d8\u5316'));
      assert.deepEqual(await snapshot(),newer,'Stale preview must not overwrite a newer edit');
      await page.evaluate(key=>localStorage.setItem(key,'{}'),expected.tree);
      const beforeFailure=await snapshot();
      await page.locator('[data-backup-file]').setInputFiles(file);
      await page.locator('[data-backup-confirm]').waitFor({state:'visible'});
      // Inject one quota failure after the first imported record was written.
      await page.evaluate(key=>{
        window.__backupSetItem=Storage.prototype.setItem;
        Storage.prototype.setItem=function(name,value){
          if(name===key)throw new DOMException('Test quota failure','QuotaExceededError');
          return window.__backupSetItem.call(this,name,value);
        };
      },expected.tree);
      try {
        await page.locator('[data-backup-confirm]').click();
        await page.waitForFunction(()=>document.querySelector('[data-backup-status]').textContent.includes('\u5b58\u50a8\u4e0d\u53ef\u7528'));
        assert.deepEqual(await snapshot(),beforeFailure,'Failed restore must roll back every earlier write');
      }finally{await page.evaluate(()=>{Storage.prototype.setItem=window.__backupSetItem;delete window.__backupSetItem;});}
      await page.locator('[data-backup-file]').setInputFiles(file);
      await page.locator('[data-backup-confirm]').click();
      await page.waitForFunction(()=>document.querySelector('[data-backup-status]').textContent==='计划记录已恢复。');
      assert.deepEqual(await page.evaluate(({tree,mods})=>({[tree]:PlanStorage.read(tree),[mods]:PlanStorage.read(mods)}),expected),expected.values);
      assert.deepEqual(await page.evaluate(()=>[els.budgetRp.textContent,els.budgetSl.textContent]),expected.budget);
      assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-test-setting')),'keep-me');
      assert.equal(await page.evaluate(()=>localStorage.getItem('wt-research:germany:aviation')),cleared['wt-research:germany:aviation']);
      await page.locator('[data-backup-close]').click();
      await page.evaluate(()=>ModificationWorkbench.open('us_m18_hellcat'));
      assert(await page.locator(`[data-mod-id="${modId}"]`).evaluate(el=>el.classList.contains('target')),'Modification cache must refresh');
      await page.evaluate(()=>document.getElementById('modificationDialog').close());
      await page.reload();
      await page.waitForFunction(()=>!treeSelectionLoading&&state.units.length>0);
      assert.equal(await page.evaluate(()=>state.planned.has('us_m18_hellcat')),true);
      assert.deepEqual(await page.evaluate(({tree,mods})=>({[tree]:PlanStorage.read(tree),[mods]:PlanStorage.read(mods)}),expected),expected.values);
      assert.deepEqual(await page.evaluate(()=>[els.budgetRp.textContent,els.budgetSl.textContent]),expected.budget);
      await page.evaluate(()=>localStorage.setItem(storageKey(),'{broken'));
      await page.reload();
      await page.waitForFunction(()=>!treeSelectionLoading&&state.units.length>0);
      assert(await page.locator('.plan-storage-warning').isVisible());
      assert.equal(await page.evaluate(()=>localStorage.getItem(storageKey())),'{broken');
      await page.locator('.plan-storage-warning button').first().click();
      await page.locator('[data-backup-file]').setInputFiles(file);
      await page.locator('[data-backup-confirm]').click();
      await page.waitForFunction(()=>document.querySelector('[data-backup-status]').textContent==='\u8ba1\u5212\u8bb0\u5f55\u5df2\u6062\u590d\u3002');
      assert(await page.locator('.plan-storage-warning').isHidden());
      assert.deepEqual(await page.evaluate(({tree,mods})=>({[tree]:PlanStorage.read(tree),[mods]:PlanStorage.read(mods)}),expected),expected.values);
      assert.deepEqual(await page.evaluate(()=>[els.budgetRp.textContent,els.budgetSl.textContent]),expected.budget);
      assert.deepEqual(errors,[]);
      reports.push({mode,width,height,importSource,locales:7,download:true,preview:true,cancel:true,invalidFiles:4,stalePreview:true,quotaRollback:true,restore:true,budget:true,persistence:true,corruptRecovery:true});
      console.log(JSON.stringify(reports.at(-1)));
      await page.close();
    }
  }finally{
    fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify(reports,null,2));
    await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
