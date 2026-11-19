const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { battleRating } = require('./apply-game-roster-additions.cjs');
const catalog = require('../docs/database/modifications/catalog.json');

// Regular live 2.61.0.26, char.vromfs.bin_u/config/wpcost.blkx.
const commit = 'f65dbd485f6b9eb1fb9f9c67cb6dd177650e9a27';
const sha256 = 'a57fb71b5b29c6b4dd71c7ff70de724692cf56775c1069b1f8bcfe747add701e';
const bytes = fs.readFileSync(process.argv[2]);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha256);
const costs = JSON.parse(bytes);
const rows = [];
for (const [id, chunk] of Object.entries(catalog.vehicles)) {
  const unit = costs[id];
  const byOffset = new Map([[0, []]]);
  for (const [mod, config] of Object.entries(unit?.modifications || {})) {
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
const content = '// Generated from War Thunder 2.61.0.26, Datamine ' + commit + '.\n'
  + 'window.WTCustomBattleRatings = {\n' + rows.join(',\n') + '\n};\n';
for (const dir of ['public', 'docs']) {
  fs.writeFileSync(path.join(__dirname, '..', dir, 'custom-battle-ratings.js'), content);
}
console.log(rows.length + ' vehicle BR profiles');
