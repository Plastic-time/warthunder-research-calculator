const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');
const cheerio = require('cheerio');
const { revision, versionedUrl, generatedResolver, rewriteCss, rewriteHtml, syncWebAssets } = require('./sync-web-assets.cjs');
const root = path.resolve(__dirname, '..');

test('content revisions change with content and tolerate Git line endings', () => {
  assert.equal(revision(Buffer.from('a\r\nb\r\n'), 'app.js'), revision(Buffer.from('a\nb\n'), 'app.js'));
  assert.notEqual(revision(Buffer.from('a'), 'app.js'), revision(Buffer.from('b'), 'app.js'));
  assert.notEqual(revision(Buffer.from('a\r\n'), 'image.png'), revision(Buffer.from('a\n'), 'image.png'));
});

test('URLs retain unrelated parameters and fragments, and never rewrite remote media', () => {
  const versions = { 'assets/icon.svg': 'abc123' };
  for (const value of ['https://example.test/assets/icon.svg', '//example.test/assets/icon.svg', 'data:image/png,abc', 'blob:abc', '#arrow', 'missing.png']) {
    assert.equal(versionedUrl(value, versions), value);
  }
  assert.equal(versionedUrl('assets/icon.svg?v=1&r=old#symbol', versions), 'assets/icon.svg?v=1&r=abc123#symbol');
  assert.equal(versionedUrl('/assets/icon.svg', versions), '/assets/icon.svg?r=abc123');
  const context = { window: {}, URL };
  vm.runInNewContext(generatedResolver(versions), context);
  assert.equal(context.window.WTAssets.url('assets/icon.svg'), 'assets/icon.svg?r=abc123');
});

test('nested CSS dependencies change their URL without touching layout or external URLs', () => {
  const source = '/* style */ .a { mask: url("../assets/icon.svg#part"); color: red; }\n.b {src:url(data:font/woff2;base64,abc)}';
  assert.equal(rewriteCss(source, 'styles/ui.css', { 'assets/icon.svg': 'new' }),
    source.replace('../assets/icon.svg#part', '../assets/icon.svg?r=new#part'));
  assert.throws(() => rewriteCss('a{mask:url(missing.svg)}', 'ui.css', {}), /Unversioned CSS/);
});

test('HTML rewriting preserves CSP, element order, formatting and external links', () => {
  const html = '<!doctype html>\n<meta http-equiv="Content-Security-Policy" content="script-src \'self\'">\n' +
    '<script src="app.js?v=1&amp;r=old" defer></script>\n<a href="https://example.test/">Link</a>';
  const bytes = Buffer.from('test');
  assert.equal(rewriteHtml(html, new Map([['app.js', bytes]])), html.replace('r=old', 'r=' + revision(bytes, 'app.js')));
  assert.throws(() => rewriteHtml(html, new Map()), /Missing HTML asset/);
});

test('sync detects source drift, updates dependent URLs and remains idempotent', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-web-cache-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const folder of ['public', 'docs']) {
    const base = path.join(directory, folder);
    fs.mkdirSync(path.join(base, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(base, 'assets/icon.svg'), '<svg/>');
    fs.writeFileSync(path.join(base, 'app.js'), 'const test = 1;');
    fs.writeFileSync(path.join(base, 'ui.css'), '.icon{mask:url(assets/icon.svg)}');
    fs.writeFileSync(path.join(base, 'index.html'), '<script src="asset-urls.js"></script><script src="app.js"></script><link rel="stylesheet" href="ui.css">');
  }
  assert.throws(() => syncWebAssets(directory, { check: true }), /Stale asset URLs/);
  syncWebAssets(directory);
  assert.equal(syncWebAssets(directory, { check: true }).changed.length, 0);
  const before = fs.readFileSync(path.join(directory, 'docs/index.html'), 'utf8');
  fs.writeFileSync(path.join(directory, 'docs/app.js'), 'const test = 2;');
  fs.writeFileSync(path.join(directory, 'docs/assets/icon.svg'), '<svg>new</svg>');
  assert.throws(() => syncWebAssets(directory, { check: true }), /docs\/index.html/);
  const result = syncWebAssets(directory);
  assert.deepEqual(result.changed.sort(), ['docs/asset-urls.js', 'docs/index.html', 'docs/ui.css']);
  assert.notEqual(fs.readFileSync(path.join(directory, 'docs/index.html'), 'utf8'), before);
  assert.equal(syncWebAssets(directory).changed.length, 0);
  const resolver = path.join(directory, 'docs/asset-urls.js');
  fs.writeFileSync(resolver, fs.readFileSync(resolver, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(syncWebAssets(directory, { check: true }).changed.length, 0);
});

test('all shipped entrypoints and local media have matching content versions', () => {
  const result = syncWebAssets(root, { check: true });
  for (const folder of ['public', 'docs']) {
    assert(result.counts[folder].media >= 106);
    const $ = cheerio.load(fs.readFileSync(path.join(root, folder, 'index.html'), 'utf8'));
    assert.match($('script[src]').first().attr('src'), /^\/?asset-urls\.js\?r=[a-f0-9]{16}$/);
  }
});

test('roster data requests explicitly revalidate instead of trusting a fresh old response', async () => {
  for (const folder of ['public', 'docs']) {
    let request;
    const context = { window: { WTI18n: { t: source => source } }, document: { addEventListener() {} },
      AbortSignal, console, fetch: async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => ({ schema: 2, trees: {} }) };
      } };
    vm.runInNewContext(fs.readFileSync(path.join(root, folder, 'roster.js'), 'utf8'), context);
    await context.window.RosterAudit.load();
    assert.equal(request.options.cache, 'no-cache');
  }
});

test('backend HTML and static assets revalidate; API responses remain no-store', async t => {
  const server = require('../main').listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const route of ['/', '/app.js', '/styles.css', '/assets/research-emblem.png', '/api/tree/israel/aviation']) {
    const response = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${server.address().port}${route}`, res => { res.resume(); res.on('end', () => resolve(res)); }).on('error', reject);
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], route.startsWith('/api/') ? 'no-store' : 'no-cache');
  }
});
