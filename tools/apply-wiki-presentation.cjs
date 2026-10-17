const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { protectWikiTree } = require('../src/wiki-refresh-guard');
const { writeWikiRefreshReport } = require('../src/wiki-refresh-report');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function replaceFile(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function applyWikiPresentation(root, candidates, liveRecheck) {
  const manifestFile = path.join(root, 'docs/database/manifest.json');
  const manifestBytes = fs.readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestBytes);
  const files = new Map(manifest.files.map(entry => [entry.path, entry]));
  assert.equal(files.size, manifest.files.length, 'Duplicate snapshot entries');
  assert.equal(candidates.length, files.size, 'Incomplete Wiki candidate snapshot');
  const seen = new Set();
  const changes = [];
  const reviews = [];
  for (const { file, content } of candidates) {
    assert(/^database\/[a-z]+\/[a-z]+_[a-z]+\.json$/.test(file) && files.has(file) && !seen.has(file), 'Invalid snapshot path');
    seen.add(file);
    const target = path.join(root, 'docs', file);
    const before = fs.readFileSync(target, 'utf8');
    assert.equal(sha(before), files.get(file).sha256, `Reviewed snapshot hash mismatch: ${file}`);
    const { tree, report } = protectWikiTree(JSON.parse(before), JSON.parse(content));
    const after = JSON.stringify(tree, null, 2) + '\n';
    files.get(file).sha256 = sha(after);
    changes.push({ target, before, after });
    reviews.push({ file, ...report });
  }
  // The old game-data provenance and membership remain authoritative.
  manifest.wiki_presentation_refresh = {
    checked_at: new Date().toISOString(), policy: 'wiki-presentation-only',
    live_recheck: liveRecheck, requires_review: reviews.some(review => review.requiresReview),
  };
  changes.push({ target: manifestFile, before: manifestBytes, after: JSON.stringify(manifest, null, 2) + '\n' });
  const reportFile = path.join(root, 'logs/wiki-refresh/presentation-review.json');
  const report = { policy: 'wiki-presentation-only', applied: false, requiresReview: reviews.some(review => review.requiresReview), trees: reviews };
  writeWikiRefreshReport(reportFile, report);
  for (const change of changes) assert.equal(fs.readFileSync(change.target, 'utf8'), change.before, 'Snapshot changed during refresh');
  const written = [];
  try {
    for (const change of changes) {
      replaceFile(change.target, change.after);
      written.push(change);
    }
    writeWikiRefreshReport(reportFile, { ...report, applied: true });
  } catch (error) {
    const rollbackErrors = [];
    for (const change of written.reverse()) {
      try { replaceFile(change.target, change.before); }
      catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Snapshot update failed and rollback is incomplete; inspect the review report before publishing');
    throw error;
  }
  return manifest;
}

module.exports = { applyWikiPresentation };
