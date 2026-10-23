const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');

function harness(fetch = async () => ({ ok: true, blob: async () => ({ type: 'image/png' }) })) {
  let requests = 0;
  const context = {
    window: { WTI18n: { t: source => source } }, document: { addEventListener() {} },
    AbortController, setTimeout, clearTimeout,
    FileReader: class {
      readAsDataURL() { this.result = 'data:image/png;base64,test'; this.onload(); this.onloadend(); }
      abort() { this.onabort(); this.onloadend(); }
    },
    fetch: (...args) => { requests++; return fetch(...args); },
  };
  const source = fs.readFileSync(path.join(root, 'public/route-export.js'), 'utf8');
  vm.runInNewContext(source.replace('  window.RouteExporter = {',
    '  window.testExport = { cacheImage, embedImage, embedImages, imageCache, bytes: () => cacheBytes, CACHE_BYTES, CACHE_ENTRIES };\n  window.RouteExporter = {'), context);
  return { ...context.window.testExport, requests: () => requests };
}
const job = () => ({ controller: new AbortController(), pending: new Map() });

test('local and static exporters and styles match', () => {
  for (const file of ['route-export.js', 'route-export.css']) {
    const read = folder => fs.readFileSync(path.join(root, folder, file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(read('public'), read('docs'));
  }
});

test('image cache caps entry count and evicts the least recently used image', async () => {
  const h = harness();
  for (let n = 0; n < h.CACHE_ENTRIES; n++) h.cacheImage('image-' + n, 'data:image/png,x');
  await h.embedImage('image-0', job());
  h.cacheImage('new', 'data:image/png,x');
  assert.equal(h.imageCache.size, h.CACHE_ENTRIES);
  assert(h.imageCache.has('image-0'));
  assert(!h.imageCache.has('image-1'));
  assert.equal(h.requests(), 0);
});

test('image cache caps bytes, accounts for replacement and skips oversized images', () => {
  const h = harness();
  h.cacheImage('a', 'a'.repeat(h.CACHE_BYTES / 4));
  h.cacheImage('b', 'b'.repeat(h.CACHE_BYTES / 4));
  assert.equal(h.bytes(), h.CACHE_BYTES);
  h.cacheImage('c', 'c');
  assert(!h.imageCache.has('a'));
  h.cacheImage('b', 'small');
  assert.equal(h.bytes(), 12);
  h.cacheImage('huge', 'x'.repeat(h.CACHE_BYTES / 2 + 1));
  assert(!h.imageCache.has('huge'));
  assert.equal(h.bytes(), 12);
});

test('concurrent duplicate images share a request and only completed data is cached', async () => {
  const h = harness();
  const current = job();
  const result = await Promise.all([h.embedImage('image', current), h.embedImage('image', current)]);
  assert.equal(result[0], result[1]);
  assert.equal(h.requests(), 1);
  assert.equal(current.pending.size, 0);
  assert.equal(typeof h.imageCache.get('image'), 'string');
});

test('failed requests retry once, leave no cache and allow a later retry', async () => {
  let fail = true;
  const h = harness(async () => {
    if (fail) throw new Error('test network failure');
    return { ok: true, blob: async () => ({ type: 'image/png' }) };
  });
  const current = job();
  await assert.rejects(h.embedImage('image', current), /network failure/);
  assert.equal(h.requests(), 2);
  assert.equal(current.pending.size, 0);
  assert.equal(h.imageCache.size, 0);
  fail = false;
  await h.embedImage('image', current);
  assert.equal(h.requests(), 3);
});

test('cancelling aborts the live fetch without retrying or poisoning the next job', async () => {
  let signal;
  const h = harness(async (_, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const current = job();
  const pending = h.embedImage('image', current);
  current.controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert(signal.aborted);
  assert.equal(h.requests(), 1);
  assert.equal(current.pending.size, 0);
  assert.equal(h.imageCache.size, 0);
  await assert.rejects(h.embedImage('image', current), { name: 'AbortError' });
  assert.equal(h.requests(), 1);
});

test('a successful HTTP response with undecodable image data is removed from cache', async () => {
  const h = harness();
  const image = fail => ({ src: 'image', removeAttribute() {}, decode: async () => { if (fail) throw new Error('corrupt image'); } });
  await assert.rejects(h.embedImages({ querySelectorAll: () => [image(true)] }, job()));
  assert.equal(h.imageCache.size, 0);
  assert.equal(h.bytes(), 0);
  await h.embedImages({ querySelectorAll: () => [image(false)] }, job());
  assert.equal(h.requests(), 2);
  assert.equal(h.imageCache.size, 1);
});
