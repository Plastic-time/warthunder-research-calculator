const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const beautifyRequire = createRequire(require.resolve('js-beautify/package.json'));
const editorRequire = createRequire(beautifyRequire.resolve('editorconfig/package.json'));
const semver = editorRequire('semver');
const lock = require('../package-lock.json');

for (const [name, minimum] of Object.entries({ 'follow-redirects': '1.16.2', glob: '14.0.2', minimatch: '11.0.1' })) {
  test(`all locked ${name} copies include the reviewed security fix`, () => {
    const copies = Object.entries(lock.packages).filter(([key]) => key.endsWith(`node_modules/${name}`));
    assert(copies.length > 0);
    for (const [key, entry] of copies) assert(semver.gte(entry.version, minimum), `${key}: expected >=${minimum}`);
  });
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-dependency-security-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('custom sensitive headers from another realm stay on the original redirect origin', { timeout: 10000 }, async t => {
  const seen = [];
  const target = http.createServer((req, res) => { seen.push(req.headers); res.end('ok'); });
  const source = http.createServer((req, res) => {
    seen.push(req.headers);
    res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/` });
    res.end();
  });
  for (const server of [target, source]) {
    t.after(() => { server.closeAllConnections(); server.close(); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  const client = createRequire(require.resolve('axios/package.json'))('follow-redirects').http;
  for (const arrayHeaders of [false, true]) {
    seen.length = 0;
    await new Promise((resolve, reject) => {
      const headers = { 'X-Private-Fixture': 'synthetic', 'X-Harmless': 'keep' };
      const request = client.get(`http://127.0.0.1:${source.address().port}/`, {
        sensitiveHeaders: vm.runInNewContext("['X-Private-Fixture']"),
        headers: arrayHeaders ? Object.entries(headers).flat() : headers,
      }, response => { response.resume(); response.on('end', resolve); });
      request.on('error', reject);
      request.setTimeout(3000, () => request.destroy(new Error('Fixture request timed out')));
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[0]['x-private-fixture'], 'synthetic');
    assert.equal(seen[1]['x-private-fixture'], undefined);
    assert.equal(seen[1]['x-harmless'], 'keep');
  }
});

test('scoped glob and minimatch upgrades preserve formatting and EditorConfig matching', () => {
  const html = '<div class="unit-tree" data-tree-id="usa"><span>RP 100</span><span>SL 200</span></div>';
  const options = { indent_size: 2, preserve_newlines: true, max_preserve_newlines: 1, end_with_newline: true };
  assert.equal(require('js-beautify').html(html, options),
    '<div class="unit-tree" data-tree-id="usa"><span>RP 100</span><span>SL 200</span></div>\n');
  const { Minimatch } = editorRequire('minimatch');
  const matcher = new Minimatch('**/*.{html,js}', { dot: true });
  for (const file of ['tree.html', 'nested/tree.js', '.hidden/tree.html']) assert(matcher.match(file));
  assert.equal(matcher.match('tree.json'), false);
});

test('js-beautify CLI still applies EditorConfig to glob-selected files', t => {
  const directory = temporaryDirectory(t);
  fs.writeFileSync(path.join(directory, '.editorconfig'), 'root = true\n[*.js]\nindent_style = space\nindent_size = 2\n');
  fs.writeFileSync(path.join(directory, 'sample.js'), 'if(true){work();}');
  fs.writeFileSync(path.join(directory, 'ignored.txt'), 'untouched');
  const cli = path.join(path.dirname(require.resolve('js-beautify/package.json')), 'js/bin/js-beautify.js');
  execFileSync(process.execPath, [cli, '--editorconfig', '*.js'], { cwd: directory, encoding: 'utf8', timeout: 10000 });
  assert.match(fs.readFileSync(path.join(directory, 'sample.js'), 'utf8'), /if \(true\) \{\r?\n {2}work\(\);\r?\n\}/);
  assert.equal(fs.readFileSync(path.join(directory, 'ignored.txt'), 'utf8'), 'untouched');
});

test('aborting a glob walk does not continue reading child directories', async t => {
  const directory = temporaryDirectory(t);
  fs.mkdirSync(path.join(directory, 'a/b/c'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'a/b/c/file.txt'), 'fixture');
  const controller = new AbortController();
  let reads = 0;
  const fixtureFs = { ...fs, readdir: (file, options, callback) => {
    reads++;
    fs.readdir(file, options, (error, entries) => {
      controller.abort(new Error('fixture cancellation'));
      callback(error, entries);
    });
  } };
  await assert.rejects(beautifyRequire('glob').glob('**/*', { cwd: directory, fs: fixtureFs, signal: controller.signal }), /fixture cancellation/);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(reads, 1);
});
