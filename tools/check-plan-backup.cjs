const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const express = require('express');
const {chromium} = require('playwright');

(async () => {
  const app=express();
  app.use('/pages',express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const output=path.resolve('logs/plan-backup');fs.mkdirSync(output,{recursive:true});
  let browser;
  try {
    browser=await chromium.launch({channel:'chrome'});
    for (const mode of ['local','pages']) for (const [width,height] of [[1440,960],[390,844],[320,568],[844,390]]) {
      const mobile=width<720||height<500;
      const page=await browser.newPage({viewport:{width,height},isMobile:mobile,hasTouch:mobile,acceptDownloads:true});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode==='pages'?'pages/':''}`);
      await page.waitForFunction(()=>!treeSelectionLoading&&state.units.length>0);
      await page.evaluate(()=>ModificationWorkbench.open('us_m18_hellcat'));
      const modId=await page.locator('[data-mod-id]').first().getAttribute('data-mod-id');
      await page.evaluate(()=>document.getElementById('modificationDialog').close());
      const expected=await page.evaluate(modId=>{
        const tree=storageKey(),mods='wt-research:modifications:us_m18_hellcat';
        PlanStorage.write(tree,{planned:['us_m18_hellcat'],owned:['us_m2a4'],waypoints:['us_m4a1_1942'],progressRp:{us_m18_hellcat:1000},avoidFolded:true});
        PlanStorage.write(mods,{selected:[modId],researched:[],progressRp:{[modId]:100},airCombat:false});
        localStorage.setItem('unrelated-test-setting','keep-me');
        loadSavedState();calculatePlan();
        return {tree,mods,modId,values:{[tree]:PlanStorage.read(tree),[mods]:PlanStorage.read(mods)},budget:[els.budgetRp.textContent,els.budgetSl.textContent]};
      },modId);
      if(mobile)await page.locator('#mobileMoreButton').click();
      await page.locator('#planBackupButton').click();
      const downloadEvent=page.waitForEvent('download');
      await page.locator('[data-backup-export]').click();
      const download=await downloadEvent;
      const backupPath=path.join(output,`${mode}-${width}.json`);await download.saveAs(backupPath);
      const backup=fs.readFileSync(backupPath,'utf8');
      assert.equal(JSON.parse(backup).records.length,2);
      assert(!backup.includes('unrelated-test-setting'));
      await page.evaluate(({tree,mods})=>{PlanStorage.write(tree,{});PlanStorage.write(mods,{});loadSavedState();calculatePlan();},expected);
      const file={name:'warthunder-plans-test.json',mimeType:'application/json',buffer:Buffer.from(backup)};
      await page.locator('[data-backup-file]').setInputFiles(file);
      await page.locator('[data-backup-confirm]').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>state.planned.size),0,'Preview must not restore');
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
      await page.locator('[data-backup-file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
      await page.waitForFunction(()=>document.querySelector('[data-backup-status]').textContent.includes('无效'));
      assert(await page.locator('[data-backup-confirm]').isHidden());
      await page.locator('[data-backup-file]').setInputFiles(file);
      await page.locator('[data-backup-confirm]').click();
      await page.waitForFunction(()=>document.querySelector('[data-backup-status]').textContent==='计划记录已恢复。');
      assert.deepEqual(await page.evaluate(({tree,mods})=>({[tree]:PlanStorage.read(tree),[mods]:PlanStorage.read(mods)}),expected),expected.values);
      assert.deepEqual(await page.evaluate(()=>[els.budgetRp.textContent,els.budgetSl.textContent]),expected.budget);
      assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated-test-setting')),'keep-me');
      await page.locator('[data-backup-close]').click();
      await page.evaluate(()=>ModificationWorkbench.open('us_m18_hellcat'));
      assert(await page.locator(`[data-mod-id="${modId}"]`).evaluate(el=>el.classList.contains('target')),'Modification cache must refresh');
      await page.evaluate(()=>document.getElementById('modificationDialog').close());
      await page.reload();
      await page.waitForFunction(()=>!treeSelectionLoading&&state.units.length>0);
      assert.equal(await page.evaluate(()=>state.planned.has('us_m18_hellcat')),true);
      await page.evaluate(()=>localStorage.setItem(storageKey(),'{broken'));
      await page.reload();
      await page.waitForFunction(()=>!treeSelectionLoading&&state.units.length>0);
      assert(await page.locator('.plan-storage-warning').isVisible());
      assert.equal(await page.evaluate(()=>localStorage.getItem(storageKey())),'{broken');
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({mode,width,locales:7,download:true,preview:true,restore:true,budget:true,persistence:true,corruptRecovery:true}));
      await page.close();
    }
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
