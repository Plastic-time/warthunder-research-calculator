const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const cheerio = require('cheerio');
const express = require('express');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

async function selectIsrael(page) {
  await page.waitForFunction(() => typeof state !== 'undefined' && state.units.length && !treeSelectionLoading);
  await page.locator('.country-trigger').click();
  await page.locator('[data-country="israel"]').click();
  await page.waitForFunction(() => state.country === 'israel' && !treeSelectionLoading);
  await page.locator('.branch-tab[data-type="aviation"]').click();
  await page.waitForFunction(() => state.type === 'aviation' && !treeSelectionLoading);
}

async function main() {
  const output = path.join(root, 'logs/planning-rule-cache');
  fs.mkdirSync(output, { recursive: true });
  const currentHtml = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
  const rules = fs.readFileSync(path.join(root, 'docs/unlock-quantity.js'), 'utf8');
  const $ = cheerio.load(currentHtml);
  const currentSrc = $('script[src^="unlock-quantity.js?"]').attr('src');
  const legacySrc = 'unlock-quantity.js?v=1.0.26';
  const legacyHtml = currentHtml.replace(currentSrc.replaceAll('&', '&amp;'), legacySrc);
  let phase = 'legacy';
  let requests = [];
  const app = express();
  app.get('/pages/', (_req, res) => res.set('Cache-Control', 'no-store').type('html')
    .send(phase === 'legacy' ? legacyHtml : currentHtml));
  app.get('/pages/unlock-quantity.js', (req, res) => {
    requests.push({ phase, url: req.originalUrl });
    // Seed a real, fresh browser cache entry with the previously displayed rule.
    res.set('Cache-Control', 'public, max-age=31536000').type('js')
      .send(phase === 'legacy' ? rules + '\nunlock_quantity.israel.aviation.IV = 5;\n' : rules);
  });
  app.use('/pages', express.static(path.join(root, 'docs')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  const report = [];
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 940 },
        isMobile: width < 720, hasTouch: width < 720 });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        phase = 'legacy';
        requests = [];
        const url = `http://127.0.0.1:${server.address().port}/pages/`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await selectIsrael(page);
        assert.match(await page.locator('.rank-unlock-line').first().innerText(), /0 \/ 5/);
        const owned = ['spitfire_mk9c_iaf', 'spitfire_lf_mk9e_iaf', 's_199', 'p-51d-20-na_iaf', 'b-17g_iaf'];
        for (const id of owned) {
          const tile = page.locator(`.unit-tile[data-unit-id="${id}"]`);
          const action = page.locator('#unitContextMenu [data-context-action="owned"]');
          if (width < 720) {
            await tile.scrollIntoViewIfNeeded();
            const box = await tile.boundingBox();
            const touch = await context.newCDPSession(page);
            try {
              await touch.send('Input.dispatchTouchEvent', { type: 'touchStart',
                touchPoints: [{ x: box.x + 40, y: box.y + 60 }] });
              await action.waitFor({ state: 'visible' });
              await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            } finally { await touch.detach(); }
            await action.tap();
          } else {
            await tile.click({ button: 'right' });
            await action.click();
          }
        }
        await page.locator('.unit-tile[data-unit-id="meteor_nfmk13"]').click();
        const saved = await page.evaluate(() => ({ owned: [...state.owned], targets: [...state.planned] }));

        // Navigation keeps the HTTP cache and localStorage. Do not use routes or cache clearing.
        await page.goto('about:blank');
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await selectIsrael(page);
        assert.match(await page.locator('.rank-unlock-line').first().innerText(), /5 \/ 5/);
        assert.equal(requests.length, 1, 'The old rule must actually be served from the browser cache');

        phase = 'current';
        await page.goto('about:blank');
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await selectIsrael(page);
        const restored = await page.evaluate(() => ({ owned: [...state.owned], targets: [...state.planned] }));
        assert.deepEqual(restored, saved, 'Publishing rules must preserve the saved plan');
        const before = await page.locator('.rank-unlock-line').first().innerText();
        assert.match(before, /5 \/ 6/, 'Updated HTML must bypass the cached five-aircraft rule');
        assert.equal(requests.length, 2);
        assert.notEqual(requests[0].url, requests[1].url);
        await page.locator('#planButton').click();
        await page.waitForFunction(() => state.planResult && !els.planButton.disabled);
        const plan = await page.evaluate(() => ({ feasible: state.planResult.feasible,
          fillers: state.planResult.fillerIds, rank: state.planResult.rankCounts.find(row => row.rank === 4),
          gate: document.querySelector('.rank-unlock-line').innerText }));
        assert.equal(plan.feasible, true);
        assert.deepEqual(plan.fillers, ['sb2c_5_greece']);
        assert.equal(plan.rank.required, 6);
        assert.match(plan.gate, /6 \/ 6/);
        await page.locator('.rank-unlock-line span').first().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll('.unit-tile > img')].filter(img => {
          const r = img.getBoundingClientRect();
          return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
        }).every(img => img.complete && img.naturalWidth > 0));
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(output, `updated-${width}.png`) });
        assert.deepEqual(errors, []);
        report.push({ width, oldCacheReused: true, savedPlanPreserved: true, before, plan, requests });
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ pass: true, report }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
