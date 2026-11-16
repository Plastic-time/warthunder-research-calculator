const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { setTimeout: sleep } = require('node:timers/promises');
const { parseWikiDetail } = require('../src/wiki-snapshot');
const { shopUnits, wikiUnits } = require('./audit-datamine-roster.cjs');

const root = path.resolve(__dirname, '..');
const countries = ['usa', 'germany', 'ussr', 'britain', 'japan', 'china', 'italy', 'france', 'sweden', 'israel'];
const types = ['ground', 'aviation', 'helicopters', 'ships', 'boats'];
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const number = text => text == null ? null : /^free$/i.test(text) ? 0
  : /^\d[\d,\s]*$/.test(text) ? Number(text.replace(/[,\s]/g, '')) : null;
const finite = value => Number.isFinite(value) && value >= 0 ? value : null;
const category = unit => unit?.is_component ? 'component' : unit?.is_squadron ? 'squadron'
  : unit?.is_premium ? 'premium' : 'standard';

function compareCosts(wiki, game, local) {
  const issues = [];
  const kind = category(wiki);
  const raw = { rp: number(wiki.wiki.research), sl: wiki.wiki.purchase_currency === 'SL' ? number(wiki.wiki.purchase) : null };
  const excluded = kind !== 'standard';
  if (local) {
    if (category(local) !== kind) issues.push({ kind: 'category_changed', before: category(local), after: kind });
    for (const field of ['rp', 'sp']) {
      if (local[field] !== wiki[field]) issues.push({ kind: 'local_wiki_difference', field, local: local[field] ?? null, wiki: wiki[field] });
    }
  }
  if (!game) issues.push({ kind: 'missing_game_entry' });
  const gameCosts = { rp: finite(game?.reqExp), sl: finite(game?.value) };
  // Premium internal reqExp and component placeholders are not ordinary research prices.
  if (game && !['premium', 'component'].includes(kind)) {
    for (const field of ['rp', 'sl']) {
      if (raw[field] === null) issues.push({ kind: 'wiki_missing_cost', field });
      if (gameCosts[field] === null) {
        const reserveOmission = kind === 'standard' && field === 'rp' && wiki.wiki.research === 'Free'
          && wiki.wiki.purchase === 'Free' && game.value === 0 && !Object.hasOwn(game, 'reqExp');
        issues.push({ kind: reserveOmission ? 'free_vehicle_omitted_reqExp' : 'game_missing_cost', field });
      } else if (raw[field] !== null && raw[field] !== gameCosts[field]) {
        issues.push({ kind: 'wiki_game_difference', field, wiki: raw[field], game: gameCosts[field] });
      }
    }
  }
  return { category: kind, excludedFromOrdinaryTotals: excluded, wikiCosts: raw, gameCosts, issues };
}

function protectedFiles() {
  const files = {};
  function walk(relative) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).isDirectory()) {
      for (const entry of fs.readdirSync(file).sort()) walk(relative + '/' + entry);
    } else files[relative] = hash(fs.readFileSync(file));
  }
  for (const relative of ['database', 'docs', 'public', 'dict', 'src', 'config', '.github', 'main.js', 'README.md', 'README.zh-CN.md', 'package.json', 'package-lock.json']) walk(relative);
  return files;
}

async function request(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'K13shot-CostAudit/1.0 (read-only; bounded requests)' } });
      if (!response.ok) {
        const error = Object.assign(new Error('HTTP ' + response.status), { status: response.status });
        if (response.status === 429) error.retryAfter = Math.min(60000, Math.max(5000, Number(response.headers.get('retry-after')) * 1000 || 10000));
        throw error;
      }
      return { body: Buffer.from(await response.arrayBuffer()), fetchedAt: new Date().toISOString() };
    } catch (error) {
      if (attempt === 2 || [403, 404].includes(error.status)) throw error;
      await sleep(error.retryAfter || 1500 * 2 ** attempt);
    }
  }
}

