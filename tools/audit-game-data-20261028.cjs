const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { changes } = require('./audit-reviewed-data-delta.cjs');
const fixture = require('./fixtures/game-data-review-2.59.0.92.json');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function verifyReview(data, rosterIds, modificationIds, evidence = fixture) {
  const costs = changes(data['baseline-wpcost'], data['current-wpcost']);
  assert.equal(costs.length, evidence.wpcostChanges, 'Unreviewed cost delta');
  assert.equal(hash(JSON.stringify(costs)), evidence.wpcostDeltaSha256, 'Unreviewed cost or modification changes');
  assert.equal(hash(JSON.stringify(changes(data['baseline-shop'], data['current-shop']))),
    evidence.shopDeltaSha256, 'Unreviewed shop changes');
  assert.deepEqual(changes(data['baseline-rank'], data['current-rank']), evidence.rankChanges, 'Unreviewed rank changes');
  for (const row of costs) {
    const id = row.path.split('/')[1].toLowerCase();
    assert(!rosterIds.has(id) && !modificationIds.has(id), 'Changed entry is now in the supported snapshot: ' + id);
  }
  return { gameVersion: evidence.upstream.version, commit: evidence.upstream.commit,
    costChangesReviewed: costs.length, supportedChanges: 0, applied: false };
}

function audit(directory) {
  const data = {};
  for (const source of fixture.sources) {
    const name = source.label + '-' + path.basename(source.file, '.blkx');
    const bytes = fs.readFileSync(path.join(directory, name + '.json'));
    assert.equal(bytes.length, source.bytes, 'Source length: ' + name);
    assert.equal(hash(bytes), source.sha256, 'Source checksum: ' + name);
    if (source.gitBlob) assert.equal(crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), source.gitBlob);
    data[name] = JSON.parse(bytes);
  }
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'docs/roster-audit.json')));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/database/modifications/catalog.json')));
  return verifyReview(data, new Set(Object.values(roster.trees).flatMap(tree => Object.keys(tree.units))), new Set(Object.keys(catalog.vehicles)));
}

if (require.main === module) {
  try {
    assert(process.argv[2], 'Pass the directory containing the six pinned source files');
    console.log(JSON.stringify(audit(path.resolve(process.argv[2])), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyReview, audit };
