const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateVendored, hashText, requestBytes, assertAdvisories, readArchive, auditVendored } = require('./audit-vendored-dependencies.cjs');

function fixture() {
  const script = Buffer.from('throw new Error("Never execute audit inputs");\n'), license = Buffer.from('Example license\n');
  const archive = Buffer.from('fixture archive');
  const entry = {
    id: 'example', kind: 'vendored', coverage: 'npm-vendored-audit', packageName: 'example', version: '1.2.3',
    integrity: 'sha512-' + crypto.createHash('sha512').update(archive).digest('base64'),
    files: ['public/example.js', 'docs/example.js', 'public/example.LICENSE.txt', 'docs/example.LICENSE.txt'],
    artifacts: [
      { archivePath: 'package/dist/example.js', sha256Lf: hashText(script), files: ['public/example.js', 'docs/example.js'] },
      { archivePath: 'package/LICENSE', sha256Lf: hashText(license), files: ['public/example.LICENSE.txt', 'docs/example.LICENSE.txt'] },
    ],
  };
  const pkg = { name: entry.packageName, version: entry.version };
  const metadata = { ...pkg, dist: { integrity: entry.integrity, tarball: 'https://registry.npmjs.org/example/-/example-1.2.3.tgz' } };
  const copies = new Map(entry.files.map(file => [file, file.endsWith('.js') ? script : license]));
  const calls = [], f = { entry, archive, pkg, metadata, script, license, copies, calls, advisories: {} };
  f.fetcher = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert(options.signal instanceof AbortSignal);
    if (url.endsWith('/bulk')) {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { example: ['1.2.3'] });
      return new Response(JSON.stringify(f.advisories));
    }
    return new Response(url.endsWith('.tgz') ? f.archive : JSON.stringify(f.metadata));
  };
  f.archiveReader = (bytes, members) => {
    assert.deepEqual(bytes, archive);
    assert.deepEqual(members, ['package/package.json', 'package/dist/example.js', 'package/LICENSE']);
    return [Buffer.from(JSON.stringify(f.pkg)), f.script, f.license];
  };
  f.validate = () => validateVendored(entry, file => copies.get(file));
  f.audit = () => auditVendored([f.validate()], { fetcher: f.fetcher, archiveReader: f.archiveReader });
  return f;
}

test('local copies and licenses match pins; Windows checkout line endings are allowed', () => {
  const f = fixture();
  f.copies.set('docs/example.js', Buffer.from(f.script.toString().replace(/\n/g, '\r\n')));
  assert.equal(f.validate().version, '1.2.3');
  f.copies.set('docs/example.js', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f.script]));
  assert.throws(f.validate, /differs from its pinned release/);
  f.copies.set('docs/example.js', Buffer.from('changed'));
  assert.throws(f.validate, /differs from its pinned release/);
});

test('vendored audit cannot be disabled and every copy must have exactly one integrity pin', () => {
  const f = fixture();
  f.entry.coverage = 'tracked-only';
  assert.throws(f.validate, /cannot skip auditing/);
  f.entry.coverage = 'npm-vendored-audit';
  f.entry.artifacts[0].files.pop();
  assert.throws(f.validate, /All vendored files/);
  f.entry.artifacts[0].files.push('public/example.js');
  assert.throws(f.validate, /exactly once/);
});

test('source versions, SRI, archive paths and text decoding must be explicit and safe', () => {
  for (const [key, value] of [['version', 'latest'], ['version', '^1.2.3'], ['packageName', '../example'], ['integrity', 'sha1-old']]) {
    const f = fixture(); f.entry[key] = value;
    assert.throws(f.validate);
  }
  for (const member of ['../file', '/file', 'package/../file', 'package/a\\b', 'package/a:b']) {
    const f = fixture(); f.entry.artifacts[0].archivePath = member;
    assert.throws(f.validate, /Unsafe archive member/);
  }
  assert.throws(() => hashText(Buffer.from([0xff])), /encoded data/);
});

test('clean source metadata, tarball, copied members and advisory response all pass', async () => {
  const f = fixture();
  const report = await f.audit();
  assert.deepEqual(report, [{ id: 'example', version: '1.2.3', integrityVerified: true, knownVulnerabilities: 0 }]);
  assert.equal(f.calls.length, 3);
});