async function audit() {
  const startedAt = new Date().toISOString();
  const output = path.join(root, 'logs/cost-audit', startedAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const baseline = protectedFiles();
  const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
  save('protected-files.json', baseline);
  const commitResponse = await request('https://api.github.com/repos/gszabi99/War-Thunder-Datamine/commits/master');
  const commit = JSON.parse(commitResponse.body);
  assert.match(commit.sha, /^[0-9a-f]{40}$/);
  const rawBase = 'https://raw.githubusercontent.com/gszabi99/War-Thunder-Datamine/' + commit.sha + '/';
  const source = { commit: commit.sha, committedAt: commit.commit.committer.date, message: commit.commit.message, files: {} };
  for (const file of ['version', 'char.vromfs.bin_u/config/wpcost.blkx', 'char.vromfs.bin_u/config/shop.blkx']) {
    const result = await request(rawBase + file);
    const name = path.basename(file);
    fs.writeFileSync(path.join(output, name), result.body);
    source.files[name] = { url: rawBase + file, sha256: hash(result.body), fetchedAt: result.fetchedAt };
  }
  source.version = fs.readFileSync(path.join(output, 'version'), 'utf8').trim();
  save('sources.json', source);
  const economy = new Map(Object.entries(read(path.join(output, 'wpcost.blkx'))).map(([id, unit]) => [id.toLowerCase(), unit]));
  const shop = read(path.join(output, 'shop.blkx'));
  const desktop = new Map(), web = new Map(), treeReport = [], live = new Map(), localDifferences = [];
  for (const type of types) {
    const result = await request('https://wiki.warthunder.com/' + type + '?v=t');
    const html = result.body.toString('utf8');
    fs.writeFileSync(path.join(output, type + '.html'), html);
    const $ = cheerio.load(html);
    assert($('.unit-tree[data-tree-id]').length >= 5, 'Incomplete Wiki tree page: ' + type);
    for (const country of countries) {
      const treeKey = country + '/' + type;
      const file = `database/${country}/${country}_${type}.json`;
      const localWeb = wikiUnits(read(path.join(root, 'docs', file)));
      const localDesktop = wikiUnits(read(path.join(root, file)));
      for (const [id, unit] of localWeb) { assert(!web.has(id)); web.set(id, { unit, tree: treeKey }); }
      for (const [id, unit] of localDesktop) { assert(!desktop.has(id)); desktop.set(id, { unit, tree: treeKey }); }
      for (const id of new Set([...localWeb.keys(), ...localDesktop.keys()])) {
        const a = localWeb.get(id), b = localDesktop.get(id);
        if (!a || !b || a.rp !== b.rp || a.sp !== b.sp || category(a) !== category(b)) localDifferences.push({ id, tree: treeKey,
          web: a ? { rp: a.rp, sl: a.sp, category: category(a) } : null,
          desktop: b ? { rp: b.rp, sl: b.sp, category: category(b) } : null });
      }
      const tree = $(`.unit-tree[data-tree-id="${country}"]`);
      const absentAllowed = ['ships', 'boats'].includes(type) && ['china', 'sweden', 'israel'].includes(country);
      assert(tree.length === 1 || (tree.length === 0 && absentAllowed), 'Missing or duplicate tree: ' + treeKey);
      const ids = new Set();
      tree.find('a.wt-tree_item-link').each((_, element) => {
        const href = $(element).attr('href');
        assert.match(href, /^\/unit\/[a-z0-9_-]+$/i);
        const id = href.slice('/unit/'.length).toLowerCase();
        ids.add(id);
        const title = $(element).closest('.wt-tree_item').find('.wt-tree_item-text span').first().text().replace(/\s+/g, ' ').trim();
        if (live.has(id)) assert.equal(live.get(id).tree, treeKey, 'Duplicate unit across trees');
        live.set(id, { tree: treeKey, title });
      });
      const game = shopUnits(shop['country_' + country]?.[type === 'ground' ? 'army' : type]);
      treeReport.push({ tree: treeKey, fetchedAt: result.fetchedAt, sha256: hash(result.body), wikiCount: ids.size, localCount: localWeb.size,
        added: [...ids].filter(id => !localWeb.has(id)), absentFromLiveWiki: [...localWeb.keys()].filter(id => !ids.has(id)),
        gameOnlyCandidates: [...game].filter(([id]) => !ids.has(id)).map(([id, flags]) => ({ id, ...flags })) });
    }
  }
  save('tree-coverage.json', treeReport);
  const ids = [...new Set([...live.keys(), ...web.keys(), ...desktop.keys()])];
  const rows = [], failures = [];
  let cursor = 0, done = 0;
  const rowsFile = path.join(output, 'rows.jsonl');
  console.log(JSON.stringify({ output: path.relative(root, output), version: source.version, commit: source.commit, total: ids.length }));
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const url = 'https://wiki.warthunder.com/unit/' + id;
        const result = await request(url);
        const html = result.body.toString('utf8');
        const detail = parseWikiDetail(html, id);
        const row = { id, title: web.get(id)?.unit.title || live.get(id)?.title || id,
          tree: live.get(id)?.tree || web.get(id)?.tree || desktop.get(id)?.tree,
          url, fetchedAt: result.fetchedAt, sha256: hash(result.body), onLiveTree: live.has(id), inCalculator: web.has(id),
          localCosts: web.has(id) ? { rp: web.get(id).unit.rp, sl: web.get(id).unit.sp } : null,
          wikiRaw: detail.wiki, ...compareCosts(detail, economy.get(id), web.get(id)?.unit) };
        rows.push(row);
        fs.appendFileSync(rowsFile, JSON.stringify(row) + '\n');
        if (row.issues.some(issue => !['free_vehicle_omitted_reqExp'].includes(issue.kind)) || !row.inCalculator) {
          const evidenceDir = path.join(output, 'evidence');
          fs.mkdirSync(evidenceDir, { recursive: true });
          fs.writeFileSync(path.join(evidenceDir, id + '.html'), html);
        }
      } catch (error) {
        const failure = { id, status: error.status || null, message: error.message };
        failures.push(failure);
        fs.appendFileSync(path.join(output, 'failures.jsonl'), JSON.stringify(failure) + '\n');
      }
      done++;
      if (done % 100 === 0 || done === ids.length) console.log(`${done}/${ids.length}; failures=${failures.length}`);
      await sleep(150);
    }
  }));
  rows.sort((a, b) => a.tree.localeCompare(b.tree) || a.id.localeCompare(b.id));
  const kinds = {};
  for (const row of rows) for (const issue of row.issues) kinds[issue.kind] = (kinds[issue.kind] || 0) + 1;
  const unchanged = JSON.stringify(protectedFiles()) === JSON.stringify(baseline);
  const summary = { startedAt, finishedAt: new Date().toISOString(), source, requested: ids.length, verified: rows.length,
    failures: failures.length, localWebDesktopRawUnitDifferences: localDifferences.length, issuesByKind: kinds,
    localComparisonNote: 'Raw file differences include string/number representations and missing fields; these are not verified runtime price errors.',
    categories: Object.fromEntries(['standard', 'squadron', 'premium', 'component'].map(kind => [kind, rows.filter(row => row.category === kind).length])),
    addedToWiki: treeReport.reduce((sum, tree) => sum + tree.added.length, 0),
    absentFromLiveWiki: treeReport.reduce((sum, tree) => sum + tree.absentFromLiveWiki.length, 0),
    gameOnlyCandidates: treeReport.reduce((sum, tree) => sum + tree.gameOnlyCandidates.length, 0),
    protectedFilesUnchanged: unchanged, applied: false };
  save('report.json', { summary, failures, localDifferences, trees: treeReport, rows });
  save('summary.json', summary);
  const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  const csv = [['tree', 'id', 'category', 'local_rp', 'local_sl', 'wiki_rp', 'wiki_sl', 'game_reqExp', 'game_value', 'issues', 'wiki_url'],
    ...rows.filter(row => row.issues.length || !row.inCalculator).map(row => [row.tree, row.id, row.category, row.localCosts?.rp,
      row.localCosts?.sl, row.wikiCosts.rp, row.wikiCosts.sl, row.gameCosts.rp, row.gameCosts.sl,
      row.issues.map(issue => issue.kind + (issue.field ? ':' + issue.field : '')).join(';'), row.url])];
  fs.writeFileSync(path.join(output, 'differences.csv'), '\uFEFF' + csv.map(row => row.map(quote).join(',')).join('\r\n'));
  console.log(JSON.stringify(summary, null, 2));
  assert(unchanged, 'Application files changed during audit; inspect separately');
  if (failures.length) process.exitCode = 2;
}

if (require.main === module) audit().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { compareCosts, number };
