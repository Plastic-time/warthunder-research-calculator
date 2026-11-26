const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildVehicleUpdates } = require('./build-vehicle-updates.cjs');

const root = path.resolve(__dirname, '..');
const release = JSON.parse(fs.readFileSync(path.join(root, 'config/vehicle-release.json'), 'utf8'));
const marked = Object.values(release.trees).flat();
const aircraft = require('../config/eagles-shadow-aircraft.json').units;
const additions = require('../docs/database/manifest.json').rosterUpdate.ids;
const earlierRewards = new Set(['ussr_bt_7_m_816', 'sw_patria_bmp_3', 'fw_190a_8_mistel']);
assert.deepEqual([...marked].sort(), [...aircraft.map(unit => unit.id), ...additions.filter(id => !earlierRewards.has(id))].sort());
const readData = file => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return JSON.parse(JSON.stringify(context.window.WTVehicleUpdates));
};
const live = readData(path.join(root, 'public/vehicle-updates-data.js'));
assert.deepEqual(live, readData(path.join(root, 'docs/vehicle-updates-data.js')));
assert.equal(live.basis, 'game-major-update');
assert.equal(live.status, 'reviewed');
assert.deepEqual(Object.values(live.trees).flat().sort(), [...marked].sort());

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-release-test-'));
const write = (file, data) => {
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data));
};
try {
  fs.mkdirSync(path.join(temp, 'public'));
  write('config/vehicle-release.json', { ...release, major: '2.59', date: '2026-09-16',
    trees: { 'usa/aviation': ['f_102a_late', 'f_14d_vf_11'] } });
  write('config/data-version.json', { gameVersion: '2.59.0.27' });
  write('docs/database/manifest.json', { verified_at: '2099-01-01', files: [
    { path: 'database/usa/usa_aviation.json', added: ['b_52h', 'f_16xl'] },
  ] });
  write('docs/database/usa/usa_aviation.json', [{ researchable_vehicles: [[
    { data_unit_id: 'b_52h' }, { data_unit_id: 'f_16xl' },
    { items: [{ data_unit_id: 'f_102a_late' }, { data_unit_id: 'f_14d_vf_11' }] },
  ]] }]);
  const first = buildVehicleUpdates(temp);
  assert.deepEqual(first.trees['usa/aviation'], ['f_102a_late', 'f_14d_vf_11']);
  assert.equal(first.date, '2026-09-16');
  const output = fs.readFileSync(path.join(temp, 'public/vehicle-updates-data.js'), 'utf8');
  buildVehicleUpdates(temp);
  assert.equal(fs.readFileSync(path.join(temp, 'public/vehicle-updates-data.js'), 'utf8'), output);
  write('config/data-version.json', { gameVersion: '2.59.0.17', latestReview: { gameVersion: '2.61.0.9' } });
  const partial = buildVehicleUpdates(temp);
  assert.equal(partial.status, 'needs-review');
  assert.deepEqual(partial.trees['usa/aviation'], []);
  write('config/data-version.json', { gameVersion: '2.61.0.1', latestReview: { gameVersion: '2.59.0.88' } });
  const future = buildVehicleUpdates(temp);
  assert.equal(future.status, 'needs-review');
  assert.deepEqual(future.trees['usa/aviation'], []);
  console.log(JSON.stringify({ reviewed: marked.length, snapshotAdditionsIgnored: true, futureMajorClearsBadges: true, deterministic: true }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
