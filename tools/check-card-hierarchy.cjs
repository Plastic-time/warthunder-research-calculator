const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const baseline = process.argv.includes('--baseline');
const output = path.resolve(__dirname, '../logs/card-hierarchy');
const snapshotFile = path.join(output, 'baseline.json');
fs.mkdirSync(output, {recursive:true});

async function main() {
  const app = express();
  app.use('/pages', express.static(path.resolve('docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  const records = {};
  const previous = !baseline && fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile)) : null;
  try {
    browser = await chromium.launch({channel:'chrome'});
    for (const mode of ['pages','local']) for (const width of [1440,390]) {
      const key = `${mode}-${width}`;
      const page = await browser.newPage({viewport:{width,height:940},isMobile:width < 720,hasTouch:width < 720,deviceScaleFactor:1});
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`, {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => state.units.length && !treeSelectionLoading);
      await page.evaluate(() => document.fonts.ready);
      const values = () => page.evaluate(() => [...els.treeContainer.querySelectorAll('.unit-tile')].map(tile => ({
        id:tile.dataset.unitId, width:tile.getBoundingClientRect().width,
        rp:tile.querySelector('.rp')?.textContent.trim(), sl:tile.querySelector('.sp')?.textContent.trim(),
        badges:[...tile.querySelectorAll('.roster-badge')].map(b => b.textContent.trim()),
      })));
      records[key] = JSON.parse(JSON.stringify(await values()));
      if (previous) assert.deepEqual(records[key], previous[key], 'Vehicle IDs, costs, classification and width stay unchanged');
      await page.waitForFunction(() => [...document.querySelectorAll('.tree-canvas .unit-tile > img')].slice(0,6).every(i => i.complete && i.naturalWidth));
      await page.screenshot({path:path.join(output,`${baseline?'before':'after'}-${key}-tree.png`)});
      if (!baseline) {
        assert(await page.locator('.researchable-band .roster-standard').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).display === 'none')));
        const before = await page.evaluate(() => JSON.stringify([state.units,els.budgetRp.textContent,els.budgetSl.textContent]));
        await page.evaluate(() => renderTree());
        assert.equal(await page.evaluate(() => JSON.stringify([state.units,els.budgetRp.textContent,els.budgetSl.textContent])), before);
        await page.evaluate(() => {
          const unit = state.units.find(u => parseNumber(u.rp) > 10000 && !isInitialUnlockedUnit(u));
          toggleUnit(unit.data_unit_id);
          state.progressRp[unit.data_unit_id] = 5000;
          calculatePlan();
        });
        assert(await page.locator('.unit-rp-progress').count(), 'Partial progress stays visible');
        assert(await page.locator('.target-label').count(), 'Selection stays visible');
        await page.evaluate(() => els.clearButton.click());
      }
      await page.evaluate(async () => {els.countrySelect.value='china';els.typeSelect.value='aviation';await loadTree();});
      for (const id of ['su_30mkk','j_7d']) {
        const tile = page.locator(`.tree-canvas [data-unit-id="${id}"]`);
        await tile.waitFor();
        await tile.locator(':scope > img').evaluate(i => i.decode());
        await tile.evaluate(tile => {
          const tree=document.getElementById('treeContainer'),r=tile.getBoundingClientRect(),t=tree.getBoundingClientRect();
          tree.scrollLeft += r.left-t.left-(tree.clientWidth-r.width)/2;
          tree.scrollTop += r.top-t.top-70;
        });
        await page.waitForTimeout(100);
        await page.screenshot({path:path.join(output,`${baseline?'before':'after'}-${key}-${id}.png`)});
        await tile.screenshot({path:path.join(output,`${baseline?'before':'after'}-${key}-${id}-card.png`)});
        assert.equal(await tile.locator('.roster-badge').first().textContent(), id === 'su_30mkk'?'礼包载具':'金鹰载具');
        assert.equal(await tile.locator('.rp').textContent(),'RP 0');
        assert.equal(await tile.locator('.sp').textContent(),'SL 0');
        if (!baseline) {
          const icon = await tile.locator('.roster-badge').first().evaluate(el => {
            const s = getComputedStyle(el,'::before');
            const badge = getComputedStyle(el);
            return {mask:s.maskImage,width:s.width,color:s.backgroundColor,textColor:badge.color,display:badge.display,align:badge.alignItems};
          });
          if (id === 'su_30mkk') {
            assert(icon.mask.includes('gift.svg'));
            assert.equal(icon.width,'12px');
          } else {
            assert(icon.mask.includes('golden-eagles.svg'));
            assert.equal(icon.width,'16px');
            await page.evaluate(async background => {
              const image = new Image();
              image.src = background.slice(5,-2);
              await image.decode();
              if (image.naturalWidth !== 24) throw new Error('Golden Eagles artwork failed to load');
            }, icon.mask);
          }
          assert.equal(icon.display,'flex');
          assert.equal(icon.align,'center');
          assert.equal(icon.color,icon.textColor,'Icon and text use the same muted gold');
        }
      }
      if (!baseline) for (const locale of ['zh','en','ru','de','fr','ja','es']) {
        await page.evaluate(locale => setLanguage(locale), locale);
        await page.evaluate(() => document.fonts.ready);
        const issues = await page.evaluate(() => {
          const errors = [];
          for (const tile of els.treeContainer.querySelectorAll('.unit-tile')) {
            if (tile.scrollWidth > tile.clientWidth + 1) errors.push(tile.dataset.unitId + ': card overflow');
            for (const el of tile.querySelectorAll('.unit-title,.unit-meta > .pill,.unit-cost-value')) {
              const r=el.getBoundingClientRect(),t=tile.getBoundingClientRect();
              if (r.width && (r.left<t.left || r.right>t.right || r.bottom>t.bottom)) errors.push(tile.dataset.unitId + ': label outside');
            }
            const rp=tile.querySelector('.rp'),sl=tile.querySelector('.sp');
            if(rp && sl && Math.abs(rp.getBoundingClientRect().top-sl.getBoundingClientRect().top)>1) errors.push(tile.dataset.unitId + ': cost alignment');
          }
          return errors;
        });
        assert.deepEqual(issues,[], `${key} ${locale}`);
      }
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({mode,width,passed:true}));
      await page.close();
    }
    if(baseline) fs.writeFileSync(snapshotFile,JSON.stringify(records,null,2));
  } finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
