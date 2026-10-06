const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const planner = require("../docs/modification-planner.js");
require("./test-modification-requirements.cjs");
require("./test-air-combat-planning.cjs");
require("./test-prerequisite-audit.cjs");
require("./test-october-modifications.cjs");

const root = path.resolve(__dirname, "..");
const docsRoot = path.join(root, "docs", "database", "modifications");
const publicRoot = path.join(root, "public", "database", "modifications");
const hash = content => crypto.createHash("sha256").update(content).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));

function normalize(raw) {
  return {
    vehicleId: raw.i,
    vehicleName: { zh: raw.n[0], en: raw.n[1] },
    vehicleIcon: raw.v,
    tierRequirements: { 1: raw.r[0], 2: raw.r[1], 3: raw.r[2] },
    totals: { rp: raw.t[0], sl: raw.t[1] },
    categories: raw.c.map((category, index) => ({
      id: String(index), name: { zh: category[0], en: category[1] }, columns: category[2],
    })),
    mods: raw.m.map(mod => ({
      id: mod[0], category: String(mod[1]), tier: mod[2], column: mod[3],
      name: { zh: mod[4], en: mod[5] }, icon: mod[6], rp: mod[7], sl: mod[8],
      ge: mod[9], requires: mod[10], order: mod[11],
    })),
  };
}

const docsCatalogPath = path.join(docsRoot, "catalog.json");
const publicCatalogPath = path.join(publicRoot, "catalog.json");
assert.deepEqual(fs.readFileSync(docsCatalogPath), fs.readFileSync(publicCatalogPath), "Catalog copies differ");
const catalog = readJson(docsCatalogPath);
assert.equal(catalog.schema, 2);
assert.deepEqual(catalog.stats, { treeUnits: 3235, vehicles: 3225, modifications: 52424, chunks: 44 });
assert.equal(Object.keys(catalog.vehicles).length, catalog.stats.vehicles);
assert.equal(Object.keys(catalog.chunks).length, catalog.stats.chunks);

const vehicles = new Map();
let modificationCount = 0;
for (const [chunkKey, meta] of Object.entries(catalog.chunks)) {
  const filename = `${chunkKey}.json`;
  const docsContent = fs.readFileSync(path.join(docsRoot, filename));
  const publicContent = fs.readFileSync(path.join(publicRoot, filename));
  assert.deepEqual(docsContent, publicContent, `${chunkKey}: docs/public copies differ`);
  assert.equal(docsContent.length, meta.bytes, `${chunkKey}: byte count differs`);
  assert.equal(hash(docsContent), meta.sha256, `${chunkKey}: SHA-256 differs`);
  const chunk = JSON.parse(docsContent);
  assert.equal(chunk.s, 2, `${chunkKey}: wrong schema`);
  assert.equal(chunk.k, chunkKey, `${chunkKey}: wrong key`);
  assert.equal(Object.keys(chunk.v).length, meta.vehicles, `${chunkKey}: wrong vehicle count`);

  let chunkModificationCount = 0;
  for (const [vehicleId, raw] of Object.entries(chunk.v)) {
    assert.equal(raw.i, vehicleId, `${vehicleId}: mismatched ID`);
    assert.equal(catalog.vehicles[vehicleId], chunkKey, `${vehicleId}: wrong catalog chunk`);
    const data = normalize(raw);
    const byId = new Map(data.mods.map(mod => [mod.id, mod]));
    assert(data.mods.length > 0, `${vehicleId}: empty modification tree`);
    assert.equal(byId.size, data.mods.length, `${vehicleId}: duplicate modification ID`);
    assert(data.vehicleName.zh && data.vehicleName.en, `${vehicleId}: missing vehicle name`);
    assert(data.categories.length > 0, `${vehicleId}: missing categories`);
    assert.deepEqual(data.totals, {
      rp: data.mods.reduce((sum, mod) => sum + mod.rp, 0),
      sl: data.mods.reduce((sum, mod) => sum + mod.sl, 0),
    }, `${vehicleId}: totals differ`);
    for (const value of Object.values(data.tierRequirements)) assert(Number.isInteger(value) && value >= 0, `${vehicleId}: invalid tier requirement`);
    for (const mod of data.mods) {
      const category = data.categories[Number(mod.category)];
      assert(category, `${vehicleId}/${mod.id}: unknown category`);
      assert(Number.isInteger(mod.tier) && mod.tier >= 1 && mod.tier <= 4, `${vehicleId}/${mod.id}: invalid tier`);
      assert(Number.isInteger(mod.column) && mod.column >= 0 && mod.column < category.columns, `${vehicleId}/${mod.id}: invalid column`);
      assert(mod.name.zh && mod.name.en, `${vehicleId}/${mod.id}: missing name`);
      assert(mod.icon, `${vehicleId}/${mod.id}: missing icon`);
      assert(Number.isFinite(mod.rp) && mod.rp >= 0 && Number.isFinite(mod.sl) && mod.sl >= 0, `${vehicleId}/${mod.id}: invalid cost`);
      for (const requirement of mod.requires) {
        assert(byId.has(requirement), `${vehicleId}/${mod.id}: unknown dependency ${requirement}`);
      }
    }
    vehicles.set(vehicleId, data);
    chunkModificationCount += data.mods.length;
  }
  assert.equal(chunkModificationCount, meta.modifications, `${chunkKey}: wrong modification count`);
  modificationCount += chunkModificationCount;
}

