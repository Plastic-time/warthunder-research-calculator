const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {parseWikiDetail}=require('../src/wiki-snapshot');
const {sha,root}=require('./refresh-wiki.cjs');

function fixture({rp='2,900',purchase='700',currency='SL',kind='regular',air=false}={}) {
  const card=(title,value)=>value===null?'':`<div class="game-unit_card-info_item"><div class="game-unit_card-info_value">${value}</div><div class="game-unit_card-info_title">${title}</div></div>`;
  const br=value=>`<div class="game-unit_br-item"><div class="mode">RB</div><div class="value">${value}</div></div>`;
  return `<link rel="canonical" href="https://wiki.warthunder.com/unit/test"><div class="game-unit game-unit--${kind}">${card('Purchase',purchase===null?null:purchase+`<img alt="${currency}">`)}${card('Main role','Light tank')}${card('Rank','I')}${card('Research country','USA')}${card('Research',rp)}<div class="game-unit_br">${air?`<div id="unit-br-air" class="tab-pane active">${br('2.0')}</div><div id="unit-br-tank" class="tab-pane">${br('2.3')}</div><div id="unit-br-ship" class="tab-pane">${br('1.7')}</div>`:br('2.0')}</div></div>`;
}
assert.equal(parseWikiDetail(fixture(),'test').rp,2900);
assert.equal(parseWikiDetail(fixture(),'test').sp,700);
assert.equal(parseWikiDetail(fixture({rp:'Free',purchase:'Free'}),'test').rp,0);
assert.equal(parseWikiDetail(fixture({rp:null,purchase:null}),'test').rp,null);
const premium=parseWikiDetail(fixture({kind:'premium',rp:null,purchase:'250',currency:'GE'}),'test');
assert.equal(premium.sp,0); assert.equal(premium.wiki.purchase_currency,'GE'); assert.equal(premium.wiki.purchase,'250');
const squadron=parseWikiDetail(fixture({kind:'squadron',rp:'400,000',purchase:'450,000'}),'test');
assert.equal(squadron.rp,0); assert.equal(squadron.wiki.research,'400,000');
assert.equal(parseWikiDetail(fixture({air:true}),'test').br,'2.0');
assert.equal(parseWikiDetail(fixture({air:true}),'test').wiki.battle_ratings_by_battle.tank.RB,'2.3');
assert.throws(()=>parseWikiDetail('<html>error</html>','test'));
assert.throws(()=>parseWikiDetail(fixture(),'wrong-id'));
assert.throws(()=>parseWikiDetail(fixture({rp:'broken value'}),'test'));

