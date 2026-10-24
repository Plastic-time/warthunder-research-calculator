const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { wikiUnits, shopUnits } = require('./audit-datamine-roster.cjs');
const { buildRows, vehicleCandidates, resolveName, createReport } = require('./build-game-locales.cjs');
const additions = require('../config/game-roster-additions.json');
const root = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

function battleRating(rank) {
  assert(Number.isInteger(rank) && rank >= 0, 'Missing game economic rank');
  // Pinned ranks_common_shared.nut: round_by_value(economicRank / 3.0 + 1, 0.1).
  return (Math.round((rank / 3 + 1) * 10) / 10).toFixed(1);
}

function makeUnit(candidate, reviewedAt = additions.reviewedAt) {
  const g = candidate.gameFields;
  assert.equal(candidate.country, 'germany', 'Only the reviewed German rewards are approved');
  assert.equal(candidate.type, { air: 'aviation', tank: 'ground', fast_ship: 'boats' }[g.unitMoveType]);
  assert.equal(candidate.premium, candidate.acquisition.type === 'battle-pass');
  assert.equal(candidate.image.url, 'https://static.encyclopedia.warthunder.com/slots/' + candidate.id + '.png');
  assert(candidate.image.status === 200 && candidate.image.pngSignature === true);
  assert(Date.parse(candidate.acquisition.availableFrom) <= Date.parse(reviewedAt), 'Reward not started');
  assert.equal(g.country, 'country_' + candidate.country);
  assert.equal(candidate.shop.rank, g.rank);
  assert.equal(candidate.shop.id.toLowerCase(), candidate.id);
  assert.equal(g.showOnlyWhenBought, true);
  assert(roman[g.rank], 'Invalid rank');
  assert(['twitch-drops', 'battle-pass'].includes(candidate.acquisition.type));
  const url = new URL(candidate.acquisition.url);
  assert(url.protocol === 'https:' && ['warthunder.com', 'forum.warthunder.com'].includes(url.hostname));
  const battleRatings = Object.fromEntries(['Arcade', 'Historical', 'Simulation'].map((mode, i) =>
    [['AB', 'RB', 'SB'][i], battleRating(g['economicRank' + mode]) ]));
  const role = { exp_fighter: 'Fighter', exp_tank_destroyer: 'Tank destroyer', exp_torpedo_boat: 'Motor torpedo boat' }[g.unitClass];
  assert(role, 'Unreviewed vehicle class');
  return { type: 'single', title: candidate.names.en, vehicle_icon: candidate.image.url,
    br: battleRatings.RB, rp: 0, sp: 0, data_unit_id: candidate.id, required_unit_id: '', selected: false,
    class_name: candidate.premium ? 'prem' : '', details: true, rank: roman[g.rank], research_country: 'Germany', main_role: role,
    is_component: false, component_of: null, is_premium: candidate.premium, is_squadron: false,
    game_source: { version: additions.version, commit: additions.commit, battle_ratings: battleRatings,
      official_url: candidate.acquisition.url, acquisition: candidate.acquisition,
      cost_policy: 'reward-excluded-from-ordinary-research', modification_status: candidate.modificationStatus,
      provenance: 'config/game-roster-additions.json' } };
}

function verifySources(sourceDirectory, reviewDirectory) {
  assert(sourceDirectory && reviewDirectory, 'Provide --source-dir and --review-dir for verified pinned files');
  const files = {};
  for (const source of additions.sources) {
    const name = path.basename(source.file);
    const file = name === 'wpcost.blkx' ? path.join(reviewDirectory, 'current-wpcost.json')
      : name === 'shop.blkx' ? path.join(reviewDirectory, 'current-shop.json') : path.join(sourceDirectory, name);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, source.bytes, 'Source length: ' + name);
    assert.equal(sha(bytes), source.sha256, 'Source hash: ' + name);
    files[name] = bytes.toString('utf8');
  }
  const economy = JSON.parse(files['wpcost.blkx']), shop = shopUnits(JSON.parse(files['shop.blkx']));
  const { rows } = buildRows(files['units.csv'], true), coverage = createReport();
  for (const c of additions.units) {
    const game = economy[c.id];
    assert(game, 'Missing exact variant');
    for (const [key, value] of Object.entries(c.gameFields)) assert.deepEqual(game[key], value, c.id + ':' + key);
    assert.deepEqual(shop.get(c.id), c.shop);
    const resolved = resolveName(c.id, vehicleCandidates(c.id, 'single'), rows, null, coverage);
    assert.deepEqual(resolved.name, c.names);
    assert.equal(resolved.key, c.nameKey);
  }
  assert.deepEqual(coverage, additions.coverage);
  return { verified: true, sources: additions.sources.length, units: additions.units.length };
}