assert.equal(vehicles.size, catalog.stats.vehicles);
assert.equal(modificationCount, catalog.stats.modifications);

for (const vehicleId of ["us_m2a4", "j_16", "ah_1g", "us_destroyer_clemson_litchfield", "us_pt6"]) {
  const data = vehicles.get(vehicleId);
  assert(data, `${vehicleId}: representative vehicle missing`);
  const highestTier = Math.max(...data.mods.map(mod => mod.tier));
  const target = [...data.mods].reverse().find(mod => mod.tier === highestTier);
  const result = planner.plan(data, [target.id], []);
  assert(result.includedIds.includes(target.id), `${vehicleId}: planner omitted target`);
  assert(result.rp >= target.rp && result.sl >= target.sl, `${vehicleId}: planner budget is too low`);
}

const j16 = vehicles.get("j_16");
const ka29 = vehicles.get("ka_29");
assert.equal(ka29.mods.length, 17);
assert.deepEqual(ka29.tierRequirements, {1: 1, 2: 2, 3: 3});
assert.deepEqual(ka29.totals, {rp: 297800, sl: 436000});
assert(!ka29.mods.some(mod => mod.id === "il_28sh_s24"));
for (const mod of ka29.mods) assert.equal(mod.rp, {1: 9800, 2: 17000, 3: 15000, 4: 48000}[mod.tier]);
assert.deepEqual(ka29.mods.find(mod => mod.id === "mi_24_su_9M114").requires, ["yak_38_b8m1"]);
const ka29All = planner.plan(ka29, ka29.mods.map(mod => mod.id), []);
assert.deepEqual([ka29All.rp, ka29All.sl], [297800, 436000]);
assert.deepEqual(planner.plan(ka29, ["mi_24_su_9M114"], []).dependencyIds, ["yak_38_b8m1"]);
const {correctKa29} = require('./update-ka29-modifications.cjs');
const ka29Raw = readJson(path.join(docsRoot, 'ussr_helicopters.json')).v.ka_29;
assert.deepEqual(correctKa29(ka29Raw), ka29Raw, 'Correction must be idempotent');
const otherVehicle = {i: 'another_vehicle', m: []};
assert.equal(correctKa29(otherVehicle), otherVehicle, 'Other vehicles must not change');
const {correctDo217, isRemovedDo217Modification} = require('./update-do217-modifications.cjs');
const do217Raw = readJson(path.join(docsRoot, 'germany_aviation.json')).v.do_217j_2;
assert.deepEqual(correctDo217(do217Raw), do217Raw, 'Do 217 correction must be idempotent');
assert.equal(correctDo217(otherVehicle), otherVehicle);
assert(!isRemovedDo217Modification('another_vehicle', 'flamm_250'));
const do217 = vehicles.get('do_217j_2');
assert.equal(do217.mods.length, 14);
assert.deepEqual(do217.totals, {rp: 5940, sl: 4480});
assert.deepEqual(do217.tierRequirements, {1: 1, 2: 2, 3: 2});
assert.equal(do217.categories.find(category => category.name.en === 'Weaponry').columns, 2);
assert(!do217.mods.some(mod => isRemovedDo217Modification('do_217j_2', mod.id)));
const do217All = planner.plan(do217, do217.mods.map(mod => mod.id), []);
assert.deepEqual([do217All.rp, do217All.sl], [5940, 4480]);
assert.deepEqual(planner.plan(do217, ['mg131_turret_new_gun'], []).dependencyIds, ['mg131_turret_belt_pack']);
const {correctCa27, vehicleIds: ca27Ids} = require('./update-ca27-modifications.cjs');
assert.equal(correctCa27(otherVehicle), otherVehicle);
for (const id of ca27Ids) {
  const raw = readJson(path.join(root, 'docs', catalog.chunks[catalog.vehicles[id]].path)).v[id];
  assert.deepEqual(correctCa27(raw), raw, 'CA-27 correction must be idempotent');
  const old = structuredClone(raw);
  const oldRack = old.m.find(mod => mod[0] === 'gloster_lbc');
  oldRack[0] = 'frc_mk2';
  oldRack[8] = 14000;
  assert.deepEqual(correctCa27(old), raw);
  const previousCorrection = structuredClone(raw);
  previousCorrection.m.find(mod => mod[0] === 'gloster_lbc')[8] = 9000;
  previousCorrection.t[1] = 221000;
  assert.deepEqual(correctCa27(previousCorrection), raw, 'Update prior 9000 SL correction without changing other data');
  const data = vehicles.get(id);
  assert.equal(data.mods.length, 14);
  assert.deepEqual(data.totals, {rp: 145800, sl: 226000});
  assert.deepEqual(data.tierRequirements, {1: 1, 2: 1, 3: 2});
  const rack = data.mods.find(mod => mod.id === 'gloster_lbc');
  assert.equal(rack.name.en, 'GLBC mk.3');
  assert.equal(rack.icon, 'pilon_bomb.png');
  assert.deepEqual([rack.rp, rack.sl], [9000, 14000]);
  assert(!data.mods.some(mod => mod.id === 'frc_mk2'));
  assert.deepEqual(planner.plan(data, ['gloster_lbc'], []).dependencyIds, ['fmbc_mk2']);
  const all = planner.plan(data, data.mods.map(mod => mod.id), []);
  assert.deepEqual([all.rp, all.sl], [145800, 226000]);
}
assert.equal(j16.mods.length, 25);
assert.deepEqual(j16.tierRequirements, { 1: 1, 2: 3, 3: 3 });
assert.deepEqual(j16.totals, { rp: 315000, sl: 482000 });
const pl12a = planner.plan(j16, ["cn_pl12a"], []);
assert.deepEqual({ rp: pl12a.rp, sl: pl12a.sl }, { rp: 101000, sl: 154000 });
assert.deepEqual(pl12a.dependencyIds, ['cn_pl12', 'cn_pl8b']);
assert(!pl12a.includedIds.includes('new_compressor_jet'), 'Boosters have no compressor prerequisite');