function appContext() {
  const context = vm.createContext({
    document: { documentElement: {}, getElementById: () => ({}), addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => [] },
    window: { matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: () => null, setItem() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    console,
  });
  for (const file of ['i18n.js', 'app-translations.js', 'static-translations.js', 'module-translations.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'docs', file), 'utf8'), context);
  }
  return context;
}
const context=appContext();
const app=fs.readFileSync(path.join(root,'docs/app.js'),'utf8').replace(/\binit\(\);\s*$/,'');
const rules=fs.readFileSync(path.join(root,'docs/unlock-quantity.js'),'utf8');
assert.equal(rules,fs.readFileSync(path.join(root,'dict/unlock_quantity.js'),'utf8'));
const expose='\nrenderTree=()=>{};renderSummary=()=>{};globalThis.calc={state,flattenTree,getDependencyIds,calculatePlan,isInitialUnlockedUnit,formatCost,getRankUnlockQuantity,renderRankUnlockGate};';
vm.runInContext(rules+'\n'+app+expose,context);
const legacy=appContext();
vm.runInContext(rules+'\n'+app+'\n'+fs.readFileSync(path.join(root,'tools/fixtures/legacy-planning.js'),'utf8')+expose,legacy);
const {calc}=context;
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/database/manifest.json'),'utf8'));
let total=0,components=0,unknown=0;
for (const entry of manifest.files) {
  const content=fs.readFileSync(path.join(root,'docs',entry.path),'utf8');
  assert.equal(sha(content),entry.sha256,entry.path);
  const tree=JSON.parse(content);
  calc.state.planned=new Set(); calc.flattenTree(tree);
  legacy.calc.state.planned=new Set(); legacy.calc.flattenTree(tree);
  assert.equal(JSON.stringify(calc.state.units),JSON.stringify(legacy.calc.state.units),'Previous vehicle handling must be preserved');
  assert.equal(calc.state.units.length,entry.units);
  const country=entry.path.split('/')[1];
  const type=entry.path.split('/')[2].slice(country.length+1,-5);
  calc.state.country=country;calc.state.type=type;
  for(const rank of tree) assert.equal(calc.getRankUnlockQuantity(rank),require('../dict/unlock_quantity').get_unlock_quantity(country,type,rank.rank));
  for(const unit of calc.state.units) {
    total++;
    const gameBr = unit.game_battle_ratings;
    assert.equal(unit.br, gameBr ? gameBr.by_battle[gameBr.context].RB : (unit.wiki || unit.game_source).battle_ratings.RB||null);
    if(unit.is_component) {components++;assert.equal(unit.rp,0);}
    if(unit.rp===null||unit.sp===null) {unknown++;assert(!calc.isInitialUnlockedUnit(unit));}
    if(unit.is_squadron||unit.is_premium) {assert.equal(unit.rp,0);assert.equal(unit.sp,0);}
    assert.deepEqual([...calc.getDependencyIds(unit.data_unit_id)],[...legacy.calc.getDependencyIds(unit.data_unit_id)],`${unit.data_unit_id}: previous prerequisite rules`);
  }
}
assert.equal(total,manifest.unit_count);
calc.flattenTree([{rank:'I',researchable_vehicles:[[{type:'single',data_unit_id:'a',rp:0,sp:0,required_unit_id:''},{type:'single',data_unit_id:'b',rp:100,sp:200,required_unit_id:''},{type:'single',data_unit_id:'c',rp:100,sp:200,required_unit_id:'b'}]],premium_vehicles:[]}]);
assert.equal(calc.state.unitMap.get('b').required_unit_id,'a','Restore column fallback');
assert.deepEqual([...calc.getDependencyIds('c')],['c'],'Restore Rank I handling');
calc.state.country='usa';calc.state.type='ground';
assert.equal(calc.getRankUnlockQuantity({rank:'I',unlock_quantity:null}),6);
assert(calc.renderRankUnlockGate({rank:'I',unlock_quantity:null},{rank:'II'}).includes('/ 6'));
calc.state.country='israel';calc.state.type='aviation';calc.state.dependencyMode='selected';
calc.flattenTree(JSON.parse(fs.readFileSync(path.join(root,'docs/database/israel/israel_aviation.json'),'utf8')));
const israelRankEight=calc.state.units.filter(unit=>unit.rank==='VIII' && unit.section==='researchable').slice(0,3);
assert.equal(israelRankEight.length,3);
assert.equal(calc.getRankUnlockQuantity({rank:'VIII',unlock_quantity:null}),3);
calc.state.planned=new Set(israelRankEight.slice(0,2).map(unit=>unit.data_unit_id));
assert(!calc.renderRankUnlockGate({rank:'VIII',unlock_quantity:null},{rank:'IX'}).includes('is-complete'));
calc.state.planned=new Set(israelRankEight.map(unit=>unit.data_unit_id));
assert(calc.renderRankUnlockGate({rank:'VIII',unlock_quantity:null},{rank:'IX'}).includes('is-complete'));
assert(calc.renderRankUnlockGate({rank:'VIII',unlock_quantity:null},{rank:'IX'}).includes('3 / 3'));
assert.equal(calc.formatCost(null),'未提供');
console.log(JSON.stringify({pass:true,trees:manifest.files.length,units:total,components,unknownCosts:unknown,parserCases:11}));
