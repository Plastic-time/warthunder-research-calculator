const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');
const { restoreTree } = require('./apply-battle-ratings.cjs');
const evidence = require('../config/battle-rating-update.json');
const manifest = require('../docs/database/manifest.json');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'logs/battle-ratings');

async function run() {
  fs.mkdirSync(output, { recursive: true });
  let legacy = true, requests = 0;
  const app = express();
  app.get('/api/tree/:country/:type', (req, res, next) => {
    requests++;
    if (!legacy) return next();
    const file = manifest.files.find(f => f.path === `database/${req.params.country}/${req.params.country}_${req.params.type}.json`);
    if (!file) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store').json({ success: true, data: restoreTree(JSON.parse(fs.readFileSync(path.join(root, file.path)))) });
  });
  app.use('/pages/database', (req, res, next) => {
    if (req.path === '/manifest.json') {
      const value = structuredClone(manifest);
      if (legacy) {
        delete value.battleRatings;
        for (const file of value.files) if (evidence.trees[file.path]) file.sha256 = evidence.trees[file.path];
      }
      return res.set('Cache-Control', 'public, max-age=31536000').json(value);
    }
    const file = manifest.files.find(f => '/' + f.path.slice('database/'.length) === req.path);
    if (!file) return next();
    requests++;
    const tree = JSON.parse(fs.readFileSync(path.join(root, file.path)));
    res.set('Cache-Control', 'public, max-age=31536000').type('json')
      .send(JSON.stringify(legacy ? restoreTree(tree) : tree, null, 2) + '\n');
  });
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  const results = [];
  try {
    browser = await chromium.launch(launchOptions());
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 940 }, isMobile: width === 390, hasTouch: width === 390 });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const url = `http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`;
        async function choose() {
          await page.waitForFunction(() => typeof state !== 'undefined' && state.units.length && !treeSelectionLoading);
          await page.evaluate(async () => { els.countrySelect.value = 'usa'; els.typeSelect.value = 'aviation'; await loadTree(); });
          await page.waitForFunction(() => state.unitMap.has('f_15c_golden_eagle') && !treeSelectionLoading);
        }
        legacy = true;
        await page.goto(url); await choose();
        assert.equal(await page.evaluate(() => state.unitMap.get('f_15c_golden_eagle').br), '14.3');
        await page.evaluate(async () => {
          toggleUnitMode('f_15c_golden_eagle', 'target');
          toggleUnitMode('a_10a_early', 'owned');
          state.progressRp.f_15c_golden_eagle = 1234; saveState(); await PlanStorage.settled();
        });
        const snapshot = () => page.evaluate(() => ({ targets: [...state.planned], owned: [...state.owned], progress: state.progressRp }));
        const saved = await snapshot(), beforeRequests = requests;
        legacy = false;
        await page.goto('about:blank'); await page.goto(url); await choose();
        assert(requests > beforeRequests, 'Updated data must be requested in the existing browser context');
        assert.deepEqual(await snapshot(), saved, 'Plans and progress survive a BR-only update');
        const br = await page.evaluate(() => {
          const a = state.unitMap.get('a_10a_early');
          return { eagle: state.unitMap.get('f_15c_golden_eagle').br, air: a.br, tank: a.game_battle_ratings.by_battle.tank.RB };
        });
        assert.deepEqual(br, { eagle: '15.0', air: '10.3', tank: '11.0' });
        assert.equal(await page.locator('[data-unit-id="f_15c_golden_eagle"] [data-unit-br]').innerText(), 'BR 15.0');
        await page.locator('[data-unit-id="f_15c_golden_eagle"]').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('[data-unit-id="f_15c_golden_eagle"] img')?.naturalWidth > 0);
        await page.screenshot({ path: path.join(output, `${mode}-${width}.png`) });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
          await page.evaluate(locale => { WTI18n.missing.clear(); setLanguage(locale); }, locale);
          if (!(await page.locator('#guideButton').isVisible())) await page.locator('#mobileMoreButton').click();
          await page.locator('#guideButton').click(); await page.locator('#usageGuideLogTab').click();
          const latest = page.locator('#usageGuideChangelog article').first();
          assert((await latest.innerText()).includes('2.59.0.93'));
          assert(await latest.locator('p').evaluate(p => p.scrollWidth <= p.clientWidth));
          assert.deepEqual(await page.evaluate(() => [...WTI18n.missing]), []);
          if (locale === 'en') await page.screenshot({ path: path.join(output, `${mode}-${width}-guide.png`) });
          await page.evaluate(() => document.getElementById('usageGuideDialog').close());
        }
        assert.deepEqual(errors, []);
        results.push({ mode, width, br, warmCache: true, plansPreserved: true, locales: 7 });
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ passed: results.length, results }));
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