function apply() {
  const writes = new Map();
  const put = (file, value, pretty = false) => writes.set(file, JSON.stringify(value, null, pretty ? 2 : undefined) + '\n');
  const manifest = read('docs/database/manifest.json');
  const roster = read('docs/roster-audit.json');
  const names = read('public/vehicle-names.json');
  const version = read('config/data-version.json');
  const metadata = { version: additions.version, commit: additions.commit, ids: additions.units.map(c => c.id),
    provenance: 'config/game-roster-additions.json', fullSnapshotUpgrade: false };
  assert(!manifest.game_additions, 'Additions already applied; review before replacing');
  for (const c of additions.units) {
    const unit = makeUnit(c);
    const file = `database/${c.country}/${c.country}_${c.type}.json`;
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), fs.readFileSync(path.join(root, 'docs', file), 'utf8'), 'Mirror differs');
    const tree = read('docs/' + file);
    assert(!wikiUnits(tree).has(c.id), 'Vehicle already exists');
    const rank = tree.find(row => row.rank === unit.rank);
    assert(rank && Array.isArray(rank.premium_vehicles), 'Missing special-vehicle section');
    // Append a separate special column: no invented research edge or Wiki placement.
    rank.premium_vehicles.push([unit]);
    const bytes = JSON.stringify(tree, null, 2) + '\n';
    writes.set(file, bytes); writes.set('docs/' + file, bytes);
    const entry = manifest.files.find(row => row.path === file);
    assert(entry);
    entry.units++;
    entry.sha256 = sha(bytes);
    entry.game_added = [c.id];
    const audit = roster.trees[`${c.country}/${c.type}`];
    assert(!audit.units[c.id] && !audit.candidates.some(row => row.id.toLowerCase() === c.id));
    audit.snapshotSha256 = entry.sha256;
    audit.gameOnlyCount = 1;
    audit.matched++;
    audit.units[c.id] = { title: unit.title, category: c.premium ? 'premium-special' : 'event',
      matched: true, hidden: true, evidence: c.shop, gameSource: metadata,
      acquisition: { type: c.premium ? 'special' : 'event', channel: c.acquisition.type,
        provenance: { kind: 'official-announcement', url: c.acquisition.url, gameDataCommit: additions.commit } } };
    if (c.premium) roster.acquisitionCounts.special++;
    assert(!names.names[c.id], 'Existing localization must not be overwritten');
    names.names[c.id] = c.names; names.keys[c.id] = c.nameKey;
  }
  const count = additions.units.length;
  manifest.unit_count += count; manifest.unique_units += count; manifest.game_additions = metadata;
  names.count += count;
  for (const [locale, coverage] of Object.entries(additions.coverage.languages)) {
    for (const [key, value] of Object.entries(coverage)) names.coverage.languages[locale][key] += value;
  }
  names.partialSources = [{ ...metadata, source: additions.sources.find(s => s.file.endsWith('/units.csv')) }];
  version.vehicleCount += count;
  version.rosterAddition = metadata;
  put('docs/database/manifest.json', manifest, true);
  put('config/data-version.json', version, true);
  for (const base of ['public', 'docs']) {
    put(`${base}/roster-audit.json`, roster);
    put(`${base}/vehicle-names.json`, names);
  }
  if (!process.argv.includes('--apply')) return console.log(JSON.stringify({dryRun:true, files:[...writes.keys()], ids:metadata.ids}));
  // Validate every input before writing either runtime mirror.
  for (const [file, bytes] of writes) fs.writeFileSync(path.join(root, file), bytes);
  console.log(JSON.stringify({applied:true, files:writes.size, ids:metadata.ids}));
}
if (require.main === module) {
  if (process.argv.includes('--apply') || process.argv.includes('--verify')) {
    const option = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
    console.log(JSON.stringify(verifySources(option('--source-dir'), option('--review-dir'))));
  }
  if (!process.argv.includes('--verify')) apply();
}
module.exports = { makeUnit, battleRating, verifySources };
