const assert = require('node:assert/strict');
const { test } = require('node:test');
const { create, normalize, parse, MAX_BYTES } = require('../public/plan-storage');
const tree = 'wt-research:usa:ground';
const mods = 'wt-research:modifications:us_m18_hellcat';
const other = 'wt-research:germany:aviation';
const value = { planned:['us_m18_hellcat'], owned:['us_m2a4'], waypoints:['us_m4a1_1942'],
  progressRp:{us_m18_hellcat:1234}, avoidFolded:true, dependencyMode:'selected',
  route:{selectedIds:['us_m18_hellcat','us_m4a1_1942'],fillerIds:['us_m4a1_1942'],removedAutoRoles:{us_m4a2_1944:'filler'}} };
const modValue = {selected:['engine'],researched:['tracks'],progressRp:{engine:321},airCombat:false};
function memory(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {get length(){return map.size;},key:index=>[...map.keys()][index],getItem:key=>map.get(key)??null,
    setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),map};
}
function fixture() { return memory({[tree]:JSON.stringify(value),[mods]:JSON.stringify(modValue),
  'wt-research:language':'en','private-setting':'not-part-of-plans'}); }
const wrap = records => JSON.stringify({format:'war-thunder-research-plans',version:1,createdAt:'2026-10-10T12:00:00.000Z',records});
test('export retains plans, invested RP, routes, and modification settings only', () => {
  const api=create(()=>fixture());
  const data=api.capture();
  assert.equal(data.records.length,2);
  assert.deepEqual(data.records.find(r=>r.key===tree).value,normalize(tree,value));
  assert.deepEqual(data.records.find(r=>r.key===mods).value,normalize(mods,modValue));
  assert(!JSON.stringify(data).includes('private-setting'));
  assert(!JSON.stringify(data).includes('wt-research:language'));
});
test('preview is read-only; restore only overwrites included keys', () => {
  const store=memory({[tree]:'{}',[other]:'{}','wt-research:language':'ja'});
  const api=create(()=>store);
  const ticket=api.preview(create(()=>fixture()).capture());
  assert.equal(ticket.overwritten,1);
  assert.equal(store.getItem(tree),'{}');
  api.restore(ticket);
  assert.deepEqual(api.read(tree),normalize(tree,value));
  assert.deepEqual(api.read(mods),normalize(mods,modValue));
  assert.equal(store.getItem(other),'{}');
  assert.equal(store.getItem('wt-research:language'),'ja');
});
test('invalid files, duplicate keys, unknown versions and private keys are rejected', () => {
  const valid=create(()=>fixture()).capture();
  for (const text of ['bad', 'null','[]',wrap([]), wrap([{key:'wt-research:language',value:{}}]),
    wrap([{key:tree,value:{}},{key:tree,value:{}}]), JSON.stringify({...valid,version:2}),
    JSON.stringify({...valid,createdAt:'invalid'}), ' '.repeat(MAX_BYTES+1)]) assert.throws(()=>parse(text));
});
test('invalid fields and prototype keys cannot enter saved records', () => {
  for (const broken of [{planned:'x'},{owned:[1]}, {progressRp:{x:-1}}, {progressRp:{x:1.5}},
    {avoidFolded:'true'}, {route:[]}, {route:{selectedIds:[{}]}}, {dependencyMode:'bad'},
    JSON.parse('{"progressRp":{"__proto__":1}}'), {route:{removedAutoRoles:{x:'bad'}}}]) {
    assert.throws(()=>parse(wrap([{key:tree,value:broken}])));
  }
  assert.throws(()=>normalize(mods,{selected:'bad'}));
  assert.throws(()=>normalize(mods,{airCombat:0}));
  assert.equal({}.polluted,undefined);
});
test('malformed saved records do not break loading and are preserved on edits', () => {
  const store=memory({[tree]:'{bad'}), warnings=[];
  const api=create(()=>store,code=>warnings.push(code));
  assert.equal(api.read(tree).planned.length,0);
  assert.equal(store.getItem(tree),'{bad');
  assert.equal(api.write(tree,value),false);
  assert.equal(store.getItem(tree),'{bad');
  assert.deepEqual(api.read(tree),normalize(tree,value));
  assert.equal(api.capture().records[0].value.progressRp.us_m18_hellcat,1234);
  assert.deepEqual(warnings,['read','write']);
});
test('damaged inactive records block incomplete export; valid restore can replace damage', () => {
  const store=fixture();store.setItem(tree,'{bad');
  const api=create(()=>store);
  assert.throws(()=>api.capture(),{code:'corrupt'});
  api.restore(api.preview(parse(wrap([{key:tree,value}]))));
  assert.deepEqual(api.read(tree),normalize(tree,value));
});
test('quota failure rolls back earlier writes without touching unrelated records', () => {
  const store=memory({[tree]:'{}',[other]:'{}'}),api=create(()=>store);
  const ticket=api.preview(parse(wrap([{key:tree,value},{key:mods,value:modValue}])));
  const set=store.setItem;
  store.setItem=(key,value)=>{if(key===mods)throw new Error('quota');set(key,value);};
  assert.throws(()=>api.restore(ticket),{code:'storage'});
  assert.equal(store.getItem(tree),'{}');
  assert.equal(store.getItem(mods),null);
  assert.equal(store.getItem(other),'{}');
});
test('failed rollback is explicitly reported, not claimed as a successful restore', () => {
  const store=fixture(),api=create(()=>store);
  const ticket=api.preview(parse(wrap([{key:tree,value:{}},{key:mods,value:{}}])));
  const set=store.setItem;let writes=0;
  store.setItem=(key,value)=>{if(++writes>1)throw new Error('blocked');set(key,value);};
  assert.throws(()=>api.restore(ticket),{code:'rollback'});
});
test('changed records invalidate a preview instead of overwriting newer work', () => {
  const store=fixture(),api=create(()=>store);
  const ticket=api.preview(api.capture());
  store.setItem(tree,'{}');
  assert.throws(()=>api.restore(ticket),{code:'changed'});
  assert.equal(store.getItem(tree),'{}');
});
test('storage failures keep edits in memory and exportable when reads still work', () => {
  const store=fixture(),api=create(()=>store);
  store.setItem=()=>{throw new Error('quota');};
  const changed={...value,planned:['us_m4a1_1942']};
  assert.equal(api.write(tree,changed),false);
  assert.deepEqual(api.read(tree),normalize(tree,changed));
  assert.deepEqual(api.capture().records.find(r=>r.key===tree).value,normalize(tree,changed));
  const unavailable=create(()=>{throw new Error('blocked');});
  assert.equal(unavailable.read(tree).planned.length,0);
  assert.equal(unavailable.write(tree,value),false);
  assert.throws(()=>unavailable.capture(),{code:'storage'});
});
test('storage revoked after preview cannot write any records', () => {
  const store=fixture(),api=create(()=>store);
  const ticket=api.preview(api.capture());
  const before=[...store.map];
  store.getItem=()=>{throw new Error('blocked');};
  assert.throws(()=>api.restore(ticket),{code:'storage'});
  assert.deepEqual([...store.map],before);
});