test('metadata cannot substitute a different release, integrity or download host', async () => {
  for (const mutate of [
    f => { f.metadata.version = '1.2.4'; },
    f => { f.metadata.name = 'other'; },
    f => { f.metadata.dist.integrity = 'changed'; },
    f => { f.metadata.dist.tarball = 'https://example.com/archive.tgz'; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.audit);
    assert.equal(f.calls.length, 1);
  }
});

test('changed tarball or extracted scripts and licenses fail integrity checks', async () => {
  const f = fixture(); f.archive = Buffer.from('changed archive');
  await assert.rejects(f.audit, /tarball integrity mismatch/);
  for (const member of ['script', 'license']) {
    const changed = fixture(); changed[member] = Buffer.from('changed');
    await assert.rejects(changed.audit, /upstream member differs/);
  }
});

test('runtime dependencies in registry metadata or package.json cannot be omitted from auditing', async () => {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) {
    for (const source of ['metadata', 'pkg']) {
      const f = fixture();
      f[source][field] = field.startsWith('bundle') ? ['new-dependency'] : { 'new-dependency': '1.0.0' };
      await assert.rejects(f.audit, /auditing/);
    }
  }
});

test('any known advisory blocks publication, including low severity', async () => {
  for (const severity of ['low', 'moderate', 'high', 'critical']) {
    const f = fixture();
    f.advisories = { example: [{ name: 'example', title: 'Test advisory', severity, vulnerable_versions: '<2.0.0' }] };
    await assert.rejects(f.audit, /known vulnerability reported/);
  }
});

test('malformed advisory payloads cannot be treated as no vulnerabilities', () => {
  for (const report of [null, [], { error: 'unavailable' }, { example: null }, { example: {} }, { example: [{}] }])
    assert.throws(() => assertAdvisories(report, 'example'));
  assert.doesNotThrow(() => assertAdvisories({}, 'example'));
  assert.doesNotThrow(() => assertAdvisories({ example: [] }, 'example'));
});

test('registry failures, bad JSON and unavailable archive tools fail closed', async () => {
  for (const response of [() => new Response('unavailable', { status: 503 }), () => new Response('not json')]) {
    const f = fixture(); f.fetcher = async () => response();
    await assert.rejects(f.audit);
  }
  const f = fixture(); f.fetcher = async () => { throw new Error('network timeout'); };
  await assert.rejects(f.audit, /network timeout/);
  const broken = fixture(); broken.archiveReader = () => { throw new Error('tar unavailable'); };
  await assert.rejects(broken.audit, /tar unavailable/);
});

test('network guard rejects foreign URLs, redirects and oversized response bodies', async () => {
  await assert.rejects(() => requestBytes('https://example.com/file', 100, {}, () => { throw new Error('must not fetch'); }), /Only the public npm registry/);
  const url = 'https://registry.npmjs.org/example';
  await assert.rejects(() => requestBytes(url, 3, {}, async () => new Response('large')), /size limit/);
  await assert.rejects(() => requestBytes(url, 3, {}, async () => new Response('x', { headers: { 'content-length': '100' } })), /size limit/);
  await assert.rejects(() => requestBytes(url, 3, {}, async () => new Response(null, { status: 302, headers: { location: 'https://example.com' } })), /HTTP 302/);
});

test('archive reader uses only named members and never unpacks or runs a script', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-vendored-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temporary, 'package'));
  const script = Buffer.from('throw new Error("Do not execute");\n');
  fs.writeFileSync(path.join(temporary, 'package/library.js'), script);
  fs.writeFileSync(path.join(temporary, 'package/LICENSE'), 'License\n');
  const archive = path.join(temporary, 'test.tgz');
  execFileSync('tar', ['-czf', archive, '-C', temporary, 'package']);
  const contents = readArchive(fs.readFileSync(archive), ['package/library.js', 'package/LICENSE']);
  assert.deepEqual(contents, [script, Buffer.from('License\n')]);
  assert.throws(() => readArchive(fs.readFileSync(archive), ['package/missing-file']));
});
