const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');
const { restoreCosts } = require('./apply-vehicle-cost-update.cjs');
const { restoreCorrection } = require('./apply-battle-ratings.cjs');
const evidence = require('../config/vehicle-cost-update.json');
const manifest = require('../docs/database/manifest.json');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'logs/vehicle-cost-update');
const file = 'database/japan/japan_aviation.json';
const tree = require('../docs/' + file);
const legacyTree = restoreCosts(restoreCorrection(tree));
assert.equal(require('node:crypto').createHash('sha256').update(JSON.stringify(legacyTree, null, 2) + '\n').digest('hex'), evidence.trees[file]);

async function run() {
  fs.mkdirSync(output, { recursive: true });
  let legacy = true;
  const app = express();
  app.get('/api/tree/japan/aviation', (req, res, next) => legacy
    ? res.set('Cache-Control', 'no-store').json({ success: true, data: legacyTree }) : next());
  app.get('/pages/database/manifest.json', (req, res) => {
    const value = structuredClone(manifest);
    if (legacy) {
      delete value.vehicleCosts;
      delete value.battleRatingCorrection;
      for (const row of value.files) row.sha256 = evidence.trees[row.path];
    }
    res.set('Cache-Control', 'public, max-age=31536000').json(value);
  });
  app.get('/pages/' + file, (req, res) => res.set('Cache-Control', 'public, max-age=31536000')
    .type('json').send(JSON.stringify(legacy ? legacyTree : tree, null, 2) + '\n'));
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch(launchOptions());
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 940 }, isMobile: width === 390, hasTouch: width === 390 });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const url = base + (mode === 'pages' ? '/pages/' : '/');
        async function choose() {
          await page.waitForFunction(() => typeof state !== 'undefined' && state.units.length && !treeSelectionLoading);
          await page.evaluate(async () => { els.countrySelect.value = 'japan'; els.typeSelect.value = 'aviation'; await loadTree(); });
          await page.waitForFunction(() => state.unitMap.has('p1y1_mod11') && !treeSelectionLoading);
        }
        const saved = () => page.evaluate(() => ({ targets: [...state.planned], owned: [...state.owned], progress: state.progressRp }));
        const budget = () => page.evaluate(() => ({ rp: els.budgetRp.textContent, sl: els.budgetSl.textContent }));
        legacy = true; await page.goto(url); await choose();
        await page.evaluate(async () => {
          state.dependencyMode = 'selected';
          for (const id of ['p1y1_mod11', 'b7a2', 'ki_93_1_ko']) toggleUnitMode(id, 'target');
          toggleUnitMode('d4y3', 'owned');
          state.progressRp.p1y1_mod11 = 10000;
          saveState(); calculatePlan(); renderTree(); await PlanStorage.settled();
        });
        assert.deepEqual(await budget(), { rp: '67,000', sl: '228,000' });
        const original = await saved();
        legacy = false; await page.goto('about:blank'); await page.goto(url); await choose();
        assert.deepEqual(await saved(), original, 'Saved targets, ownership and invested RP survive the price update');
        assert.deepEqual(await budget(), { rp: '89,000', sl: '316,000' });
        for (const [id, entry] of Object.entries(evidence.units)) {
          assert.deepEqual(await page.evaluate(id => { const u = state.unitMap.get(id); return { rp: u.rp, sl: u.sp }; }, id), entry.after);
        }
        const request = await page.evaluate(() => ({ plannedIds: [...state.planned], ownedIds: [...state.owned], progressRp: state.progressRp }));
        const response = await fetch(base + '/api/calculate/japan/aviation', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request)
        });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.total_rp, 89000); assert.equal(result.raw_total_rp, 99000); assert.equal(result.total_sp, 316000);
        const card = page.locator('[data-unit-id="p1y1_mod11"]');
        await card.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('[data-unit-id="p1y1_mod11"] img')?.naturalWidth > 0);
        assert.match(await card.locator('.pill.rp').innerText(), /16,000/);
        assert.match(await card.locator('.pill.sp').innerText(), /76,000/);
        await page.screenshot({ path: path.join(output, `${mode}-${width}.png`) });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
          await page.evaluate(locale => { WTI18n.missing.clear(); setLanguage(locale); }, locale);
          if (!(await page.locator('#guideButton').isVisible())) await page.locator('#mobileMoreButton').click();
          await page.locator('#guideButton').click(); await page.locator('#usageGuideLogTab').click();
          const latest = page.locator('#usageGuideChangelog article').filter({ hasText: 'P1Y1' }).first();
          assert((await latest.innerText()).includes('P1Y1'));
          assert(await latest.locator('p').evaluate(p => p.scrollWidth <= p.clientWidth));
          assert.deepEqual(await page.evaluate(() => [...WTI18n.missing]), []);
          if (locale === 'en') await page.screenshot({ path: path.join(output, `${mode}-${width}-guide.png`) });
          await page.evaluate(() => document.getElementById('usageGuideDialog').close());
        }
        assert.deepEqual(errors, []);
        results.push({ mode, width, warmCache: true, plansPreserved: true, rp: 89000, sl: 316000, apiMatches: true, locales: 7 });
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ passed: results.length, results }));
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
