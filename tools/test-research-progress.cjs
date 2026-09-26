const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const progress = require('../public/research-progress.js');
const planner = require('../public/planner.js');
const mods = require('../public/modification-planner.js');
for (const file of ['research-progress.js', 'planner.js', 'modification-planner.js']) {
  assert.equal(fs.readFileSync('public/' + file, 'utf8'), fs.readFileSync('docs/' + file, 'utf8'));
}

test('remaining cost validation keeps unknown prices unknown and never goes negative', () => {
  assert.equal(progress.remaining(140000, 80000), 60000);
  assert.equal(progress.remaining(140000, 200000), 0);
  assert.equal(progress.remaining(null, 80000), null);
  for (const invalid of [-1, NaN, Infinity, '80000', 0.5, {}, undefined]) {
    assert.equal(progress.remaining(140000, invalid), 140000);
  }
  assert.equal(progress.remaining(0, 80000), 0);
  const clean = progress.cleanMap(JSON.parse('{"ok":42,"bad":-2,"text":"4","__proto__":50}'));
  assert.equal(clean.ok, 42);
  assert.equal(clean.bad, undefined);
  assert.equal(clean.text, undefined);
  assert.equal(Object.getPrototypeOf(clean), null);
});

function unit(id, rank, rp, required = '') {
  return { data_unit_id: id, rank, rp, sp: 100, section: 'researchable', required_unit_id: required, columnIndex: 0, rowIndex: 0 };
}
test('vehicle filler optimization uses remaining RP without changing ownership or SL', () => {
  const units = [unit('cheap', 'I', 100), unit('invested', 'I', 200), unit('goal', 'II', 140000)];
  const input = { units, ranks: [{ rank: 'I', unlockQuantity: 1 }, { rank: 'II', unlockQuantity: 0 }], targetIds: ['goal'] };
  const normal = planner.plan(input);
  assert(normal.selectedIds.includes('cheap'));
  const result = planner.plan({ ...input, progressRp: { invested: 190, goal: 80000 } });
  assert(result.selectedIds.includes('invested'));
  assert(!result.selectedIds.includes('cheap'));
  assert.equal(result.totalRp, 60010);
  assert.equal(result.totalSp, normal.totalSp);
  assert.equal(units[2].rp, 140000);
  assert.equal(planner.plan({ ...input, progressRp: { goal: 9999999 } }).totalRp, 100);
});

test('fully invested prerequisite stays in route and is not reclassified as initially unlocked', () => {
  const result = planner.plan({
    units: [unit('base', 'II', 100), unit('goal', 'III', 100, 'base')],
    ranks: [{ rank: 'II', unlockQuantity: 0 }, { rank: 'III', unlockQuantity: 0 }],
    targetIds: ['goal'], progressRp: { base: 100 },
  });
  assert(result.selectedIds.includes('base'));
  assert.equal(result.totalRp, 100);
  assert.equal(result.totalSp, 200);
  const first = unit('first', 'I', 100);
  first.sp = 0;
  assert(planner.plan({ units: [first], targetIds: ['first'], progressRp: { first: 100 } }).selectedIds.includes('first'));
});

test('modification fillers and dependencies use remaining RP while unlock rules stay unchanged', () => {
  const mod = (id, tier, rp, order, requires = []) => ({ id, tier, rp, sl: 50, order, requires });
  const data = { tierRequirements: { 1: 1 }, mods: [mod('cheap', 1, 100, 0), mod('invested', 1, 200, 1), mod('goal', 2, 1000, 2)] };
  assert(mods.plan(data, ['goal'], []).fillerIds.includes('cheap'));
  const result = mods.plan(data, ['goal'], [], { invested: 190, goal: 400 });
  assert(result.fillerIds.includes('invested'));
  assert.equal(result.rp, 610);
  assert.equal(result.sl, 100);
  assert.deepEqual(result.researchedIds, []);
  assert.equal(mods.plan(data, ['goal'], [], { invested: 200, goal: 1000 }).rp, 0);
  assert.equal(mods.isAutomaticallyUnlocked(data.mods[0]), false);
});
