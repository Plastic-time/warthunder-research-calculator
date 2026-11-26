const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { battleRating } = require('./apply-game-roster-additions.cjs');
const catalog = require('../docs/database/modifications/catalog.json');

const { version, commit, sources } = catalog.navalModificationReview;
const bytes = fs.readFileSync(process.argv[2]);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sources['wpcost.blkx']);
const costs = new Map(Object.entries(JSON.parse(bytes)).map(([id, unit]) => [id.toLowerCase(), unit]));
const rows = [];
for (const [id, chunk] of Object.entries(catalog.vehicles)) {
  const unit = costs.get(id.toLowerCase());
  assert(unit, 'Missing game unit: ' + id);
  const byOffset = new Map([[0, []]]);
  for (const [mod, config] of Object.entries(unit.modifications || {})) {
    if (!config.addMrank) continue;
    assert(Number.isInteger(config.addMrank) && config.addMrank > 0);
    if (!byOffset.has(config.addMrank)) byOffset.set(config.addMrank, []);
    byOffset.get(config.addMrank).push(mod);
  }
  if (byOffset.size === 1) continue;
  const shipped = require('../docs/' + catalog.chunks[chunk].path).v[id];
  for (const mods of byOffset.values()) for (const mod of mods) {
    assert(shipped.m.some(row => row[0] === mod), id + ': BR modification missing from research tree: ' + mod);
  }
  const levels = [...byOffset.keys()].sort((a, b) => a - b).map(offset => ({
    ground: battleRating((unit.economicRankTankHistorical ?? unit.economicRankHistorical) + offset),
    ...(chunk.endsWith('_aviation') ? { air: battleRating(unit.economicRankHistorical + offset) } : {}),
    mods: byOffset.get(offset),
  }));
  rows.push('  ' + JSON.stringify(id) + ': ' + JSON.stringify(levels));
}
const content = '// Generated from War Thunder ' + version + ', Datamine ' + commit + '.\n'
  + 'window.WTCustomBattleRatings = {\n' + rows.join(',\n') + '\n};\n';
for (const dir of ['public', 'docs']) {
  fs.writeFileSync(path.join(__dirname, '..', dir, 'custom-battle-ratings.js'), content);
}
console.log(rows.length + ' vehicle BR profiles');
