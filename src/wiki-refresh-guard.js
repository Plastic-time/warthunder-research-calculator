const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");
const { createHash } = require("node:crypto");

const presentationFields = ["title", "vehicle_icon", "main_role"];
const protectedFields = ["rp", "sp", "br", "rank", "required_unit_id", "class_name",
  "is_premium", "is_squadron", "is_component", "component_of", "research_country"];
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function indexTree(tree) {
  assert(Array.isArray(tree), "A previously reviewed tree is required");
  const nodes = new Map();
  const ranks = new Map();
  for (const rank of tree) {
    assert(typeof rank.rank === "string" && rank.rank && !ranks.has(rank.rank), "Invalid or duplicate rank");
    ranks.set(rank.rank, rank);
    for (const section of ["researchable_vehicles", "premium_vehicles"]) {
      assert(rank[section] === undefined || Array.isArray(rank[section]), "Invalid tree section");
      for (const [columnIndex, column] of (rank[section] || []).entries()) {
        assert(Array.isArray(column), "Invalid tree column");
        function add(node, position) {
          assert(node && ["single", "multiple"].includes(node.type), "Invalid tree node");
          assert(typeof node.data_unit_id === "string" && /^[a-z0-9_-]{1,160}$/i.test(node.data_unit_id), "Invalid unit ID");
          // Some multi-part vehicles use the same ID for a folder and its basic unit.
          const key = `${node.type}:${node.data_unit_id}`;
          assert(!nodes.has(key), `Duplicate tree node: ${key}`);
          nodes.set(key, { node, position: { rank: rank.rank, section, column: columnIndex, ...position } });
        }
        for (const [order, node] of column.entries()) {
          add(node, { order, folder: null });
          if (node.type === "multiple") {
            assert(Array.isArray(node.items), "Invalid folder members");
            node.items.forEach((item, childOrder) => {
              assert(item.type === "single", "Invalid folder child");
              add(item, { order: childOrder, folder: node.data_unit_id });
            });
          }
        }
      }
    }
  }
  return { nodes, ranks };
}

function comparableCost(value) {
  if (typeof value === "string" && /^\d[\d, ]*$/.test(value.trim())) return Number(value.replace(/[, ]/g, ""));
  return value;
}

function validPresentation(field, value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return false;
  if (field !== "vehicle_icon") return value.length <= 300;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["static.encyclopedia.warthunder.com", "wiki.warthunder.com"].includes(url.hostname);
  } catch { return false; }
}

function protectWikiTree(previous, candidate) {
  const tree = structuredClone(previous);
  const existing = indexTree(tree);
  const incoming = indexTree(candidate);
  const report = {
    policy: "wiki-presentation-only", baselineSha256: hash(previous), candidateSha256: hash(candidate),
    updated: [], conflicts: [], added: [], missing: [], rejectedPresentation: [],
  };
  for (const [key, { node, position }] of existing.nodes) {
    const next = incoming.nodes.get(key);
    if (!next) { report.missing.push(key); continue; }
    if (!isDeepStrictEqual(position, next.position)) {
      report.conflicts.push({ node: key, field: "position", retained: position, observed: next.position });
    }
    for (const field of protectedFields) {
      if (!Object.hasOwn(next.node, field)) continue;
      const comparable = field === "rp" || field === "sp" ? comparableCost : value => value;
      if (!isDeepStrictEqual(comparable(node[field]), comparable(next.node[field]))) {
        report.conflicts.push({ node: key, field, retained: node[field] ?? null, observed: next.node[field] });
      }
    }
    for (const field of presentationFields) {
      if (!Object.hasOwn(next.node, field) || next.node[field] === node[field]) continue;
      if (!validPresentation(field, next.node[field])) {
        report.rejectedPresentation.push({ node: key, field });
        continue;
      }
      node[field] = next.node[field];
      report.updated.push({ node: key, field });
    }
  }
  for (const key of incoming.nodes.keys()) if (!existing.nodes.has(key)) report.added.push(key);
  for (const [rank, row] of incoming.ranks) {
    const old = existing.ranks.get(rank);
    if (!old || !isDeepStrictEqual(old.unlock_quantity, row.unlock_quantity)) {
      report.conflicts.push({ rank, field: "unlock_quantity", retained: old?.unlock_quantity ?? null, observed: row.unlock_quantity ?? null });
    }
  }
  for (const rank of existing.ranks.keys()) {
    if (!incoming.ranks.has(rank)) report.conflicts.push({ rank, field: "rank", retained: rank, observed: null });
  }
  report.requiresReview = !!(report.conflicts.length || report.added.length || report.missing.length || report.rejectedPresentation.length);
  report.resultSha256 = hash(tree);
  return { tree, report };
}

module.exports = { protectWikiTree };