for (const file of ["modification-planner.js", "modifications.js", "modifications.css"]) {
  assert.deepEqual(fs.readFileSync(path.join(root, "public", file)), fs.readFileSync(path.join(root, "docs", file)), `${file}: copies differ`);
}
assert(planner.isAutomaticallyUnlocked({ rp: 0, sl: 0 }));
for (const mod of [{ rp: null, sl: 0 }, { rp: 0 }, { rp: "0", sl: 0 }, { rp: 0, sl: 50 }, { rp: 50, sl: 0 }]) {
  assert(!planner.isAutomaticallyUnlocked(mod), "Only explicit zero RP and SL are unlocked");
}

const wolfpack = vehicles.get("us_m1128_wolfpack");
assert(wolfpack.mods.every(planner.isAutomaticallyUnlocked));
const unlockedPlan = planner.plan(wolfpack, wolfpack.mods.map(mod => mod.id), []);
assert.equal(unlockedPlan.researchedIds.length, wolfpack.mods.length);
assert.deepEqual(unlockedPlan.selectedIds, []);
assert.deepEqual(unlockedPlan.includedIds, []);
assert.deepEqual(unlockedPlan.dependencyIds, []);
assert.deepEqual(unlockedPlan.fillerIds, []);
assert.equal(unlockedPlan.rp + unlockedPlan.sl, 0);
for (let tier = 1; tier <= 4; tier++) {
  assert.equal(unlockedPlan.tierCounts[tier], wolfpack.mods.filter(mod => mod.tier === tier).length);
}

const mixed = {
  tierRequirements: { 1: 2, 2: 0, 3: 0 },
  mods: [
    { id: "free", tier: 1, rp: 0, sl: 0, order: 0 },
    { id: "filler", tier: 1, rp: 100, sl: 20, order: 1 },
    { id: "expensive", tier: 1, rp: 500, sl: 100, order: 2 },
    { id: "target", tier: 2, rp: 200, sl: 40, requires: ["free"], order: 3 },
    { id: "freeHigh", tier: 4, rp: 0, sl: 0, order: 4 },
  ],
};
const mixedPlan = planner.plan(mixed, ["free", "target", "freeHigh"], ["freeHigh"]);
assert.deepEqual(mixedPlan.selectedIds, ["target"]);
assert.deepEqual(mixedPlan.includedIds, ["filler", "target"]);
assert.deepEqual(mixedPlan.dependencyIds, []);
assert.deepEqual(mixedPlan.fillerIds, ["filler"]);
assert.deepEqual(mixedPlan.tierCounts, { 1: 2, 2: 1, 3: 0, 4: 1 });
assert.deepEqual([mixedPlan.rp, mixedPlan.sl], [300, 60]);
const ownedMixed = planner.plan(mixed, ["target"], ["filler"]);
assert.deepEqual(ownedMixed.includedIds, ["target"]);
assert.deepEqual([ownedMixed.rp, ownedMixed.sl], [200, 40]);

const audit = readJson(path.join(root, "tools", "modifications-audit.json"));
assert.equal(catalog.stats.vehicles + audit.withoutTables, catalog.stats.treeUnits);
assert.deepEqual({
  missingWiki: audit.missingWiki,
  withoutTables: audit.withoutTables,
  missingGameConfig: audit.missingGameConfig,
  missingGameMods: audit.missingGameMods,
}, { missingWiki: 0, withoutTables: 10, missingGameConfig: 0, missingGameMods: 0 });
assert(audit.samples.withoutTables.every(id => !catalog.vehicles[id]), "No-table components must not expose a modification button");

console.log(JSON.stringify({
  version: catalog.version,
  vehicles: vehicles.size,
  modifications: modificationCount,
  chunks: catalog.stats.chunks,
  withoutTables: audit.withoutTables,
  wikiFallbackMods: audit.missingGameMods,
  pass: true,
}));
