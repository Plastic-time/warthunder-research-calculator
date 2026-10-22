const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { gameRequirements } = require('./modification-requirements.cjs');
const numeric = value => Number.isSafeInteger(value) && value >= 0;

function protectModifications(previous, presentation, economy, protectedCorrection = false) {
  assert(previous && typeof previous.i === 'string' && Array.isArray(previous.m), 'Invalid reviewed vehicle');
  const ids = new Set(previous.m.map(mod => mod[0]));
  assert.equal(ids.size, previous.m.length, 'Duplicate reviewed modification');
  const result = structuredClone(previous);
  const report = { id: previous.i, protectedCorrection, conflicts: [], unverified: [], updated: [], requiresReview: false };
  const conflict = (id, field, before, incoming) => report.conflicts.push({ id, field, before, incoming });
  const gameEntries = Object.entries(economy?.modifications || {});
  const game = new Map(gameEntries.map(([id, mod]) => [id.toLowerCase(), mod]));
  assert.equal(game.size, gameEntries.length, 'Ambiguous game modification IDs');
  const known = new Set([...ids].map(id => id.toLowerCase()));
  for (const [id, mod] of gameEntries) {
    if (Number.isInteger(mod.tier) && mod.tier >= 1 && mod.tier <= 4 && !known.has(id.toLowerCase())) {
      conflict(id, 'new-game-entry', null, { tier: mod.tier });
    }
  }
  for (const mod of previous.m) {
    const source = game.get(mod[0].toLowerCase());
    if (!source) { report.unverified.push({ id: mod[0], field: 'game-entry' }); continue; }
    for (const [field, index] of [['tier', 2], ['reqExp', 7], ['value', 8]]) {
      if (!numeric(source[field]) || (field === 'tier' && (source[field] < 1 || source[field] > 4))) {
        report.unverified.push({ id: mod[0], field });
      } else if (source[field] !== mod[index]) conflict(mod[0], field, mod[index], source[field]);
    }
    try {
      const required = gameRequirements(source, ids);
      if (!isDeepStrictEqual([...required].sort(), [...mod[10]].sort())) conflict(mod[0], 'requires', mod[10], required);
    } catch { report.unverified.push({ id: mod[0], field: 'requires' }); }
  }
  for (let index = 0; index < 3; index++) {
    const field = `needBuyToOpenNextInTier${index + 1}`;
    if (!numeric(economy?.[field])) report.unverified.push({ field });
    else if (economy[field] !== previous.r[index]) conflict(previous.i, field, previous.r[index], economy[field]);
  }
  if (!presentation) report.unverified.push({ field: 'wiki-presentation' });
  const candidates = new Map();
  for (const candidate of presentation || []) {
    assert(candidate && typeof candidate.id === 'string' && !candidates.has(candidate.id), 'Duplicate/invalid Wiki modification');
    candidates.set(candidate.id, candidate);
    if (!ids.has(candidate.id)) conflict(candidate.id, 'wiki-only-entry', null, 'not imported');
  }
  for (const id of ids) if (!candidates.has(id)) report.unverified.push({ id, field: 'wiki-entry' });
  report.requiresReview = !!(report.conflicts.length || report.unverified.length);
  // Never blend uncertain or manually corrected vehicles with newly scraped metadata.
  if (protectedCorrection || report.requiresReview) return { vehicle: result, report };
  for (const mod of result.m) {
    const candidate = candidates.get(mod[0]);
    if (!candidate) continue;
    for (const [field, index] of [['en', 5], ['icon', 6]]) {
      const value = candidate[field];
      const valid = typeof value === 'string' && value.trim() && value.length <= 200
        && (field !== 'icon' || /^[a-z0-9_-]+\.png$/i.test(value));
      if (valid && value !== mod[index]) {
        report.updated.push({ id: mod[0], field });
        mod[index] = value;
      }
    }
  }
  return { vehicle: result, report };
}

module.exports = { protectModifications };
