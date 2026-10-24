const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { parseWikiDetail } = require('../src/wiki-snapshot');
const { wikiUnits } = require('./audit-datamine-roster.cjs');
const review = require('./fixtures/roster-candidate-review-20261024.json');
const delta = require('./fixtures/game-data-review-2.59.0.86.json');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));

test('candidate review retains the exact pinned source identity and all four deferred IDs', () => {
  assert.equal(review.schema, 1);
  assert.equal(review.game.commit, delta.upstream.commit);
  assert.equal(review.game.version, delta.upstream.version);
  assert.deepEqual(review.candidates.map(c => c.id).sort(), delta.deferredRosterEntries.map(c => c.id).sort());
  assert.equal(review.game.sources.length, 2);
  for (const source of review.game.sources) {
    assert.deepEqual(source, delta.sources.find(s => s.label === 'current' && s.file === source.file));
  }
});

test('missing Wiki pages are distinct from valid pictures and successful tree requests', () => {
  for (const candidate of review.candidates) {
    assert.equal(candidate.wiki.status, 404);
    assert.equal(candidate.wiki.url, 'https://wiki.warthunder.com/unit/' + candidate.id);
    assert.equal(candidate.wiki.detailCards, 0);
    assert.equal(candidate.wiki.modifications, 0);
    assert.equal(candidate.wiki.treeMatches, 0);
    const tree = review.trees.find(tree => tree.name === candidate.type);
    assert.equal(tree.status, 200);
    assert.deepEqual(tree.treeIds, []);
    assert.equal(candidate.image.status, 200);
    assert.equal(candidate.image.contentType, 'image/png');
    assert(candidate.image.pngSignature);
    assert.equal(candidate.image.url, 'https://static.encyclopedia.warthunder.com/slots/' + candidate.id + '.png');
    for (const source of [candidate.wiki, candidate.image, tree]) {
      assert.match(source.sha256, /^[a-f0-9]{64}$/);
      assert(Number.isFinite(Date.parse(source.fetchedAt || source.checkedAt)));
    }
    assert.equal(candidate.decision, 'defer');
  }
});

test('official reward channels do not become GE purchases or ordinary research prices', () => {
  const byId = Object.fromEntries(review.candidates.map(c => [c.id, c]));
  assert.equal(byId['bf-109e-3_tl'].acquisition, 'twitch-drops');
  assert.equal(byId.ussr_bt_7_m_816.acquisition, 'twitch-drops');
  for (const id of ['germ_panzerjager_panther_g2', 'germ_s_700_s_706']) {
    assert.equal(byId[id].acquisition, 'battle-pass');
    assert.equal(byId[id].season, 25);
  }
  assert.equal(byId.germ_panzerjager_panther_g2.rewardLevel, 75);
  assert.equal(byId.germ_panzerjager_panther_g2.freeReward, false);
  assert.equal(byId.germ_s_700_s_706.rewardLevel, 51);
  assert.equal(byId.germ_s_700_s_706.freeReward, true);
  for (const c of review.candidates) {
    const source = review.announcements.find(s => s.id === c.announcement);
    assert(source && source.status === 200);
    assert(['warthunder.com', 'forum.warthunder.com'].includes(new URL(source.url).hostname));
    assert.equal(c.gameFields.showOnlyWhenBought, true);
    assert.equal(c.gameFields.country, 'country_' + c.country);
    assert(!Object.hasOwn(c, 'rp') && !Object.hasOwn(c, 'sp') && !Object.hasOwn(c, 'price'));
  }
});

test('BT-7M reward is future-dated at the recorded review time, unlike the other three announcements', () => {
  const reviewedAt = Date.parse(review.checkedAt);
  for (const c of review.candidates) {
    const pending = c.id === 'ussr_bt_7_m_816';
    assert.equal(Date.parse(c.availableFrom) > reviewedAt, pending);
    assert.equal(c.blockers.includes('reward-not-started'), pending);
  }
});

test('404 and donor-vehicle pages cannot be accepted as the candidate detail page', () => {
  const missing = '<html><title>Page not found | War Thunder Wiki</title></html>';
  const donor = '<link rel="canonical" href="https://wiki.warthunder.com/unit/bf-109e-3"><div class="game-unit"></div>';
  for (const c of review.candidates) {
    assert.throws(() => parseWikiDetail(missing, c.id), /missing unit/);
    assert.throws(() => parseWikiDetail(donor, c.id), /mismatched canonical/);
  }
});

test('only separately verified game additions supersede the historical deferral; no invented modifications or NEW badges', () => {
  assert.deepEqual(review.imported, []);
  const catalog = read('docs/database/modifications/catalog.json');
  const roster = read('docs/roster-audit.json');
  const corrections = read('config/acquisition-corrections.json');
  const released = Object.values(read('config/vehicle-release.json').trees).flat();
  for (const c of review.candidates) {
    const imported = require('../config/game-roster-additions.json').units.some(entry => entry.id === c.id);
    const relative = 'database/' + c.country + '/' + c.country + '_' + c.type + '.json';
    for (const prefix of ['', 'docs/']) assert.equal(wikiUnits(read(prefix + relative)).has(c.id), imported);
    assert.equal(!!catalog.vehicles[c.id], imported);
    assert.equal(!!roster.trees[c.country + '/' + c.type].units[c.id], imported);
    assert(!corrections[c.id]);
    assert(!released.includes(c.id));
  }
  assert.equal(read('config/data-version.json').gameVersion, '2.59.0.17');
});
