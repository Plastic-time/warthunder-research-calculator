const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { gameRequirements } = require('./modification-requirements.cjs');
const { buildRows, modificationTemplate } = require('./build-game-locales.cjs');
const roster = require('../config/game-roster-additions.json');
const root = path.resolve(__dirname, '..');
const fixturePath = 'tools/fixtures/event-modifications-20261024.json';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const languages = ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es'];
const classes = {
  aviation: ['lth', 'armor', 'weapon'], ground: ['mobility', 'protection', 'firepower'],
  boats: ['seakeeping', 'unsinkability', 'firepower'],
};
const fields = ['tier', 'reqExp', 'value', 'costGold', 'openCostGold', 'modClass', 'isHidden', 'group', 'caliber',
  'image', 'image_tank', 'image_aircraft', 'reqModification', 'prevModification'];
const subset = value => Object.fromEntries(fields.filter(k => Object.hasOwn(value, k)).map(k => [k, value[k]]));
const premiumIds = new Set(['germ_panzerjager_panther_g2', 'germ_s_700_s_706']);
const policy = {
  kind: 'official-premium-pre-unlocked',
  announcement: 'https://warthunder.com/en/news/10265-warbonds-event-battle-pass-season-25-steel-fury-and-its-warbond-shop-en',
  rule: 'https://store.gaijin.net/story.php?title=Saab-JA-37DI-Viggen-F21-Pack',
  meaning: 'Premium vehicles include all available modifications. Zero here is remaining research, not an invented missing reqExp value.',
};

function effective(entry) {
  const merged = { ...entry.global, ...entry.cost };
  // The client only reads research prerequisites from this exact unit's economy block.
  delete merged.reqModification;
  if (Object.hasOwn(entry.cost, 'reqModification')) merged.reqModification = entry.cost.reqModification;
  return merged;
}

// Reproduce category/branch packing, without the game's bonus column or fake padding.
function layout(mods, categories) {
  const tree = categories.map(c => [c]);
  const find = (branch, id) => {
    for (let i = 0; i < branch.length; i++) {
      if (Array.isArray(branch[i])) { const found = find(branch[i], id); if (found) return found; }
      else if (branch[i]?.id === id) return [branch, i];
    }
  };
  const insert = mod => {
    const previous = mod.requires[0] || mod.prev;
    if (!previous) { tree.find(b => b[0] === mod.category).push(mod); return true; }
    const found = find(tree, previous);
    if (!found) return false;
    const [branch, i] = found;
    assert.equal(branch[i].category, mod.category, 'Cross-category layout needs review');
    assert(branch[i].tier < mod.tier, 'Same/backward tier layout needs review');
    if (i === 0) branch.push(mod); else branch[i] = [branch[i], mod];
    return true;
  };
  const pending = mods.filter(m => !insert(m));
  while (pending.length) {
    const before = pending.length;
    for (let i = pending.length - 1; i >= 0; i--) if (insert(pending[i])) pending.splice(i, 1);
    assert(pending.length < before, 'Unresolved or cyclic layout predecessor');
  }
  const members = b => Array.isArray(b) ? b.flatMap(members) : typeof b === 'object' ? [b] : [];
  const position = branch => {
    const category = typeof branch[0] === 'string';
    const rootTier = category ? -1 : branch[0].tier;
    const occupied = {}, free = [];
    for (const child of branch.slice(1)) {
      let widths;
      if (Array.isArray(child)) widths = position(child);
      else { child.column = 0; widths = { [child.tier]: 1 }; }
      const childTier = Array.isArray(child) ? child[0].tier : child.tier;
      if (rootTier >= 0) for (let t = rootTier + 1; t < childTier; t++) widths[t] = 1;
      if (category && !Array.isArray(child)) { free.push(child); continue; }
      const offset = Object.keys(occupied).length
        ? Math.max(...members(child).map(m => (occupied[m.tier] || 0) - m.column)) : 0;
      for (const m of members(child)) m.column += offset;
      for (const [t, width] of Object.entries(widths)) occupied[t] = offset + width;
    }
    if (!category) { branch[0].column = 0; occupied[rootTier] = 1; }
    for (const m of free) { m.column = occupied[m.tier] || 0; occupied[m.tier] = m.column + 1; }
    return occupied;
  };
  return tree.map(branch => Math.max(1, ...Object.values(position(branch))));
}

