const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { shopUnits } = require('./audit-datamine-roster.cjs');
const fixture = require('./fixtures/game-data-review-2.59.0.86.json');

function changes(before, after, location = '', result = []) {
  if (JSON.stringify(before) === JSON.stringify(after)) return result;
  if (before && after && typeof before === 'object' && typeof after === 'object' &&
      !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      changes(before[key], after[key], location + '/' + key, result);
    }
  } else result.push({ path: location, before: before ?? null, after: after ?? null });
  return result;
}

function verifyDelta(data) {
  const costs = changes(data['baseline-wpcost'], data['current-wpcost']);
  const newIds = new Set(fixture.deferredRosterEntries.map(entry => entry.id));
  assert.deepEqual(costs.filter(row => !newIds.has(row.path.slice(1))), fixture.costChanges,
    'Unreviewed changes to existing vehicle costs or modifications');
  const additions = costs.filter(row => newIds.has(row.path.slice(1)));
  assert.equal(additions.length, newIds.size);
  for (const expected of fixture.deferredRosterEntries) {
    const row = additions.find(row => row.path === '/' + expected.id);
    assert.equal(row.before, null, 'Expected a new entry, not an existing vehicle change');
    for (const [key, value] of Object.entries(expected)) if (key !== 'id') assert.equal(row.after[key], value);
  }
  assert.deepEqual(data['baseline-rank'], data['current-rank'], 'Unreviewed rank changes');
  const oldShop = shopUnits(data['baseline-shop']), newShop = shopUnits(data['current-shop']);
  assert.equal(newShop.size, oldShop.size + newIds.size);
  for (const [id, unit] of oldShop) assert.deepEqual(newShop.get(id), unit, 'Existing shop entry: ' + id);
  for (const id of newShop.keys()) assert(oldShop.has(id) || newIds.has(id), 'Unreviewed shop addition');
  return { version: fixture.upstream.version, commit: fixture.upstream.commit,
    existingCostChanges: fixture.costChanges.length, deferredRosterEntries: [...newIds], applied: false };
}

function audit(directory) {
  const data = {};
  for (const source of fixture.sources) {
    const name = source.label + '-' + path.basename(source.file, '.blkx');
    const bytes = fs.readFileSync(path.join(directory, name + '.json'));
    assert.equal(bytes.length, source.bytes, 'Source length: ' + name);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.sha256, 'Source checksum: ' + name);
    data[name] = JSON.parse(bytes);
  }
  return verifyDelta(data);
}

if (require.main === module) {
  try {
    assert(process.argv[2], 'Pass the directory containing the six pinned source files');
    console.log(JSON.stringify(audit(path.resolve(process.argv[2])), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { changes, verifyDelta, audit };
