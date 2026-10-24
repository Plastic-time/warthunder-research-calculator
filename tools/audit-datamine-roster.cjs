const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const acquisitionCorrections = require('../config/acquisition-corrections.json');

const commit = '371120bedae88b59fa0fa34c04566e83da64eed6';
const source = `https://raw.githubusercontent.com/gszabi99/War-Thunder-Datamine/${commit}/char.vromfs.bin_u/config/shop.blkx`;
const root = path.join(__dirname, '..');
const key = id => id.toLowerCase();

function premiumAcquisition(unit) {
  if (!unit.is_premium) return null;
  // Confirmed availability can be newer than the supplementary Wiki snapshot.
  const correction = acquisitionCorrections[key(unit.data_unit_id)];
  if (correction) return structuredClone(correction);
  if (unit.wiki?.purchase_currency === 'GE') {
    return { type: 'golden-eagles', price: unit.wiki.purchase, currency: 'GE' };
  }
  const detailFile = path.join(root, 'logs/wiki-refresh/units', `${key(unit.data_unit_id)}.html`);
  if (!fs.existsSync(detailFile)) throw new Error(`Missing Wiki detail cache: ${unit.data_unit_id}`);
  const $ = cheerio.load(fs.readFileSync(detailFile, 'utf8'));
  const storeUrl = $('a.game-unit_link--store').first().attr('href') || null;
  return storeUrl ? { type: 'pack', storeUrl } : { type: 'special' };
}

function shopUnits(node, flags = {}, result = new Map()) {
  if (!node || typeof node !== 'object') return result;
  const inherited = { ...flags };
  for (const name of ['isClanVehicle', 'showOnlyWhenBought', 'reqFeature', 'gift']) {
    if (Object.hasOwn(node, name)) inherited[name] = node[name];
  }
  for (const [id, value] of Object.entries(node)) {
    if (!value || typeof value !== 'object') continue;
    if (Number.isInteger(value.rank)) {
      const normalized = key(id);
      if (result.has(normalized)) throw new Error(`Duplicate shop ID: ${id}`);
      result.set(normalized, { id, ...inherited, ...Object.fromEntries(
        ['rank', 'isClanVehicle', 'showOnlyWhenBought', 'reqFeature', 'gift']
          .filter(name => Object.hasOwn(value, name)).map(name => [name, value[name]])
      ) });
    } else shopUnits(value, inherited, result);
  }
  return result;
}

function wikiUnits(node, result = new Map()) {
  if (!node || typeof node !== 'object') return result;
  if (node.data_unit_id && node.type === 'single') {
    const id = key(node.data_unit_id);
    if (result.has(id)) throw new Error(`Duplicate Wiki ID: ${id}`);
    result.set(id, node);
  }
  for (const value of Object.values(node)) if (value && typeof value === 'object') wikiUnits(value, result);
  return result;
}

async function main() {
  const { data: raw } = await axios.get(source, { responseType: 'text', transformResponse: [v => v], timeout: 60000 });
  const shop = JSON.parse(raw);
  const report = { schema: 2, commit, version: '2.59.0.16', source,
    sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'),
    acquisitionCounts: { 'golden-eagles': 0, pack: 0, special: 0 }, trees: {} };
  const countries = ['usa','germany','ussr','britain','japan','china','italy','france','sweden','israel'];
  for (const country of countries) for (const type of ['ground','aviation','helicopters','ships','boats']) {
    const file = path.join(root, 'docs/database', country, `${country}_${type}.json`);
    const contents = fs.readFileSync(file);
    const wiki = wikiUnits(JSON.parse(contents.toString('utf8').replace(/^\uFEFF/, '')));
    const game = shopUnits(shop[`country_${country}`]?.[type === 'ground' ? 'army' : type]);
    const units = {};
    for (const [id, unit] of wiki) {
      const entry = game.get(id);
      const acquisition = premiumAcquisition(unit);
      if (acquisition) report.acquisitionCounts[acquisition.type]++;
      units[id] = { title: unit.title, category: unit.is_squadron || entry?.isClanVehicle ? 'squadron' :
        acquisition ? `premium-${acquisition.type}` : unit.is_component ? 'component' : 'standard',
        ...(acquisition ? { acquisition } : {}),
        matched: !!entry, hidden: entry?.showOnlyWhenBought === true,
        ...(entry ? { evidence: entry } : {}) };
    }
    const candidates = [...game].filter(([id]) => !wiki.has(id)).map(([, entry]) => entry);
    report.trees[`${country}/${type}`] = { wikiSha256: crypto.createHash('sha256').update(contents).digest('hex'),
      wikiCount: wiki.size, matched: [...wiki.keys()].filter(id => game.has(id)).length,
      candidates, units };
  }
  fs.writeFileSync(path.join(root, 'docs', 'roster-audit.json'), JSON.stringify(report));
  console.log(JSON.stringify({ acquisitionCounts: report.acquisitionCounts,
    trees: Object.fromEntries(Object.entries(report.trees).map(([k,v]) => [k, { wiki: v.wikiCount, matched: v.matched, candidates: v.candidates.length }])) }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { shopUnits, wikiUnits, premiumAcquisition };
