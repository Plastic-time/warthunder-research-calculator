// Reconstruct the preceding snapshot for the repository's historical integrity checks.
const previous = require('./fixtures/roster-before-26142.json');
const added = new Set(previous.ids);

function indexNodes(tree) {
  const nodes = new Map();
  for (const rank of tree) for (const section of ['researchable_vehicles', 'premium_vehicles']) {
    for (const item of (rank[section] || []).flat()) {
      nodes.set(item.type + ':' + item.data_unit_id, item);
      for (const child of item.items || []) nodes.set('single:' + child.data_unit_id, child);
    }
  }
  return nodes;
}

function restoreTree(value) {
  const tree = structuredClone(value);
  const nodes = indexNodes(tree);
  const entry = previous.trees.find(t => nodes.has('single:' + t.anchorId));
  if (!entry) return tree;
  for (const [key, fields] of Object.entries(entry.fields)) {
    Object.assign(nodes.get(key), fields);
  }
  for (const [key, fields] of Object.entries(entry.removeFields)) {
    for (const field of fields) delete nodes.get(key)[field];
  }
  const single = id => nodes.get('single:' + id);
  for (const { rank, section, columns } of entry.sections) {
    tree.find(row => row.rank === rank)[section] = columns.map(column => column.map(item =>
      typeof item === 'string' ? single(item) : { ...item, items: item.items.map(single) }));
  }
  return tree.filter(row => !entry.newRanks.includes(row.rank));
}

function restoreManifest(value) {
  const copy = structuredClone(value);
  if (!copy.rosterUpdate) return copy;
  delete copy.rosterUpdate;
  copy.unit_count -= added.size;
  copy.unique_units -= added.size;
  for (const entry of copy.files) Object.assign(entry, previous.manifest[entry.path]);
  return copy;
}

function restoreRoster(value) {
  const copy = structuredClone(value);
  if (!copy.rosterUpdate) return copy;
  delete copy.rosterUpdate;
  copy.acquisitionCounts = structuredClone(previous.acquisitionCounts);
  for (const [key, changes] of Object.entries(previous.audit)) {
    const tree = copy.trees[key];
    tree.matched -= changes.ids.length;
    for (const id of changes.ids) delete tree.units[id];
    if (changes.gameOnlyCount == null) delete tree.gameOnlyCount;
    else tree.gameOnlyCount = changes.gameOnlyCount;
    for (const [index, candidate] of changes.candidates) tree.candidates.splice(index, 0, candidate);
  }
  return copy;
}

function restoreCatalog(value) {
  const copy = structuredClone(value);
  if (!copy.rosterUpdate) return copy;
  delete copy.rosterUpdate;
  for (const id of added) delete copy.vehicles[id];
  for (const [key, meta] of Object.entries(previous.chunks)) {
    if (meta === null) delete copy.chunks[key];
    else copy.chunks[key] = structuredClone(meta);
  }
  copy.stats = structuredClone(previous.catalogStats);
  return copy;
}

function restoreChunk(value) {
  const copy = structuredClone(value);
  for (const id of added) delete copy.v[id];
  return copy;
}

module.exports = { indexNodes, restoreTree, restoreManifest, restoreRoster, restoreCatalog, restoreChunk };
