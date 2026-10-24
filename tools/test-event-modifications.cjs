const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build, layout } = require('./event-modifications.cjs');
const fixture = require('./fixtures/event-modifications-20261024.json');
const planner = require('../public/modification-planner.js');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root,file)));
const normalize = raw => ({ vehicleId:raw.i, branch:'aviation',
  tierRequirements:Object.fromEntries(raw.r.map((n,i)=>[i+1,n])),
  mods:raw.m.map(m=>({id:m[0],category:String(m[1]),tier:m[2],column:m[3],name:{zh:m[4],en:m[5]},rp:m[7],sl:m[8],requires:m[10],order:m[11]})) });

test('exact event variants rebuild from pinned fields; all previous vehicle modifications stay unchanged', () => {
  assert.equal(fixture.commit,'aa326f10c6ba7d523647572368ead2e4d51ffb4d');
  assert.deepEqual(fixture.units.map(u=>build(u).m.length),[15,17,18]);
  for(const s of fixture.sources) {
    assert.equal(s.commit,fixture.commit); assert.match(s.sha256,/^[a-f0-9]{64}$/);
    assert(s.url.includes('/'+fixture.commit+'/'));
  }
  for(const unit of fixture.units) {
    const key='germany_'+unit.type;
    for(const prefix of ['public','docs']) {
      const chunk=read(prefix+'/database/modifications/'+key+'.json');
      assert.deepEqual(chunk.v[unit.id],build(unit));
      delete chunk.v[unit.id];
      assert.equal(crypto.createHash('sha256').update(JSON.stringify(chunk.v)).digest('hex'),fixture.baselines[key]);
    }
  }
});

test('only true research prerequisites create edges, never visual predecessors or consumable requirements', () => {
  const [air,tank,boat]=fixture.units.map(build);
  assert.deepEqual(air.m.filter(m=>m[10].length).map(m=>[m[0],m[10]]),[
    ['mg17_new_gun',['mg_belt_pack']],['mgffm_new_gun',['mgff_belt_pack']],
    ['Bf-109E-3_SC250',['Bf-109E-3_4xSC50']],['Bf-109F-4_SC500',['Bf-109E-3_SC250']],
  ]);
  assert.equal(tank.m.flatMap(m=>m[10]).length,0);
  assert.equal(boat.m.flatMap(m=>m[10]).length,0);
  assert(boat.m.every(m=>m[2]>=1 && !m[0].includes('universal')));
  assert(!tank.m.some(m=>m[0]==='tank_medical_kit_expendable'));
  assert.deepEqual(air.t,[8410,9490]);
  assert.deepEqual(air.m.map(m=>m[9]),[100,80,130,120,100,80,120,130,80,120,100,130,80,100,130]);
  assert.deepEqual(air.r,[1,1,2]); assert.deepEqual(tank.r,[1,2,2]); assert.deepEqual(boat.r,[1,3,2]);
  const boatEngine=fixture.units[2].entries.find(e=>e.id==='new_ship_engine');
  assert.equal(boatEngine.cost.prevModification,'new_ship_screw');
  assert.equal(boatEngine.global.prevModification,'new_ship_rudder');
});

test('premium pre-unlocked exceptions are explicit and cannot hide missing or contradictory costs', () => {
  for(const unit of fixture.units.slice(1)) {
    const raw=build(unit);
    assert(raw.m.every(m=>m[7]===0 && m[8]===0));
    assert(raw.m.every(m=>planner.isAutomaticallyUnlocked({rp:m[7],sl:m[8]})));
    assert(raw.m.every(m=>!Object.hasOwn(unit.entries.find(e=>e.id===m[0]).cost,'reqExp')));
    assert.equal(raw.gameSource.costPolicy,'official-premium-pre-unlocked');
    const withoutPolicy=structuredClone(unit); delete withoutPolicy.premiumPolicy;
    assert.throws(()=>build(withoutPolicy),/Missing RP/);
    for(const field of ['reqExp','value','openCostGold']) {
      const conflict=structuredClone(unit); conflict.entries.find(e=>e.id===raw.m[0][0]).cost[field]=1;
      assert.throws(()=>build(conflict),/Premium .* conflict/);
    }
  }
  const air=structuredClone(fixture.units[0]); delete air.entries[0].cost.reqExp;
  assert.throws(()=>build(air),/Missing RP/);
  air.premiumPolicy=fixture.units[1].premiumPolicy;
  assert.throws(()=>build(air),/Unapproved premium/);
});

test('verified game ammunition names override misleading IDs without changing other vehicle names', () => {
  const tank=build(fixture.units[1]),boat=build(fixture.units[2]);
  assert.equal(tank.l['88mm_kwk_36_43_APCR_ammo_pack'].en,'PzGr 40/43');
  assert.equal(boat.l['30mm_mk_103_38_APCR_navy_ammo_pack'].en,'30 mm HEI-T');
  assert.equal(fixture.units[2].entries.find(e=>e.id==='30mm_mk_103_38_APCR_navy_ammo_pack').ammunition.bullets[0].type,'he_i_t');
  for(const unit of fixture.units) for(const names of Object.values(build(unit).l))
    assert.deepEqual(Object.keys(names).sort(),['de','en','es','fr','ja','ru','zh']);
  assert.equal(tank.m.find(m=>m[0]==='tank_medical_kit')[6],'tank_reinforcement_ger.png');
  assert.equal(build(fixture.units[0]).m.find(m=>m[0]==='mg_belt_pack')[6],'ammo.png');
});

test('layout is compact, stable and rejects unresolved predecessors and cycles', () => {
  const air=build(fixture.units[0]);
  assert.deepEqual(air.c.map(c=>c[2]),[2,1,2]);
  const chain=air.m.filter(m=>m[0].startsWith('Bf-109'));
  assert.equal(new Set(chain.map(m=>m[3])).size,1);
  assert.throws(()=>layout([{id:'a',category:'c',tier:1,requires:[],prev:'missing'}],['c']),/Unresolved/);
  assert.throws(()=>layout([{id:'a',category:'c',tier:1,requires:['b']},{id:'b',category:'c',tier:2,requires:['a']}],['c']),/Unresolved/);
  const bad=structuredClone(fixture.units[0]); bad.entries[0].cost.reqModification='invented';
  assert.throws(()=>build(bad),/absent/);
});

test('Bf bomb planning includes its exact dependencies and tier gates', () => {
  const data=normalize(build(fixture.units[0]));
  const result=planner.plan(data,['Bf-109F-4_SC500'],[],{},{airCombat:false});
  for(const id of ['Bf-109F-4_SC500','Bf-109E-3_SC250','Bf-109E-3_4xSC50']) assert(result.includedIds.includes(id));
  assert(result.rp>0 && result.sl>0);
  assert(result.tierCounts[1]>=1 && result.tierCounts[2]>=1 && result.tierCounts[3]>=2);
});
