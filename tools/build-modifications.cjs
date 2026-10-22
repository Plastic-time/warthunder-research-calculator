const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { modificationIcon } = require('./modification-icons.cjs');
const { protectModifications } = require('./modification-refresh-guard.cjs');

const root = path.resolve(__dirname, '..');
const sha = content => crypto.createHash('sha256').update(content).digest('hex');

function loadPinnedEconomy(directory) {
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'sources.json'), 'utf8'));
  assert(/^[a-f0-9]{40}$/.test(metadata.upstream?.commit), 'A pinned game revision is required');
  assert(/^\d+\.\d+\.\d+\.\d+$/.test(metadata.upstream?.version), 'A game version is required');
  const file = 'char.vromfs.bin_u/config/wpcost.blkx';
  const entries = metadata.sources.filter(source => source.label === 'current' && source.file === file);
  assert.equal(entries.length, 1, 'A unique economy source is required');
  const source = entries[0];
  assert.equal(source.commit, metadata.upstream.commit);
  assert.equal(source.url, `https://raw.githubusercontent.com/gszabi99/War-Thunder-Datamine/${source.commit}/${file}`);
  const bytes = fs.readFileSync(path.join(directory, 'current-wpcost.json'));
  assert.equal(bytes.length, source.bytes, 'Economy source size mismatch');
  assert.equal(sha(bytes), source.sha256, 'Economy source hash mismatch');
  return { economy: JSON.parse(bytes), provenance: { ...metadata.upstream, sha256: source.sha256 } };
}

function parsePresentation(html, chunk) {
  const $ = cheerio.load(html);
  const result = [];
  $('.game-unit_mods-table .game-unit_mod').each((_, element) => {
    const button = $(element);
    const id = button.attr('data-mod-id');
    if (!id) return;
    const popover = cheerio.load(button.attr('data-feature-popover') || '');
    const en = popover('.game-unit_popover-header span').first().text().replace(/\s+/g, ' ').trim();
    // Prices, tier positions, prerequisites and Wiki membership are never imported.
    result.push({ id, en, icon: modificationIcon(chunk, popover) });
  });
  return result.length ? result : null;
}

