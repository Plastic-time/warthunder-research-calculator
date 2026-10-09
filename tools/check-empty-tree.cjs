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
  const output = path.resolve('logs/empty-tree');
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    for (const mode of ['local', 'pages']) for (const [width, height] of [[1440,960], [390,844], [320,568], [844,390]]) {
      const mobile = width < 720 || height < 500;
      const page = await browser.newPage({ viewport:{width,height}, isMobile:mobile, hasTouch:mobile });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`);
      await page.waitForFunction(() => !treeSelectionLoading && state.units.length > 0);
      await page.evaluate(async () => {
        els.countrySelect.value='israel'; els.typeSelect.value='boats'; await loadTree();
      });
      await page.waitForFunction(() => document.querySelector('.wiki-empty img')?.naturalWidth > 0);
      for (const locale of ['zh','en','ru','de','fr','ja','es']) {
        await page.evaluate(locale => setLanguage(locale), locale);
        const geometry = await page.evaluate(() => {
          const image = document.querySelector('.wiki-empty img');
          const text = document.querySelector('.wiki-empty p');
          const a=image.getBoundingClientRect(), b=text.getBoundingClientRect();
          const tree=els.treeContainer.getBoundingClientRect();
          const budget=document.getElementById('floatingBudget').getBoundingClientRect();
          return { imageBottom:a.bottom,textTop:b.top,textBottom:b.bottom,treeTop:tree.top,budgetTop:budget.height ? budget.top : tree.bottom,
            overflow:document.documentElement.scrollWidth>innerWidth || text.scrollWidth>text.clientWidth+1,
            imageVisible:a.top>=tree.top && a.left>=tree.left && a.right<=tree.right,
            copy:text.textContent };
        });
        assert(!geometry.overflow && geometry.imageVisible, JSON.stringify({mode,width,locale,geometry}));
        assert(geometry.imageBottom <= geometry.textTop && geometry.textBottom <= geometry.budgetTop, JSON.stringify({mode,width,locale,geometry}));
        if (locale === 'zh') assert.equal(geometry.copy,'这只笨蛋萝莉没有相关的Wiki科技树数据');
        if (['zh','de'].includes(locale)) await page.screenshot({path:path.join(output,`${mode}-${width}-${locale}.png`)});
      }
      await page.evaluate(() => setLanguage('zh'));
      const failedPath = mode === 'pages' ? '**/database/israel/israel_boats.json*' : '**/api/tree/israel/boats';
      await page.route(failedPath, route => route.abort());
      await page.evaluate(() => loadTree());
      assert.equal(await page.locator('.wiki-empty').count(),0);
      assert.equal(await page.locator('#treeContainer .loading').textContent(),'科技树加载失败，请重试');
      await page.evaluate(() => setLanguage('en'));
      assert.match(await page.locator('#treeContainer .loading').textContent(),/Couldn't load/);
      await page.unroute(failedPath);
      await page.evaluate(() => loadTree());
      assert.equal(await page.locator('.wiki-empty').count(),1);
      await page.evaluate(async () => {
        els.countrySelect.value='usa'; els.typeSelect.value='ground'; await loadTree();
        state.search='no-vehicle-matches-this-test'; renderTree();
      });
      assert.equal(await page.locator('.wiki-empty').count(),0);
      assert.equal(await page.locator('#treeContainer .loading').textContent(),'No matches');
      assert(await page.locator('#floatingBudget').isVisible(), 'Budget must return on a populated tree');
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({mode,width,locales:7,empty:true,errorRecovery:true,search:true}));
      await page.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error);process.exitCode=1;});
