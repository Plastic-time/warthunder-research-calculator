const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const registry = 'https://registry.npmjs.org';
const maxArtifactBytes = 1024 * 1024;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonicalText = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).replace(/\r\n/g, '\n');
const hashText = bytes => crypto.createHash('sha256').update(canonicalText(bytes)).digest('hex');

function validateVendored(entry, readFile) {
  assert.equal(entry.coverage, 'npm-vendored-audit', `${entry.id}: vendored packages cannot skip auditing`);
  assert(typeof entry.packageName === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(entry.packageName), 'Expected an unscoped npm package name');
  assert(typeof entry.version === 'string' && /^\d+\.\d+\.\d+$/.test(entry.version), 'Pin an exact vendored release version');
  assert(typeof entry.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity), 'Pin the npm tarball SHA-512 integrity');
  assert(Array.isArray(entry.artifacts) && entry.artifacts.length, 'Vendored artifacts are required');
  const covered = [], archivePaths = new Set();
  for (const artifact of entry.artifacts) {
    assert(typeof artifact.archivePath === 'string' && artifact.archivePath.startsWith('package/')
      && !/[\\:\0]/.test(artifact.archivePath)
      && artifact.archivePath.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe archive member path');
    assert(!archivePaths.has(artifact.archivePath), 'Duplicate archive member');
    archivePaths.add(artifact.archivePath);
    assert(/^[a-f0-9]{64}$/.test(artifact.sha256Lf), 'Expected a canonical-text SHA-256');
    assert(Array.isArray(artifact.files) && artifact.files.length, 'Artifact copies are required');
    for (const file of artifact.files) {
      assert(entry.files.includes(file) && !covered.includes(file), 'Artifact copies must cover registered files exactly once');
      covered.push(file);
      const bytes = readFile(file);
      assert(bytes.length <= maxArtifactBytes, `${file}: oversized vendored artifact`);
      assert.equal(hashText(bytes), artifact.sha256Lf, `${file}: vendored file differs from its pinned release`);
    }
  }
  assert.deepEqual([...covered].sort(), [...entry.files].sort(), 'All vendored files need integrity coverage');
  return { id: entry.id, packageName: entry.packageName, version: entry.version, integrity: entry.integrity, artifacts: entry.artifacts };
}

async function requestBytes(url, limit, options = {}, fetcher = fetch) {
  const target = new URL(url);
  assert(target.origin === registry && !target.username && !target.password && !target.hash, 'Only the public npm registry is allowed');
  const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert(response.ok && !response.redirected, `Registry request failed: HTTP ${response.status}`);
  assert(response.body, 'Registry response has no body');
  const length = response.headers.get('content-length');
  if (length !== null) assert(/^\d+$/.test(length) && Number(length) <= limit, 'Registry response exceeds size limit');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert(size <= limit, 'Registry response exceeds size limit');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function assertMetadata(metadata, entry, tarballUrl) {
  assert(plainObject(metadata), 'Invalid npm version metadata');
  assert.equal(metadata.name, entry.packageName, 'Registry package name mismatch');
  assert.equal(metadata.version, entry.version, 'Registry package version mismatch');
  assert.equal(metadata.dist?.integrity, entry.integrity, 'Registry integrity changed; review the pinned release');
  assert.equal(metadata.dist?.tarball, tarballUrl, 'Unexpected npm tarball URL');
  // Bundled browser code cannot silently omit newly introduced runtime dependencies.
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (metadata[field] !== undefined)
      assert(plainObject(metadata[field]) && Object.keys(metadata[field]).length === 0, `${field}: extend vendored dependency auditing before upgrading`);
  }
  for (const field of ['bundledDependencies', 'bundleDependencies']) {
    if (metadata[field] !== undefined)
      assert(Array.isArray(metadata[field]) && metadata[field].length === 0, `${field}: bundled dependencies need separate auditing`);
  }
}

function assertAdvisories(report, name) {
  assert(plainObject(report), 'Invalid advisory response');
  for (const [key, advisories] of Object.entries(report)) {
    assert.equal(key, name, 'Unexpected advisory package');
    assert(Array.isArray(advisories), 'Invalid advisory list');
    for (const advisory of advisories) {
      assert(plainObject(advisory) && advisory.name === name && typeof advisory.title === 'string'
        && ['info', 'low', 'moderate', 'high', 'critical'].includes(advisory.severity)
        && typeof advisory.vulnerable_versions === 'string', 'Invalid advisory entry');
    }
    assert.equal(advisories.length, 0, `${name}: known vulnerability reported; review the npm advisory before publishing`);
  }
}

function readArchive(archiveBytes, members) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-vendored-audit-'));
  try {
    const archive = path.join(temporary, 'release.tgz');
    fs.writeFileSync(archive, archiveBytes);
    // Read only named members to stdout; never unpack or execute package files.
    return members.map(member => execFileSync('tar', ['-xOzf', archive, '--', member],
      { maxBuffer: maxArtifactBytes, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function auditVendored(entries, { fetcher = fetch, archiveReader = readArchive } = {}) {
  const results = [];
  for (const entry of entries) {
    const metadataUrl = `${registry}/${entry.packageName}/${entry.version}`;
    const tarballUrl = `${registry}/${entry.packageName}/-/${entry.packageName}-${entry.version}.tgz`;
    const metadata = JSON.parse((await requestBytes(metadataUrl, maxArtifactBytes, {}, fetcher)).toString('utf8'));
    assertMetadata(metadata, entry, tarballUrl);
    const archive = await requestBytes(tarballUrl, 4 * maxArtifactBytes, {}, fetcher);
    assert.equal('sha512-' + crypto.createHash('sha512').update(archive).digest('base64'), entry.integrity, 'Downloaded npm tarball integrity mismatch');
    const members = ['package/package.json', ...entry.artifacts.map(artifact => artifact.archivePath)];
    const contents = archiveReader(archive, members);
    assert.equal(contents.length, members.length, 'Incomplete archive extraction');
    const pkg = JSON.parse(canonicalText(contents[0]));
    assertMetadata({ ...pkg, dist: metadata.dist }, entry, tarballUrl);
    entry.artifacts.forEach((artifact, index) => {
      assert(contents[index + 1].length <= maxArtifactBytes, 'Oversized upstream artifact');
      assert.equal(hashText(contents[index + 1]), artifact.sha256Lf, `${entry.id}: upstream member differs from the pinned local artifact`);
    });
    const advisoryBytes = await requestBytes(`${registry}/-/npm/v1/security/advisories/bulk`, maxArtifactBytes, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [entry.packageName]: [entry.version] }),
    }, fetcher);
    assertAdvisories(JSON.parse(advisoryBytes.toString('utf8')), entry.packageName);
    results.push({ id: entry.id, version: entry.version, integrityVerified: true, knownVulnerabilities: 0 });
  }
  console.log(JSON.stringify({ vendoredAuditPassed: true, checkedAt: new Date().toISOString(), results }));
  return results;
}

module.exports = { validateVendored, hashText, requestBytes, assertMetadata, assertAdvisories, readArchive, auditVendored };
