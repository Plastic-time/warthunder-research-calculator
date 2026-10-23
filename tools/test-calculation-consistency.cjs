const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const { test } = require('node:test');
const app = require('../main');
const progress = require('../public/research-progress.js');
const root = path.resolve(__dirname, '..');

function browserCalculator(folder) {
  const context = vm.createContext({
    document: { documentElement: {}, getElementById: () => ({}), addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => [] },
    window: { matchMedia: () => ({ matches: false }), ResearchProgress: progress },
    localStorage: { getItem: () => null, setItem() {} }, CustomEvent: class {}, console,
  });
  for (const file of ['i18n.js', 'app-translations.js', 'static-translations.js', 'module-translations.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, folder, file), 'utf8'), context);
  }
  const code = fs.readFileSync(path.join(root, folder, 'app.js'), 'utf8').replace(/\binit\(\);\s*$/, '');
  vm.runInContext(code + '\nrenderTree=()=>{};renderSummary=()=>{};globalThis.calc={state,flattenTree,calculatePlan,isInitialUnlockedUnit,remainingUnitRp,formatCost};', context);
  return context.calc;
}

test('both browser calculators distinguish unknown costs from free initial vehicles', () => {
  for (const folder of ['public', 'docs']) {
    const calc = browserCalculator(folder);
    const unit = { section: 'researchable', rank: 'I', class_name: '', rp: 0, sp: 0 };
    assert.equal(calc.isInitialUnlockedUnit(unit), true, folder);
    for (const unknown of [null, undefined]) for (const field of ['rp', 'sp']) {
      assert.equal(calc.isInitialUnlockedUnit({ ...unit, [field]: unknown }), false, `${folder}/${field}`);
      assert.equal(calc.formatCost(unknown), '\u672a\u63d0\u4f9b');
    }
    assert.equal(calc.formatCost(0), '0');
    for (const class_name of ['prem', 'premium', 'squad', 'event', 'gift']) {
      assert.equal(calc.isInitialUnlockedUnit({ ...unit, class_name }), false);
    }
    assert.equal(calc.isInitialUnlockedUnit({ ...unit, rp: 100 }), false);
  }
});

test('calculation API and both browser versions agree without database writes', async t => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const calculate = async (country, type, body) => {
    const response = await fetch(`${base}/api/calculate/${country}/${type}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const stuart = 'us_m3_stuart';

  await t.test('remaining RP is clamped, full cost retained, SL and ownership unchanged', async () => {
    for (const [invested, expected] of [[0, 2900], [1000, 1900], [2900, 0], [9000, 0]]) {
      const { status, data } = await calculate('usa', 'ground', {
        plannedIds: [stuart, stuart], targetId: stuart, progressRp: { [stuart]: invested },
      });
      assert.equal(status, 200);
      assert.equal(data.total_rp, expected);
      assert.equal(data.raw_total_rp, 2900);
      assert.equal(data.total_sp, 700);
      assert.equal(data.missing.length, 1, 'Completed RP does not mean purchased');
      assert.equal(data.missing[0].rp, 2900, 'Never rewrite original unit prices');
      assert.equal(data.unknown_rp_count, 0);
      assert.equal(data.unknown_sp_count, 0);
    }
    const owned = await calculate('usa', 'ground', { plannedIds: [stuart], ownedIds: [stuart], progressRp: { [stuart]: 1000 } });
    assert.equal(owned.data.total_rp, 0);
    assert.equal(owned.data.total_sp, 0);
    assert.deepEqual(owned.data.missing, []);
    const initial = await calculate('usa', 'ground', { plannedIds: ['us_m2a4'] });
    assert.deepEqual(initial.data.missing, []);
    const legacy = await calculate('usa', 'ground', { targetId: stuart });
    assert.equal(legacy.data.total_rp, 2900);
    assert.equal(legacy.data.total_sp, 700);
  });

  await t.test('unknown prices stay in the plan and are explicitly counted', async () => {
    const id = 'germ_garford_putilov';
    const { status, data } = await calculate('germany', 'ground', { plannedIds: [id], progressRp: { [id]: 1000 } });
    assert.equal(status, 200);
    assert.equal(data.missing.length, 1);
    assert.equal(data.missing[0].rp, null);
    assert.equal(data.missing[0].sp, null);
    assert.equal(data.total_rp, 0, 'Only known costs contribute to the numeric subtotal');
    assert.equal(data.total_sp, 0);
    assert.equal(data.unknown_rp_count, 1);
    assert.equal(data.unknown_sp_count, 1);
  });

  await t.test('prerequisite inclusion is unchanged and progress also applies to prerequisites', async () => {
    const request = { targetId: 'us_m18_hellcat', dependencyMode: 'dependencies' };
    const before = (await calculate('usa', 'ground', request)).data;
    assert(before.missing.length > 1);
    const prerequisite = before.missing.find(unit => unit.data_unit_id !== request.targetId && unit.rp > 0);
    assert(prerequisite);
    const after = (await calculate('usa', 'ground', { ...request, progressRp: { [prerequisite.data_unit_id]: prerequisite.rp } })).data;
    assert.deepEqual(after.missing, before.missing);
    assert.equal(after.total_rp, before.total_rp - prerequisite.rp);
    assert.equal(after.raw_total_rp, before.raw_total_rp);
    assert.equal(after.total_sp, before.total_sp);
  });

  await t.test('malformed inputs return safe 400 responses, not server errors or partial success', async () => {
    const invalid = [null, [], { targetId: 42 }, { targetId: '' }, { plannedIds: {} }, { plannedIds: 'us_m3_stuart' },
      { ownedIds: null }, { ownedIds: [false] }, { plannedIds: ['../invalid'] },
      { plannedIds: Array(10001).fill(stuart) }, { plannedIds: ['x'.repeat(161)] },
      { progressRp: [] }, { progressRp: null }, { progressRp: { [stuart]: -1 } },
      { progressRp: { [stuart]: 0.5 } }, { progressRp: { [stuart]: '1000' } },
      { progressRp: { [stuart]: Number.MAX_SAFE_INTEGER + 1 } },
      { progressRp: JSON.parse('{"__proto__":1000}') },
      { progressRp: Object.fromEntries(Array.from({ length: 10001 }, (_, i) => ['id_' + i, 1])) },
      { dependencyMode: 'invalid' }, { folderMode: 'invalid' }];
    for (const body of invalid) {
      const { status, data } = await calculate('usa', 'ground', body);
      assert.equal(status, 400, 'Invalid request must not be treated as a plan');
      assert.deepEqual(data, { success: false, error: 'Invalid request' });
    }
    const empty = await calculate('usa', 'ground', {});
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.data.missing, []);
    assert.equal(empty.data.total_rp, 0);
  });

  await t.test('all 50 trees match across both browser calculators and HTTP API', async () => {
    const calculators = ['public', 'docs'].map(folder => [folder, browserCalculator(folder)]);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/database/manifest.json'), 'utf8'));
    let unitsChecked = 0;
    for (const entry of manifest.files) {
      const relative = entry.path.split('/');
      const country = relative[1];
      const type = path.basename(entry.path, '.json').slice(country.length + 1);
      const original = fs.readFileSync(path.join(root, entry.path));
      const webOriginal = fs.readFileSync(path.join(root, 'docs', entry.path));
      const treeResponse = await fetch(`${base}/api/tree/${country}/${type}`);
      assert.equal(treeResponse.status, 200);
      const localTree = (await treeResponse.json()).data;
      calculators[0][1].flattenTree(localTree);
      const units = calculators[0][1].state.units;
      const plannedIds = Array.from(units, unit => unit.data_unit_id);
      const ownedIds = plannedIds.filter((id, index) => index % 11 === 0);
      const progressRp = Object.fromEntries(Array.from(units).filter(unit => unit.rp > 0).map(unit => [unit.data_unit_id, Math.floor(unit.rp / 2)]));
      const result = await calculate(country, type, { plannedIds, ownedIds, progressRp });
      assert.equal(result.status, 200);
      for (const [folder, calc] of calculators) {
        calc.flattenTree(folder === 'public' ? localTree : JSON.parse(webOriginal));
        calc.state.planned = new Set(plannedIds);
        calc.state.owned = new Set(ownedIds);
        calc.state.waypoints = new Set();
        calc.state.progressRp = progressRp;
        calc.state.planResult = null;
        calc.calculatePlan();
        const missing = Array.from(calc.state.missing);
        const label = `${folder}/${country}/${type}`;
        assert.deepEqual(result.data.missing.map(unit => unit.data_unit_id).sort(), missing.map(unit => unit.data_unit_id).sort(), label);
        assert.equal(result.data.total_rp, missing.reduce((sum, unit) => sum + (calc.remainingUnitRp(unit) || 0), 0), label);
        assert.equal(result.data.raw_total_rp, missing.reduce((sum, unit) => sum + (unit.rp || 0), 0), label);
        assert.equal(result.data.total_sp, missing.reduce((sum, unit) => sum + (unit.sp || 0), 0), label);
        assert.equal(result.data.unknown_rp_count, missing.filter(unit => unit.rp == null).length, label);
        assert.equal(result.data.unknown_sp_count, missing.filter(unit => unit.sp == null).length, label);
      }
      assert(original.equals(fs.readFileSync(path.join(root, entry.path))), 'Backend data must remain untouched');
      assert(webOriginal.equals(fs.readFileSync(path.join(root, 'docs', entry.path))), 'Static data must remain untouched');
      unitsChecked += units.length;
    }
    assert.equal(manifest.files.length, 50);
    assert.equal(unitsChecked, manifest.unit_count);
    console.log(JSON.stringify({ trees: manifest.files.length, units: unitsChecked, browserCopies: 2, apiParity: true }));
  });
});
