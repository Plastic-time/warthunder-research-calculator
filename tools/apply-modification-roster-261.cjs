const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const { buildRows, modificationTemplate } = require('./build-game-locales.cjs');
const { gameRequirements } = require('./modification-requirements.cjs');
const { visibleMods } = require('./audit-modification-membership.cjs');
const { layout } = require('./event-modifications.cjs');
const root = path.resolve(__dirname, '..');
const oldSources = {
  'wpcost.blkx': 'a57fb71b5b29c6b4dd71c7ff70de724692cf56775c1069b1f8bcfe747add701e',
  'modifications.blkx': '019d7763a0e608d08f738e9d60d8ec357204a426032fe49e43b151e1bce558f0',
  'units_modifications.csv': '7f8bcd04eab56e5e1bde35550178e6efbe2a9cbba02279c70c22cea6c6de68ed',
  'units_weaponry.csv': '2a438b541fafa6df6828fd2b3b4299575c5b54bde7a6529011cdf95b715a58c3',
};
const reviews = {
  '2.61.0.26': {
    commit: 'f65dbd485f6b9eb1fb9f9c67cb6dd177650e9a27', sources: oldSources,
    previousCatalog: '2477989d27b93d88183fc2d35c3b649fbaa4fe3a168a83af06bc87b436f85fda',
    key: 'modificationRosterReview', fixture: 'modification-roster-261-previous.json', changes: [54, 19],
  },
  '2.61.0.42': {
    commit: '4268c8d0acfeeb8ba175176fabce053ceb74702f',
    sources: {
      'wpcost.blkx': '9bd89bb3396db13270c6d9ff4be57274ac515c285603f4b83c3e86a24906c9fb',
      'modifications.blkx': oldSources['modifications.blkx'],
      'units_modifications.csv': 'f6c371dd65eee02bfa1fea609eb70e817ca25be42705f3f714691d04d4f8a8ff',
      'units_weaponry.csv': 'd330f0d307a504e00a590f865d3a0b31cd7819fe526a525f37ee9c2be0f77a72',
    },
    previousCatalog: '586c589665603bcc467b95a596c4e6a5bf950c73dc24d4ce6b5156c923977402',
    key: 'navalModificationReview', fixture: 'naval-modifications-26142-previous.json', changes: [53, 0],
  },
};
const protectedIds = new Set(['ka_29','do_217j_2','ca_27_mk32_raaf','ca_27_mk32_malaysia']);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const format = object => JSON.stringify(object) + '\n';

function presentation(directory, vehicle, costs) {
  const $ = cheerio.load(fs.readFileSync(path.join(directory, vehicle.i + '.html')));
  const cells = new Map();
  $('.game-unit_mods-table').each((category, table) => {
    const heading = $(table).find('th').first();
    assert.equal(heading.text().trim(), vehicle.c[category][1]);
    vehicle.c[category][2] = Number(heading.attr('colspan') || 1);
    $(table).find('tr').slice(1).each((row, tr) => {
      $(tr).children('td').each((column, td) => {
        const button = $(td).find('button[data-mod-id]');
        if (!button.length) return;
        const id = button.attr('data-mod-id');
        assert.equal(costs[id]?.tier, row + 1, vehicle.i + '/' + id);
        assert(!cells.has(id) && column < vehicle.c[category][2]);
        cells.set(id, { category, column, icon: button.children('img').attr('src')?.split('/').pop() });
      });
    });
  });
  assert.deepEqual([...cells.keys()].sort(), Object.keys(costs).sort());
  return cells;
}

function navalPresentation(vehicle, costs, definitions) {
  const categories = vehicle.c.map(category => category[1].toLowerCase());
  const ids = new Set(Object.keys(costs));
  const mods = Object.entries(costs).map(([id, cost]) => {
    const config = { ...definitions[id], ...cost };
    return { id, tier: config.tier, category: config.modClass, prev: config.prevModification,
      requires: gameRequirements(cost, ids), image: config.image };
  });
  const widths = layout(mods, categories);
  widths.forEach((width, i) => { vehicle.c[i][2] = width; });
  return new Map(mods.map(mod => [mod.id, { category: categories.indexOf(mod.category),
    column: mod.column, icon: mod.image?.split('#').at(-1).replace(/\.avif$/, '.png') }]));
}