function replaceFile(file, content) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function runRefresh(options = {}) {
  const directory = options.root || root;
  assert(options.sourceDirectory, 'Usage: node tools/build-modifications.cjs --source-dir <pinned-review-directory> [--wiki-dir <directory>] [--apply]');
  const { economy, provenance } = loadPinnedEconomy(options.sourceDirectory);
  const game = new Map(Object.entries(economy).map(([id, entry]) => [id.toLowerCase(), entry]));
  assert.equal(game.size, Object.keys(economy).length, 'Ambiguous game vehicle IDs');
  const wikiDirectory = options.wikiDirectory || path.join(directory, 'logs/wiki-refresh/units');
  const catalogPath = 'database/modifications/catalog.json';
  const original = fs.readFileSync(path.join(directory, 'docs', catalogPath));
  assert(original.equals(fs.readFileSync(path.join(directory, 'public', catalogPath))), 'Catalog copies differ');
  const catalog = JSON.parse(original);
  assert.equal(catalog.schema, 2);
  const changes = [];
  const reviewed = [];
  const snapshots = new Map();
  const seen = new Set();
  const reportPath = path.join(directory, 'logs/modifications-refresh-review.json');
  const remember = (relative, before, after) => {
    for (const side of ['docs', 'public']) {
      const target = path.join(directory, side, relative);
      assert(before.equals(fs.readFileSync(target)), 'Snapshot copies differ: ' + relative);
      snapshots.set(target, before);
      if (!before.equals(after)) changes.push({ target, before, after });
    }
  };
  for (const [key, meta] of Object.entries(catalog.chunks)) {
    assert(/^[a-z]+_[a-z]+$/.test(key) && meta.path === `database/modifications/${key}.json`, 'Invalid chunk path');
    const bytes = fs.readFileSync(path.join(directory, 'docs', meta.path));
    assert.equal(bytes.length, meta.bytes, 'Chunk size mismatch');
    assert.equal(sha(bytes), meta.sha256, 'Chunk checksum mismatch');
    const chunk = JSON.parse(bytes);
    assert.equal(chunk.k, key);
    assert.equal(chunk.s, 2);
    let changed = false;
    for (const [id, vehicle] of Object.entries(chunk.v)) {
      assert(/^[a-z0-9_-]+$/i.test(id) && vehicle.i === id && !seen.has(id), 'Invalid/duplicate vehicle ID');
      assert.equal(catalog.vehicles[id], key, 'Catalog membership mismatch');
      seen.add(id);
      const wikiFile = path.join(wikiDirectory, id + '.html');
      const presentation = fs.existsSync(wikiFile) ? parsePresentation(fs.readFileSync(wikiFile, 'utf8'), key) : null;
      const result = protectModifications(vehicle, presentation, game.get(id.toLowerCase()), Object.hasOwn(catalog.corrections || {}, id));
      reviewed.push(result.report);
      if (result.report.updated.length) { chunk.v[id] = result.vehicle; changed = true; }
    }
    const after = changed ? Buffer.from(JSON.stringify(chunk) + '\n') : bytes;
    meta.sha256 = sha(after);
    meta.bytes = after.length;
    remember(meta.path, bytes, after);
  }
  assert.equal(seen.size, Object.keys(catalog.vehicles).length, 'Incomplete catalog');
  const report = { policy: 'reviewed-modifications-preserved', checkedAt: new Date().toISOString(),
    source: provenance, applied: false, gameplayChanged: false,
    requiresReview: reviewed.some(item => item.requiresReview), vehicles: reviewed, changedFiles: changes.length };
  if (changes.length) catalog.presentationRefresh = { checkedAt: report.checkedAt, source: provenance, gameplayChanged: false };
  // Preserve existing version, corrections, source identity and unchanged bytes.
  remember(catalogPath, original, changes.length ? Buffer.from(JSON.stringify(catalog) + '\n') : original);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  replaceFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  if (!options.apply) return report;
  for (const [file, before] of snapshots) assert(before.equals(fs.readFileSync(file)), 'Snapshot changed during review');
  const written = [];
  try {
    for (const change of changes) {
      replaceFile(change.target, change.after);
      written.push(change);
    }
    report.applied = true;
    replaceFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    const rollback = [];
    for (const change of written.reverse()) {
      try { replaceFile(change.target, change.before); } catch (failure) { rollback.push(failure); }
    }
    if (rollback.length) throw new AggregateError([error, ...rollback], 'Modification refresh rollback incomplete; do not publish');
    throw error;
  }
  return report;
}

function refreshModifications(options = {}) {
  try { return runRefresh(options); }
  catch (error) {
    const reportPath = path.join(options.root || root, 'logs/modifications-refresh-review.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({ status: 'failed', checkedAt: new Date().toISOString(),
      applied: false, requiresReview: true, rollbackIncomplete: error instanceof AggregateError }, null, 2) + '\n');
    throw error;
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    while (args.length) {
      const flag = args.shift();
      if (flag === '--apply') options.apply = true;
      else if (['--source-dir', '--wiki-dir'].includes(flag)) {
        const value = args.shift();
        assert(value && !value.startsWith('--'), 'Missing directory argument');
        options[flag === '--source-dir' ? 'sourceDirectory' : 'wikiDirectory'] = path.resolve(value);
      } else throw new Error('Unknown argument: ' + flag);
    }
    const report = refreshModifications(options);
    console.log(JSON.stringify({ ...report, vehicles: { total: report.vehicles.length,
      requiringReview: report.vehicles.filter(v => v.requiresReview).length,
      protected: report.vehicles.filter(v => v.protectedCorrection).length } }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { loadPinnedEconomy, parsePresentation, refreshModifications };
