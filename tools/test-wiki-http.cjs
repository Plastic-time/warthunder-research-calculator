const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const axios = require('axios');
const { fetchWikiPage } = require('../src/wiki-http');
const { fetchTreeHTML } = require('../src/1-extract_tree_div');
const { request_details } = require('../src/3-request_details');
const initial = 'https://wiki.warthunder.com/unit/test';

test('Wiki accepts bounded same-origin HTTPS redirects with a shared deadline', async t => {
  const calls = [];
  t.mock.method(axios, 'get', async (url, config) => {
    calls.push({ url, config });
    assert.equal(config.adapter, 'http');
    assert.equal(config.maxRedirects, 0);
    assert.equal(config.maxContentLength, 12 * 1024 * 1024);
    assert.equal(config.timeout, 30000);
    assert.equal(config.responseType, 'text');
    assert.equal(config.validateStatus(500), false);
    return calls.length === 1 ? { status: 302, headers: { location: '/unit/renamed' } }
      : { status: 200, data: '<html>OK</html>' };
  });
  assert.equal(await fetchWikiPage(initial), '<html>OK</html>');
  assert.equal(calls[1].url, 'https://wiki.warthunder.com/unit/renamed');
  assert.equal(calls[0].config.signal, calls[1].config.signal);
});

test('Wiki rejects unsafe initial URLs and redirect targets before requesting them', async t => {
  for (const destination of ['http://wiki.warthunder.com/unit/x', 'https://127.0.0.1/', 'http://169.254.169.254/',
    '//untrusted.invalid/', 'https://wiki.warthunder.com.untrusted.invalid/', 'https://wiki.warthunder.com:444/',
    'file:///not-read', 'data:text/html,test', '#fragment', '']) {
    let calls = 0;
    t.mock.method(axios, 'get', async () => { calls++; return { status: 302, headers: { location: destination } }; });
    await assert.rejects(fetchWikiPage(initial));
    assert.equal(calls, 1, destination);
    await assert.rejects(fetchWikiPage(destination));
    assert.equal(calls, 1, 'Invalid initial URL must not be requested');
    t.mock.restoreAll();
  }
});

test('Wiki rejects URL user information using synthetic parsed credentials', async t => {
  const url = new URL(initial);
  url.username = 'fixture';
  url.password = 'fixture';
  let calls = 0;
  t.mock.method(axios, 'get', async () => { calls++; return { status: 302, headers: { location: url.href } }; });
  await assert.rejects(fetchWikiPage(url.href));
  assert.equal(calls, 0);
  await assert.rejects(fetchWikiPage(initial));
  assert.equal(calls, 1);
});

test('redirect loops and cancellation cannot start unbounded work', async t => {
  let calls = 0;
  t.mock.method(axios, 'get', async () => { calls++; return { status: 307, headers: { location: '/unit/test' } }; });
  await assert.rejects(fetchWikiPage(initial), /Too many Wiki redirects/);
  assert.equal(calls, 4);
  await assert.rejects(fetchWikiPage(initial, { signal: AbortSignal.abort() }));
  assert.equal(calls, 4);
  const controller = new AbortController();
  t.mock.restoreAll();
  t.mock.method(axios, 'get', async () => { controller.abort(); return { status: 302, headers: { location: '/unit/next' } }; });
  await assert.rejects(fetchWikiPage(initial, { signal: controller.signal }));
});

test('both production Wiki readers use the restricted client; invalid tree arguments make no request', async t => {
  let calls = 0;
  t.mock.method(axios, 'get', async (_, config) => {
    calls++;
    assert.equal(config.maxRedirects, 0);
    return { status: 200, data: '<div class="unit-tree" data-tree-id="usa"></div><div class="game-unit"></div>' };
  });
  await fetchTreeHTML('usa', 'ground');
  await request_details('test');
  assert.equal(calls, 2);
  for (const [country, type] of [['usa&x=1', 'ground'], ['usa', '../unit'], [{}, 'ground']]) {
    await assert.rejects(fetchTreeHTML(country, type));
  }
  assert.equal(calls, 2);
});

test('real Axios HTTP adapter does not follow redirects under the production policy', async t => {
  let config;
  const get = axios.get.bind(axios);
  t.mock.method(axios, 'get', async (_, options) => { config = options; return { status: 200, data: '' }; });
  await fetchWikiPage(initial);
  t.mock.restoreAll();
  let destinationHits = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/start') { res.writeHead(302, { Location: '/destination' }); res.end(); }
    else { destinationHits++; res.end('not allowed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const response = await get(`http://127.0.0.1:${server.address().port}/start`, { ...config, proxy: false });
  assert.equal(response.status, 302);
  assert.equal(destinationHits, 0);
});