function apply(directory, write) {
  const version = fs.readFileSync(path.join(directory, 'version'), 'utf8').trim();
  const review = reviews[version];
  assert(review, 'Unreviewed game version');
  const { sources, commit } = review;
  const load = file => {
    const bytes = fs.readFileSync(path.join(directory, file));
    assert.equal(digest(bytes), sources[file], file);
    return bytes.toString('utf8');
  };
  const game = new Map(Object.entries(JSON.parse(load('wpcost.blkx'))).map(([id, unit]) => [id.toLowerCase(), unit]));
  const definitions = JSON.parse(load('modifications.blkx')).modifications;
  const names = buildRows(load('units_modifications.csv')).rows;
  // Official Chinese patch notes, https://forum.warthunder.com/t/2-61-0-42/367080
  if (review.key === 'navalModificationReview') names.get('modification/ship_main_degaussing').zh = '消磁线圈';
  for (const [key, row] of buildRows(load('units_weaponry.csv')).rows) if (!names.has(key)) names.set(key, row);
  const catalogFile = 'database/modifications/catalog.json';
  const readMirrors = file => {
    const bytes = fs.readFileSync(path.join(root, 'docs', file));
    assert(bytes.equals(fs.readFileSync(path.join(root, 'public', file))), file);
    return bytes;
  };
  const catalog = JSON.parse(readMirrors(catalogFile));
  const previous = { chunks: {}, vehicles: {}, count: catalog.stats.modifications };
  const writes = new Map();
  let added = 0, removed = 0;
  for (const [key, meta] of Object.entries(catalog.chunks)) {
    const bytes = readMirrors(meta.path);
    assert.equal(digest(bytes), meta.sha256);
    const chunk = JSON.parse(bytes);
    let changed = false;
    for (const [id, original] of Object.entries(chunk.v)) {
      if (protectedIds.has(id)) continue;
      const unit = game.get(id.toLowerCase());
      const costs = visibleMods(unit, definitions);
      const current = new Map(original.m.map(row => [row[0], row]));
      const missing = Object.keys(costs).filter(k => !current.has(k));
      const obsolete = [...current.keys()].filter(k => !Object.hasOwn(costs, k));
      const v = structuredClone(original);
      let cells;
      if (missing.length || obsolete.length) {
        cells = review.key === 'navalModificationReview'
          ? navalPresentation(v, costs, definitions) : presentation(directory, v, costs);
      }
      const ids = new Set(Object.keys(costs));
      const premium = unit.modifications.premExpMul?.costGold === 0 && original.t.every(n => n === 0);
      v.m = v.m.filter(row => ids.has(row[0]));
      for (const mod of missing) {
        const config = { ...definitions[mod], ...costs[mod] };
        const label = names.get('modification/' + mod) || modificationTemplate(mod, config, names)?.name;
        assert(label?.en && label?.zh, mod);
        const cell = cells.get(mod);
        assert(/^[\w-]+\.png$/i.test(cell.icon), mod);
        const paired = !premium && config.reqExp == null && config.value === 0 && config.costGold === 0
          && typeof config.reqModification === 'string' && ids.has(config.reqModification);
        assert(Number.isInteger(config.reqExp) || (config.value === 0 && (premium || paired)), 'Unverified RP: ' + mod);
        assert(Number.isInteger(config.openCostGold) || (config.value === 0 && (premium || paired)), 'Unverified GE: ' + mod);
        if (paired) (v.autoUnlockWith ||= {})[mod] = config.reqModification;
        (v.l ||= {})[mod] = label;
        v.m.push([mod,cell.category,config.tier,cell.column,label.zh,label.en,cell.icon,
          config.reqExp ?? 0,config.value,config.openCostGold ?? 0,[],Math.max(-1,...v.m.map(m=>m[11])) + 1]);
      }
      for (const mod of obsolete) {
        if (v.l) delete v.l[mod];
        if (v.aliases) for (const [alias, target] of Object.entries(v.aliases)) if (target === mod) delete v.aliases[alias];
      }
      // Game replacement of the same MAW research module retains local progress.
      const oldMaw = 'MAW_system_heli_false_thermal_targets_large';
      if (obsolete.includes(oldMaw) && missing.includes(oldMaw + '_dircm')) (v.aliases ||= {})[oldMaw] = oldMaw + '_dircm';
      for (const row of v.m) {
        const mod = row[0], config = { ...definitions[mod], ...costs[mod] };
        if (cells) { row[1] = cells.get(mod).category; row[3] = cells.get(mod).column; }
        row[2] = config.tier;
        for (const [field, index] of [['reqExp',7],['value',8],['openCostGold',9]]) {
          if (Number.isInteger(config[field])) row[index] = config[field];
        }
        row[10] = gameRequirements(config, ids);
      }
      v.r = [1,2,3].map((tier,i) => unit['needBuyToOpenNextInTier'+tier] ?? v.r[i]);
      v.t = v.m.reduce(([rp,sl],m)=>[rp+m[7],sl+m[8]], [0,0]);
      if (JSON.stringify(v) === JSON.stringify(original)) continue;
      assert.equal(new Set(v.m.map(m=>m.slice(1,4).join('/'))).size, v.m.length, id);
      previous.vehicles[id] = { before: original, afterHash: digest(format(v)) };
      added += missing.length;
      removed += obsolete.length;
      chunk.v[id] = v;
      changed = true;
    }
    if (!changed) continue;
    previous.chunks[key] = { ...meta };
    const content = format(chunk);
    meta.bytes = Buffer.byteLength(content);
    meta.modifications = Object.values(chunk.v).reduce((sum,v)=>sum+v.m.length,0);
    meta.sha256 = digest(content);
    writes.set(meta.path, content);
  }
  if (!writes.size) return console.log('Already current.');
  catalog.stats.modifications += added - removed;
  catalog[review.key] = { version, commit, sources, vehicles: Object.keys(previous.vehicles), added, removed };
  writes.set(catalogFile, format(catalog));
  console.log({ vehicles: Object.keys(previous.vehicles).length, added, removed });
  if (write) {
    assert.equal(digest(readMirrors(catalogFile)), review.previousCatalog);
    assert.deepEqual([added, removed], review.changes);
    const files = new Map();
    for (const [file, content] of writes) for (const dir of ['docs','public']) files.set(path.join(root, dir, file), content);
    files.set(path.join(__dirname, 'fixtures', review.fixture), format(previous));
    const old = new Map(), staged = new Map(), installed = [];
    try {
      for (const [file, content] of files) {
        old.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
        const temporary = file + '.' + crypto.randomUUID() + '.tmp';
        staged.set(file, temporary);
        fs.writeFileSync(temporary, content, { flag: 'wx' });
      }
      for (const [file, temporary] of staged) {
        fs.renameSync(temporary, file);
        installed.push(file);
      }
    } catch (error) {
      for (const file of installed.reverse()) {
        if (old.get(file)) fs.writeFileSync(file, old.get(file)); else fs.unlinkSync(file);
      }
      throw error;
    } finally {
      for (const temporary of staged.values()) if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
}
if (require.main === module) apply(process.argv[2], process.argv.includes('--apply'));
