const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');
const { restoreTree, restoreCorrection, ratings } = require('./apply-battle-ratings.cjs');
const { restoreCosts } = require('./apply-vehicle-cost-update.cjs');
const evidence = require('../config/battle-rating-update.json');
const correction = require('../config/battle-rating-correction.json');
const manifest = require('../docs/database/manifest.json');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'logs/battle-ratings');

async function run() {
  fs.mkdirSync(output, { recursive: true });
  let legacy = true, requests = 0;
  const oldTree = tree => legacy === 'correction' ? restoreCorrection(tree) : restoreTree(restoreCosts(tree));
  const app = express();
  app.get('/api/tree/:country/:type', (req, res, next) => {
    requests++;
    if (!legacy) return next();
    const file = manifest.files.find(f => f.path === `database/${req.params.country}/${req.params.country}_${req.params.type}.json`);
    if (!file) return res.sendStatus(404);
    res.set('Cache-Control', 'no-store').json({ success: true, data: oldTree(JSON.parse(fs.readFileSync(path.join(root, file.path)))) });
  });
  app.use('/pages/database', (req, res, next) => {
    if (req.path === '/manifest.json') {
      const value = structuredClone(manifest);
      if (legacy) {
        delete value.battleRatingCorrection;
        if (legacy === 'correction') {
          for (const file of value.files) file.sha256 = correction.trees[file.path];
        } else {
          delete value.battleRatings;
          delete value.vehicleCosts;
          for (const file of value.files) if (evidence.trees[file.path]) file.sha256 = evidence.trees[file.path];
        }
      }
      return res.set('Cache-Control', 'public, max-age=31536000').json(value);
    }
    const file = manifest.files.find(f => '/' + f.path.slice('database/'.length) === req.path);
    if (!file) return next();
    requests++;
    const tree = JSON.parse(fs.readFileSync(path.join(root, file.path)));
    res.set('Cache-Control', 'public, max-age=31536000').type('json')
      .send(JSON.stringify(legacy ? oldTree(tree) : tree, null, 2) + '\n');
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
        async function chooseCountry(country) {
          await page.evaluate(async country => { els.countrySelect.value = country; els.typeSelect.value = 'aviation'; await loadTree(); }, country);
          await page.waitForFunction(() => !treeSelectionLoading && state.units.length);
        }
        legacy = 'correction';
        await page.goto('about:blank'); await page.goto(url); await choose();
        for (const country of ['china', 'japan', 'ussr', 'britain']) await chooseCountry(country);
        assert.equal(await page.evaluate(() => state.unitMap.get('hawk_t1a').br), '7.7');
        await page.evaluate(async () => {
          toggleUnitMode('hawk_t1a', 'target'); toggleUnitMode('spitfire_mk18e', 'owned');
          state.progressRp.hawk_t1a = 1000; saveState(); await PlanStorage.settled();
        });
        const hawkSaved = await snapshot(), correctionRequests = requests;
        legacy = false;
        await page.goto('about:blank'); await page.goto(url); await choose();
        let verified = 0;
        for (const country of ['china', 'japan', 'ussr', 'britain']) {
          await chooseCountry(country);
          const actual = await page.evaluate(ids => ids.filter(id => state.unitMap.has(id)).map(id => {
            const unit = state.unitMap.get(id);
            return { id, br: unit.br, modes: unit.game_battle_ratings };
          }), Object.keys(correction.units));
          for (const item of actual) {
            const expected = ratings(correction.units[item.id].ranks, 'aviation');
            assert.deepEqual(item.modes, expected, item.id);
            assert.equal(item.br, expected.by_battle.air.RB);
            verified++;
          }
        }
        assert.equal(verified, 7);
        assert(requests > correctionRequests);
        assert.deepEqual(await snapshot(), hawkSaved, 'October 30 correction preserves existing player state');
        const hawk = page.locator('[data-unit-id="hawk_t1a"]');
        assert.equal(await hawk.locator('[data-unit-br]').innerText(), 'BR 7.3');
        await hawk.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => document.querySelector('[data-unit-id="hawk_t1a"] img')?.naturalWidth > 0);
        await page.screenshot({ path: path.join(output, `${mode}-${width}-correction.png`) });
        for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
          await page.evaluate(locale => { WTI18n.missing.clear(); setLanguage(locale); }, locale);
          if (!(await page.locator('#guideButton').isVisible())) await page.locator('#mobileMoreButton').click();
          await page.locator('#guideButton').click(); await page.locator('#usageGuideLogTab').click();
          const latest = page.locator('#usageGuideChangelog article').first();
          assert((await latest.innerText()).includes(require('../config/data-version.json').latestReview.gameVersion));
          assert(await latest.locator('p').evaluate(p => p.scrollWidth <= p.clientWidth));
          assert.deepEqual(await page.evaluate(() => [...WTI18n.missing]), []);
          if (locale === 'en') await page.screenshot({ path: path.join(output, `${mode}-${width}-guide.png`) });
          await page.evaluate(() => document.getElementById('usageGuideDialog').close());
        }
        assert.deepEqual(errors, []);
        results.push({ mode, width, br, correctedAircraft: verified, warmCache: true, plansPreserved: true, locales: 7 });
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