function build(unit) {
  const candidate = roster.units.find(c => c.id === unit.id);
  assert(candidate && classes[candidate.type], 'Unapproved vehicle');
  assert.equal(unit.type, candidate.type);
  const categories = classes[unit.type];
  const visible = unit.entries.filter(entry => {
    const g = effective(entry);
    return !g.isHidden && g.costGold === 0 && !entry.bulletGroup && categories.includes(g.modClass);
  });
  const ids = new Set(visible.map(e => e.id));
  assert.equal(ids.size, visible.length);
  const mods = visible.map((entry, order) => {
    const g = effective(entry);
    assert(Number.isInteger(g.tier) && g.tier >= 1 && g.tier <= 4, 'Unreviewed tier');
    assert(Number.isInteger(g.value) && g.value >= 0, 'Missing SL');
    let rp = g.reqExp;
    if (unit.premiumPolicy) {
      assert(premiumIds.has(unit.id) && candidate.premium, 'Unapproved premium exception');
      assert.deepEqual(unit.premiumPolicy, policy);
      assert(g.reqExp === undefined || g.reqExp === 0, 'Premium research conflict');
      assert(g.openCostGold === undefined || g.openCostGold === 0, 'Premium GE conflict');
      assert.equal(g.value, 0, 'Premium purchase conflict');
      rp = 0;
    }
    assert(Number.isInteger(rp) && rp >= 0, 'Missing RP; never default unknown costs to zero');
    const ge = unit.premiumPolicy ? 0 : g.openCostGold;
    assert(Number.isInteger(ge) && ge >= 0, 'Missing GE unlock cost');
    for (const lang of languages) assert(typeof entry.names?.[lang] === 'string' && entry.names[lang].trim()
      && !entry.names[lang].includes('%s') && entry.names[lang] !== entry.id, 'Unresolved name: ' + entry.id);
    const kind = unit.type === 'ground' ? 'image_tank' : unit.type === 'aviation' ? 'image_aircraft' : 'image';
    const image = entry.cost[kind] ?? entry.global[kind] ?? entry.cost.image ?? entry.global.image;
    assert(/^!#ui\/gameuiskin#[\w-]+\.avif$/.test(image), 'Unknown icon');
    const requires = gameRequirements(entry.cost, ids);
    const prev = g.prevModification;
    assert(!prev || ids.has(prev), 'Unknown layout predecessor');
    return { id:entry.id, category:g.modClass, tier:g.tier, rp, sl:g.value, ge, requires, prev,
      names:entry.names, icon:image.split('#').at(-1).replace(/\.avif$/, '.png'), order };
  });
  const widths = layout(mods, categories);
  const cells = mods.map(m => [m.category, m.tier, m.column].join(':'));
  assert.equal(new Set(cells).size, mods.length, 'Overlapping modification cells');
  assert.equal(unit.tierRequirements.length, 4);
  unit.tierRequirements.forEach(n => assert(Number.isInteger(n) && n >= 0));
  return { i:unit.id, n:[candidate.names.zh, candidate.names.en], v:candidate.image.url,
    r:unit.tierRequirements.slice(0, 3), c:categories.map((id, i) => [...unit.categoryNames[id], widths[i]]),
    t:[mods.reduce((n,m) => n+m.rp,0), mods.reduce((n,m) => n+m.sl,0)],
    l:Object.fromEntries(mods.map(m => [m.id, m.names])),
    m:mods.map(m => [m.id,categories.indexOf(m.category),m.tier,m.column,m.names.zh,m.names.en,m.icon,m.rp,m.sl,m.ge,m.requires,m.order]),
    gameSource:{ version:roster.version, commit:roster.commit, provenance:fixturePath,
      costPolicy:unit.premiumPolicy ? policy.kind : 'explicit-unit-economy', prerequisiteField:'reqModification' } };
}

function extract(sourceDir, economyDir) {
  assert(sourceDir && economyDir, 'Provide both pinned source directories');
  const sourceList = JSON.parse(fs.readFileSync(path.join(sourceDir, 'sources.json')));
  const needed = ['modifications.blkx','units_modifications.csv','units_weaponry.csv','modstree.nut','initunitweapons.nut',
    'modificationinfo.nut','bulletsinfo.nut','unit.nut','baseunittypes.nut', '88mm_pak43_user_cannon.blkx',
    '30mm_38_mk103_1942_naval_user_cannon.blkx','20mm_65_c38_zwilling_naval_user_cannon.blkx',
    ...roster.units.map(c => c.id + '.blkx')];
  const sources = needed.map(name => {
    const s = sourceList.find(s => path.basename(s.file) === name); assert(s, name);
    const bytes = fs.readFileSync(path.join(sourceDir, name));
    assert.equal(s.commit, roster.commit); assert.equal(sha(bytes), s.sha256); assert.equal(bytes.length,s.bytes);
    return s;
  });
  const economySource = roster.sources.find(s => s.file.endsWith('/wpcost.blkx'));
  const bytes = fs.readFileSync(path.join(economyDir, 'current-wpcost.json'));
  assert.equal(sha(bytes), economySource.sha256); sources.push(economySource);
  const economy = JSON.parse(bytes), globals = JSON.parse(fs.readFileSync(path.join(sourceDir,'modifications.blkx'))).modifications;
  const rows = buildRows(fs.readFileSync(path.join(sourceDir,'units_modifications.csv'),'utf8')).rows;
  for (const [k,v] of buildRows(fs.readFileSync(path.join(sourceDir,'units_weaponry.csv'),'utf8')).rows) if (!rows.has(k)) rows.set(k,v);
  const weapons = ['88mm_pak43_user_cannon.blkx','30mm_38_mk103_1942_naval_user_cannon.blkx','20mm_65_c38_zwilling_naval_user_cannon.blkx']
    .map(f => ({ file:f, data:JSON.parse(fs.readFileSync(path.join(sourceDir,f))) }));
  return { schema:1, version:roster.version, commit:roster.commit, sources, units:roster.units.map(c => {
    const game = economy[c.id];
    const model = JSON.parse(fs.readFileSync(path.join(sourceDir, c.id + '.blkx')));
    const mountedWeapons = new Set([].concat(model.commonWeapons?.Weapon || [])
      .map(w => path.posix.basename(w.blk).toLowerCase() + 'x'));
    const unit = { id:c.id, type:c.type, tierRequirements:[1,2,3,4].map(t => game['needBuyToOpenNextInTier' + t]),
      categoryNames:Object.fromEntries(classes[c.type].map(k => {
        const names = rows.get('modification/category/' + k); assert(names, k); return [k,[names.zh,names.en]];
      })), entries:Object.entries(game.modifications).map(([id,cost]) => {
        const global = globals[id]; assert(global, id);
        const entry = {id,cost:subset(cost),global:subset(global),bulletGroup:!!(global.group && (global.effects?.additiveBulletMod || global.effects?.bulletMod))};
        const g = effective(entry);
        if (!g.isHidden && g.costGold === 0 && !entry.bulletGroup && classes[c.type].includes(g.modClass)) {
          let key = 'modification/' + id, names = rows.get(key);
          if (!names) { const t = modificationTemplate(id,g,rows); if(t) { names=t.name; key=t.key; } }
          if (!names && id.endsWith('_ammo_pack')) {
            const relation = Object.entries(game.modifications).filter(([k,v]) => v.reqModification === id && globals[k]?.effects?.additiveBulletMod);
            assert.equal(relation.length,1,'Ambiguous ammunition association');
            const ammoId = relation[0][0], weapon = weapons.find(w => w.data[ammoId]); assert(weapon,ammoId);
            assert(mountedWeapons.has(weapon.file), 'Ammunition weapon is not mounted on this exact variant');
            const bullets = [].concat(weapon.data[ammoId].bullet);
            key = bullets[0].bulletName || ammoId + '/name'; names=rows.get(key);
            entry.ammunition = {id:ammoId,weapon:weapon.file,key,bullets:bullets.map(b => ({type:b.bulletType,caliber:b.caliber,...(b.bulletName ? {name:b.bulletName} : {})}))};
          }
          assert(names, 'Missing game translation: ' + id); entry.names=names; entry.nameKey=key;
        }
        return entry;
      }) };
    if (premiumIds.has(c.id)) unit.premiumPolicy=policy;
    build(unit); return unit;
  }) };
}

function apply(fixture) {
  const writes = new Map(), put = (file,value,pretty=false) => writes.set(file,JSON.stringify(value,null,pretty?2:undefined)+'\n');
  const catalog=read('docs/database/modifications/catalog.json');
  const names=read('public/modification-names.json');
  const manifest=read('docs/database/manifest.json'), audit=read('public/roster-audit.json');
  const config=structuredClone(roster);
  let added=0;
  for(const unit of fixture.units) {
    const key='germany_'+unit.type, file='database/modifications/'+key+'.json', chunk=read('docs/'+file);
    assert.equal(fs.readFileSync(path.join(root,'public',file),'utf8'),fs.readFileSync(path.join(root,'docs',file),'utf8'));
    assert(!chunk.v[unit.id] && !catalog.vehicles[unit.id], 'Already imported');
    chunk.v[unit.id]=build(unit); added+=chunk.v[unit.id].m.length;
    const bytes=JSON.stringify(chunk)+'\n', meta=catalog.chunks[key];
    for(const prefix of ['public/','docs/']) writes.set(prefix+file,bytes);
    meta.vehicles++; meta.modifications+=chunk.v[unit.id].m.length; meta.bytes=Buffer.byteLength(bytes); meta.sha256=sha(bytes);
    catalog.vehicles[unit.id]=key;
    config.units.find(c=>c.id===unit.id).modificationStatus='verified-game-data';
    const treeFile='database/germany/germany_'+unit.type+'.json', tree=read(treeFile);
    const {wikiUnits}=require('./audit-datamine-roster.cjs');
    wikiUnits(tree).get(unit.id).game_source.modification_status='verified-game-data';
    const treeBytes=JSON.stringify(tree,null,2)+'\n'; writes.set(treeFile,treeBytes); writes.set('docs/'+treeFile,treeBytes);
    manifest.files.find(f=>f.path===treeFile).sha256=sha(treeBytes);
    audit.trees['germany/'+unit.type].snapshotSha256=sha(treeBytes);
  }
  catalog.stats.treeUnits=manifest.unit_count;
  catalog.stats.vehicles+=fixture.units.length; catalog.stats.modifications+=added; names.occurrences+=added;
  catalog.eventModifications={version:fixture.version,commit:fixture.commit,ids:fixture.units.map(u=>u.id),provenance:fixturePath,fullSnapshotUpgrade:false};
  for(const prefix of ['public/','docs/']) { put(prefix+'database/modifications/catalog.json',catalog); put(prefix+'modification-names.json',names); put(prefix+'roster-audit.json',audit); }
  put('config/game-roster-additions.json',config,true); put('docs/database/manifest.json',manifest,true);
  const backups=new Map([...writes].map(([f])=>[f,fs.readFileSync(path.join(root,f))]));
  try { for(const [f,bytes] of writes) fs.writeFileSync(path.join(root,f),bytes); }
  catch(error) { for(const [f,bytes] of backups) fs.writeFileSync(path.join(root,f),bytes); throw error; }
  console.log(JSON.stringify({files:writes.size,vehicles:fixture.units.length,modifications:added}));
}

if(require.main===module) {
  const option = name => {
    const index = process.argv.indexOf(name);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  if(process.argv.includes('--extract')) {
    for (const c of roster.units) assert(!read('docs/database/modifications/germany_' + c.type + '.json').v[c.id], 'Do not replace the pre-import baseline after import');
    const fixture=extract(option('--source-dir'),option('--economy-dir'));
    fixture.baselines=Object.fromEntries(roster.units.map(c=>{const k='germany_'+c.type;return[k,sha(JSON.stringify(read('docs/database/modifications/'+k+'.json').v))]}));
    fs.writeFileSync(path.join(root,fixturePath),JSON.stringify(fixture,null,2)+'\n');
    console.log(fixture.units.map(u=>({id:u.id,mods:build(u).m.length,totals:build(u).t})));
  } else if(process.argv.includes('--verify')) {
    const stored=read(fixturePath), extracted=extract(option('--source-dir'),option('--economy-dir'));
    delete stored.baselines; assert.deepEqual(stored,extracted); console.log('Pinned sources and extracted fixture match');
  } else if(process.argv.includes('--apply')) apply(read(fixturePath));
}
module.exports={build,layout,effective,extract};
