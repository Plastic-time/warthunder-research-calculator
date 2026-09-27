function normalizeRequirements(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(normalizeRequirements);
  if (typeof value === 'string') return [value];
  throw new Error('Unsupported game prerequisite field; review before importing');
}

function gameRequirements(gameMod, visibleIds) {
  if (!gameMod || typeof gameMod !== 'object') throw new Error('Missing game modification; prerequisite review required');
  const ids = new Map([...visibleIds].map(id => [id.toLowerCase(), id]));
  // prevModification orders the game UI; only reqModification is a prerequisite.
  return [...new Set(normalizeRequirements(gameMod.reqModification).map(id => {
    const visible = ids.get(id.toLowerCase());
    if (!visible) throw new Error('Game prerequisite is absent from the visible modification tree: ' + id);
    return visible;
  }))];
}

module.exports = { gameRequirements };
