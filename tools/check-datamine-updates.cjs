const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repository = 'gszabi99/War-Thunder-Datamine';
const root = path.resolve(__dirname, '..');
const api = `https://api.github.com/repos/${repository}`;
const raw = `https://raw.githubusercontent.com/${repository}`;
const validSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const validVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(value);
const scopeFiles = {
  'vehicle-costs': ['wpcost'], 'vehicle-prerequisites': ['wpcost', 'shop'],
  'rank-unlocks': ['rank'], modifications: ['wpcost'],
};

async function read(url, json = true) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'K13shot-data-review', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Public source returned HTTP ${response.status}`);
  return json ? response.json() : response.text();
}

function validateCheckpoints(checkpoints) {
  assert.equal(checkpoints.schema, 1, 'Unsupported review checkpoint schema');
  assert.deepEqual(Object.keys(checkpoints.scopes).sort(), Object.keys(scopeFiles).sort(), 'Missing review scope');
  for (const [name, checkpoint] of Object.entries(checkpoints.scopes)) {
    assert(validSha(checkpoint.gameDataCommit), 'Invalid checkpoint revision');
    assert(validVersion(checkpoint.gameVersion), 'Invalid checkpoint version');
    assert.deepEqual(checkpoint.files, scopeFiles[name].map(file => `char.vromfs.bin_u/config/${file}.blkx`));
    assert(checkpoint.provenance && checkpoint.limitations, 'Review provenance and limitations required');
  }
}

// Compare-file pagination cannot recover files beyond 300; walk small Git trees instead.
function sourceFiles(reader) {
  const responses = new Map();
  const get = async url => {
    if (!responses.has(url)) responses.set(url, await reader(url));
    return responses.get(url);
  };
  return async (commit, file) => {
    const revision = await get(`${api}/commits/${commit}`);
    assert.equal(revision.sha, commit, 'Source revision mismatch');
    let tree = revision.commit?.tree?.sha;
    assert(validSha(tree), 'Invalid root tree');
    const parts = file.split('/');
    for (let i = 0; i < parts.length; i++) {
      const listing = await get(`${api}/git/trees/${tree}`);
      assert.equal(listing.truncated, false, 'Source tree listing is incomplete');
      assert.equal(listing.sha, tree, 'Source tree mismatch');
      assert(Array.isArray(listing.tree), 'Invalid source tree');
      const entries = listing.tree.filter(entry => entry.path === parts[i]);
      assert.equal(entries.length, 1, `Missing or ambiguous critical source: ${file}`);
      const entry = entries[0];
      assert(validSha(entry.sha), 'Invalid source object');
      assert.equal(entry.type, i === parts.length - 1 ? 'blob' : 'tree', 'Unexpected source object type');
      tree = entry.sha;
    }
    return tree;
  };
}

async function checkDatamineUpdates(options = {}) {
  const directory = options.root || root;
  const reader = options.read || read;
  const checkedAt = (options.now || (() => new Date().toISOString()))();
  const output = path.join(directory, 'logs/datamine-update-check.json');
  const writeReport = report => {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  };
  try {
    const baseline = JSON.parse(fs.readFileSync(path.join(directory, 'config/data-version.json'), 'utf8'));
    const checkpoints = JSON.parse(fs.readFileSync(path.join(directory, 'config/data-review-checkpoints.json'), 'utf8'));
    validateCheckpoints(checkpoints);
    assert(validSha(baseline.gameDataCommit), 'Invalid snapshot revision');
    const head = await reader(`${api}/commits/master`);
    assert(validSha(head.sha), 'Invalid source revision');
    const version = (await reader(`${raw}/${head.sha}/version`, false)).trim();
    assert(validVersion(version), 'Invalid source version');
    const changed = head.sha !== baseline.gameDataCommit;
    const compare = changed ? await reader(`${api}/compare/${baseline.gameDataCommit}...${head.sha}`) : null;
    if (compare) {
      assert(['ahead', 'identical'].includes(compare.status), 'Upstream history diverged from snapshot');
      assert(Array.isArray(compare.files), 'Invalid comparison file list');
    }
    const files = (compare?.files || []).map(file => ({ path: file.filename, status: file.status }));
    const resolveFile = sourceFiles(reader);
    const versions = new Map([[head.sha, version]]);
    const scopes = [];
    for (const [name, checkpoint] of Object.entries(checkpoints.scopes)) {
      const pin = checkpoint.gameDataCommit;
      if (!versions.has(pin)) versions.set(pin, (await reader(`${raw}/${pin}/version`, false)).trim());
      assert.equal(versions.get(pin), checkpoint.gameVersion, 'Checkpoint version does not match pinned revision');
      const checkedFiles = [];
      for (const file of checkpoint.files) {
        const before = await resolveFile(pin, file);
        const after = await resolveFile(head.sha, file);
        checkedFiles.push({ path: file, before, after, changed: before !== after });
      }
      scopes.push({ name, checkpoint, files: checkedFiles, requiresReview: checkedFiles.some(file => file.changed) });
    }
    const report = {
      checkedAt, repository: `https://github.com/${repository}`,
      baseline: { version: baseline.gameVersion, commit: baseline.gameDataCommit, scope: baseline.scope },
      upstream: { version, commit: head.sha }, changed,
      comparisonStatus: compare?.status || 'identical',
      requiresReview: changed || scopes.some(scope => scope.requiresReview),
      fileListMayBeTruncated: files.length >= 300,
      criticalFilesComplete: true, fullFileListComplete: files.length < 300,
      relevantFiles: files.filter(file => /^(char\.vromfs\.bin_u\/config\/|aces\.vromfs\.bin_u\/|gui\.vromfs\.bin_u\/|atlases\.vromfs\.bin_u\/|images\.vromfs\.bin_u\/|lang\.vromfs\.bin_u\/)/.test(file.path)),
      scopes,
      compareUrl: `https://github.com/${repository}/compare/${baseline.gameDataCommit}...${head.sha}`,
      applied: false,
    };
    writeReport(report);
    return report;
  } catch (error) {
    // A failed/offline check must not leave a previous success looking current.
    writeReport({ checkedAt, status: 'failed', criticalFilesComplete: false, fullFileListComplete: false,
      requiresReview: true, applied: false });
    throw error;
  }
}

if (require.main === module) checkDatamineUpdates().then(report => {
  console.log(JSON.stringify({ ...report, relevantFiles: `${report.relevantFiles.length} entries in logs/datamine-update-check.json` }, null, 2));
}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { checkDatamineUpdates, validateCheckpoints };
