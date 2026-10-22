const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const crypto = require('node:crypto');
const express = require('express');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser-test-runtime.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'logs/web-cache-review');

async function choose(page, type = 'aviation') {
  await page.waitForFunction(() => typeof state !== 'undefined' && state.units.length && !treeSelectionLoading);
  await page.evaluate(async type => {
    els.countrySelect.value = 'israel'; els.typeSelect.value = type; await loadTree();
  }, type);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let phase = 'legacy';
  let requests = [];
  const app = express();
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/healthz') return next();
    const folder = req.path.startsWith('/pages/') ? 'docs' : 'public';
    const relative = (folder === 'docs' ? req.path.slice(7) : req.path.slice(1)) || 'index.html';
    const directory = path.join(root, folder);
    const file = path.resolve(directory, relative);
    if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.sendStatus(404);
    let body = fs.readFileSync(file);
    if (phase === 'legacy') {
      if (relative === 'index.html') body = Buffer.from(body.toString().replace(/(?:&amp;|\?)r=[a-f0-9]{16}/g, ''));
      else if (relative === 'asset-urls.js') body = Buffer.from('window.WTAssets = { url: value => value };');
      else if (relative.endsWith('.js')) {
        let source = body.toString();
        if (relative === 'roster.js') source = source.replace("cache: 'no-cache', ", '');
        body = Buffer.from(source + `\n(window.__legacyScripts ||= []).push(${JSON.stringify(relative)});\n`);
      } else if (relative.endsWith('.css')) body = Buffer.from(body.toString().replace(/\?r=[a-f0-9]{16}/g, '') + '\n:root { --cached-style-probe: legacy; }\n');
    }
    if (relative === 'roster-audit.json') {
      const data = JSON.parse(body);
      data.trees['israel/aviation'].units.spitfire_mk9c_iaf.cacheProbe = phase;
      body = Buffer.from(JSON.stringify(data));
    }
    requests.push({ phase, url: req.originalUrl, file: relative });
    const etag = '"' + crypto.createHash('sha256').update(body).digest('hex') + '"';
    res.set({ 'Cache-Control': relative === 'index.html' ? 'no-cache' : 'public, max-age=31536000', ETag: etag });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.type(path.extname(file)).send(body);
  });
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  const reports = [];
  try {
    browser = await chromium.launch(launchOptions());
    for (const mode of ['local', 'pages']) for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 940 }, isMobile: width < 720, hasTouch: width < 720 });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        requests = []; phase = 'legacy';
        const url = `http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await choose(page);
        await page.evaluate(() => {
          toggleUnitMode('meteor_nfmk13', 'target');
          toggleUnitMode('spitfire_mk9c_iaf', 'owned');
          state.progressRp.meteor_nfmk13 = 1234; saveState();
        });
        const snapshot = () => page.evaluate(() => ({ targets: [...state.planned], owned: [...state.owned], progress: state.progressRp }));
        const saved = await snapshot();
        await page.evaluate(() => ModificationWorkbench.open('f_86em_greece'));
        await page.waitForSelector('[data-mod-id="us_aim_9b"]');
        await page.locator('[data-mod-id="us_aim_9b"]').click();
        const modKey = 'wt-research:modifications:f_86em_greece';
        const savedMods = await page.evaluate(key => localStorage.getItem(key), modKey);
        await page.evaluate(() => document.getElementById('modificationDialog').close());
        const appRequests = () => requests.filter(item => item.file === 'app.js').length;
        assert.equal(appRequests(), 1);

        await page.goto('about:blank');
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await choose(page);
        assert.equal(appRequests(), 1, 'Must reuse the real HTTP cache before upgrading');
        assert((await page.evaluate(() => window.__legacyScripts)).includes('research-progress.js'));
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cached-style-probe').trim()), 'legacy');

        phase = 'current';
        // Keep HTTP cache, localStorage and the browser context throughout the upgrade.
        await page.goto('about:blank');
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await choose(page);
        assert.equal(await page.evaluate(() => window.__legacyScripts), undefined);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cached-style-probe').trim()), '');
        assert.equal(appRequests(), 2);
        assert.deepEqual(await snapshot(), saved);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), modKey), savedMods);
        assert.equal(await page.evaluate(() => RosterAudit.info('israel', 'aviation', 'spitfire_mk9c_iaf').cacheProbe), 'current');
        for (const file of ['app-translations.js', 'research-progress.js', 'press-feedback.js', 'modifications.js', 'styles.css', 'ui-dark.css']) {
          assert(requests.some(item => item.phase === 'current' && item.file === file && /[?&]r=[a-f0-9]{16}/.test(item.url)), file);
        }
        for (const locale of ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']) {
          await page.evaluate(locale => { WTI18n.missing.clear(); setLanguage(locale); }, locale);
          assert.deepEqual(await page.evaluate(() => [...WTI18n.missing]), []);
        }
        await page.evaluate(() => setLanguage('zh'));
        await page.evaluate(() => ModificationWorkbench.open('f_86em_greece'));
        await page.waitForSelector('[data-mod-id="us_aim_9b"]');
        await page.locator('[data-modification-action="calculate"]').click();
        assert.notEqual(await page.locator('#modificationRp').innerText(), '0');
        await page.evaluate(() => document.getElementById('modificationDialog').close());
        await choose(page, 'boats');
        await page.waitForFunction(() => document.querySelector('.wiki-empty img')?.naturalWidth > 0);
        const image = await page.locator('.wiki-empty img').getAttribute('src');
        assert.match(image, /\?r=[a-f0-9]{16}/);
        assert(requests.some(item => item.phase === 'current' && item.file === 'assets/fonts/wt-symbols.ttf' && item.url.includes('?r=')));
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(output, `${mode}-${width}-updated.png`) });
        assert.deepEqual(errors, []);
        reports.push({ mode, width, warmCache: true, refreshedScriptsAndStyles: true,
          rosterRevalidated: true, plansAndProgressPreserved: true, modificationPlanPreserved: true,
          localizedViews: 7, emptyImage: image, updatedRequests: requests.filter(item => item.phase === 'current').map(item => item.url) });
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ passed: reports.length, scenarios: reports.map(({ updatedRequests, ...item }) => item) }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
