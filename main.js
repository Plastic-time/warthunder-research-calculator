require("module-alias/register");
const express = require("express");
const fs = require("fs");
const path = require("path");

const { fetchTreeHTML } = require("@/src/1-extract_tree_div");
const { extract_rank_tb } = require("@/src/2-extract_rank_tb");
const { vehicle_type, country_code } = require("@/dict/country_code");
const { get_unlock_quantity } = require("@/dict/unlock_quantity");
const shopDependencies = require("@/dict/shop_dependencies.json");
const { request_details } = require("./src/3-request_details");
const { updateTree, validateLimit } = require("./src/4-fill_tree_details");
const { createSecurity, safeError } = require("./src/server-security");

const app = express();
const security = createSecurity();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_DIR = path.join(__dirname, "database");
const PUBLIC_DIR = path.join(__dirname, "public");

const countryLabels = {
  usa: "美国",
  germany: "德国",
  ussr: "苏联",
  britain: "英国",
  japan: "日本",
  china: "中国",
  italy: "意大利",
  france: "法国",
  sweden: "瑞典",
  israel: "以色列",
};

const typeLabels = {
  ground: "陆战",
  aviation: "空战",
  helicopters: "直升机",
  ships: "远洋舰队",
  boats: "近岸舰队",
};

app.disable("x-powered-by");
app.use(security.guard);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR, { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
app.get("/api/session", security.session);

function validateTreeArgs(country, type) {
  if (!country_code.includes(country)) {
    return `Invalid country '${country}'. Supported: ${country_code.join(", ")}`;
  }
  if (!vehicle_type.includes(type)) {
    return `Invalid type '${type}'. Supported: ${vehicle_type.join(", ")}`;
  }
  return null;
}

function getTreeFile(country, type) {
  return path.join(DATABASE_DIR, country, `${country}_${type}.json`);
}

function readTree(country, type) {
  const file = getTreeFile(country, type);
  if (!fs.existsSync(file)) {
    const err = new Error(`Tree data not found: ${country}-${type}`);
    err.statusCode = 404;
    throw err;
  }

  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  const tree = Array.isArray(raw) ? raw : raw.data || [];
  return normalizeSpecialVehicleCosts(enrichTreeRanks(applyShopDependencies(tree, country, type), country, type));
}

function getUnlockQuantity(country, type, rank) {
  try {
    const value = get_unlock_quantity(country, type, rank);
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  } catch {
    return 0;
  }
}

function enrichTreeRanks(tree, country, type) {
  return tree.map((rank) => ({
    ...rank,
    unlock_quantity: parseNumber(rank.unlock_quantity) || getUnlockQuantity(country, type, rank.rank),
  }));
}

function applyShopDependencies(tree, country, type) {
  const dependencyMap = shopDependencies?.[country]?.[type]?.units || {};
  if (!Object.keys(dependencyMap).length) return tree;

  const applyItem = (item) => {
    if (item.type === "multiple") {
      const groupReq = Object.prototype.hasOwnProperty.call(dependencyMap, item.data_unit_id)
        ? dependencyMap[item.data_unit_id]
        : item.required_unit_id || "";
      return {
        ...item,
        required_unit_id: groupReq,
        items: (item.items || []).map((subItem) => applyItem(subItem)),
      };
    }

    if (Object.prototype.hasOwnProperty.call(dependencyMap, item.data_unit_id)) {
      return { ...item, required_unit_id: dependencyMap[item.data_unit_id] };
    }
    return item;
  };

  return tree.map((rank) => ({
    ...rank,
    researchable_vehicles: (rank.researchable_vehicles || []).map((column) => column.map(applyItem)),
  }));
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function getGroupMainChildId(group) {
  return (group.items || []).map((item) => item.data_unit_id).find(Boolean) || "";
}

function isFirstRankValue(rank) {
  const value = String(rank || "").trim().toLowerCase();
  return value === "i" || value === "1";
}

function getRankOrder(rank) {
  const value = String(rank || "").trim().toLowerCase();
  const roman = {
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
    vi: 6,
    vii: 7,
    viii: 8,
    ix: 9,
    x: 10,
  };
  return roman[value] || parseNumber(value) || Number.MAX_SAFE_INTEGER;
}

function getSectionOrder(section) {
  return section === "researchable" ? 0 : 1;
}

function compareUnitsByProgression(a, b) {
  return (
    getRankOrder(a.rank) - getRankOrder(b.rank) ||
    getSectionOrder(a.section) - getSectionOrder(b.section) ||
    parseNumber(a.columnIndex) - parseNumber(b.columnIndex) ||
    parseNumber(a.rowIndex) - parseNumber(b.rowIndex) ||
    String(a.title || "").localeCompare(String(b.title || ""), "zh-CN")
  );
}

function getIndexedItem(id, indexes) {
  return indexes.unitMap.get(id) || indexes.groupMap.get(id);
}

function shouldIgnoreRequirement(unit, reqId, indexes) {
  if (!unit || !reqId) return false;
  if (isFirstRankValue(unit.rank)) return true;

  const requiredItem = getIndexedItem(reqId, indexes);
  return requiredItem ? isFirstRankValue(requiredItem.rank) : false;
}

function isInitialUnlockedUnit(unit) {
  if (!unit) return false;
  const className = String(unit.class_name || "").trim().toLowerCase();
  return (
    unit.section === "researchable" &&
    isFirstRankValue(unit.rank) &&
    !["prem", "premium", "squad", "event", "gift"].includes(className) &&
    parseNumber(unit.rp) === 0 &&
    parseNumber(unit.sp) === 0
  );
}

function isSquadronUnit(unit) {
  if (!unit) return false;
  const className = String(unit.class_name || "").trim().toLowerCase();
  return unit.is_squadron === true || unit.isSquadron === true || className === "squad";
}

function normalizeSpecialVehicleCosts(tree) {
  const normalizeItem = (item) => {
    if (item.type === "multiple") {
      const isSquadronGroup = isSquadronUnit(item);
      const items = (item.items || []).map((subItem) =>
        normalizeItem({
          ...subItem,
          class_name: subItem.class_name || (isSquadronGroup ? "squad" : ""),
        })
      );
      return {
        ...item,
        is_squadron: isSquadronGroup,
        rp: isSquadronGroup ? 0 : item.rp,
        sp: isSquadronGroup ? 0 : item.sp,
        items,
      };
    }

    if (!isSquadronUnit(item)) return item;
    return { ...item, is_squadron: true, rp: 0, sp: 0 };
  };

  return tree.map((rank) => ({
    ...rank,
    researchable_vehicles: (rank.researchable_vehicles || []).map((column) => column.map(normalizeItem)),
    premium_vehicles: (rank.premium_vehicles || []).map((column) => column.map(normalizeItem)),
  }));
}

function flattenTree(tree) {
  const units = [];
  const groups = [];
  const previousByColumn = {
    researchable: [],
    premium: [],
  };
  let rankIndex = 0;

  for (const rank of normalizeSpecialVehicleCosts(tree)) {
    if (rankIndex === 1) previousByColumn.researchable = [];

    for (const section of ["researchable_vehicles", "premium_vehicles"]) {
      const sectionType = section === "premium_vehicles" ? "premium" : "researchable";
      const columns = rank[section] || [];

      columns.forEach((column, columnIndex) => {
        let previousDependencyId = previousByColumn[sectionType][columnIndex] || "";
        column.forEach((item, rowIndex) => {
          const inferredReqId = sectionType === "researchable" ? previousDependencyId : "";
          if (item.type === "multiple") {
            const groupReqId = item.required_unit_id || inferredReqId;
            const groupMainChildId = getGroupMainChildId(item);
            const group = {
              ...item,
              required_unit_id: groupReqId,
              rank: rank.rank,
              section: sectionType,
              columnIndex,
              rowIndex,
            };
            groups.push(group);

            (item.items || []).forEach((subItem, subIndex) => {
              const subReqId = subItem.required_unit_id || groupReqId;
              units.push({
                ...subItem,
                required_unit_id: subReqId,
                rank: rank.rank,
                section: sectionType,
                parent_group_id: item.data_unit_id,
                parent_group_title: item.title,
                parent_required_unit_id: groupReqId,
                columnIndex,
                rowIndex: rowIndex + subIndex / 10,
              });
            });
            if (sectionType === "researchable") {
              previousDependencyId = groupMainChildId || item.data_unit_id || previousDependencyId;
              previousByColumn[sectionType][columnIndex] = previousDependencyId;
            }
          } else if (item.type === "single") {
            units.push({
              ...item,
              required_unit_id: item.required_unit_id || inferredReqId,
              rank: rank.rank,
              section: sectionType,
              columnIndex,
              rowIndex,
            });
            if (sectionType === "researchable") {
              previousDependencyId = item.data_unit_id || previousDependencyId;
              previousByColumn[sectionType][columnIndex] = previousDependencyId;
            }
          }
        });
      });
    }
    rankIndex += 1;
  }

  return { units, groups };
}

function buildUnitIndexes(tree) {
  const { units, groups } = flattenTree(tree);
  const unitMap = new Map(units.map((unit) => [unit.data_unit_id, unit]));
  const groupMap = new Map(groups.map((group) => [group.data_unit_id, group]));
  return { units, groups, unitMap, groupMap };
}

function getDependencyIds(unitId, indexes, options = {}, visited = new Set()) {
  if (!unitId || visited.has(unitId)) return [];
  visited.add(unitId);

  const { unitMap, groupMap } = indexes;
  const unit = unitMap.get(unitId);
  if (!unit) {
    const group = groupMap.get(unitId);
    if (group) {
      const mainChildId = getGroupMainChildId(group);
      if (mainChildId && mainChildId !== unitId) return getDependencyIds(mainChildId, indexes, options, visited);
      return getDependencyIds(group.required_unit_id, indexes, options, visited);
    }

    return [];
  }

  const parentReq = unit.parent_required_unit_id && !unit.required_unit_id ? unit.parent_required_unit_id : "";
  const reqId = unit.required_unit_id || parentReq;
  const dependencyIds = shouldIgnoreRequirement(unit, reqId, indexes)
    ? []
    : getDependencyIds(reqId, indexes, options, visited);
  return [...dependencyIds, unitId];
}

function calculatePlan(tree, body = {}) {
  const indexes = buildUnitIndexes(tree);
  const owned = new Set(body.ownedIds || []);
  const targetIds = [...new Set([...(body.plannedIds || []), body.targetId].filter(Boolean))];
  const folderMode = body.folderMode === "first" ? "first" : "all";
  const dependencyMode = body.dependencyMode === "dependencies" ? "dependencies" : "selected";

  const orderedIds = [];
  const seen = new Set();
  for (const targetId of targetIds) {
    const ids = dependencyMode === "dependencies" ? getDependencyIds(targetId, indexes, { folderMode }) : [targetId];
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        orderedIds.push(id);
      }
    }
  }

  const missing = orderedIds
    .filter((id) => !owned.has(id))
    .map((id) => indexes.unitMap.get(id))
    .filter((unit) => unit && !isInitialUnlockedUnit(unit))
    .filter(Boolean)
    .sort(compareUnitsByProgression);

  const totalRp = missing.reduce((sum, unit) => sum + parseNumber(unit.rp), 0);
  const totalSp = missing.reduce((sum, unit) => sum + parseNumber(unit.sp), 0);

  return {
    total_rp: totalRp,
    raw_total_rp: totalRp,
    total_sp: totalSp,
    missing,
  };
}

app.get("/api/meta", (req, res) => {
  res.json({
    success: true,
    countries: country_code.map((code) => ({ code, label: countryLabels[code] || code })),
    types: vehicle_type.map((code) => ({ code, label: typeLabels[code] || code })),
  });
});

app.get("/healthz", (req, res) => {
  res.json({ success: true, service: "war-thunder-research-calculator" });
});

app.get("/api/tree/:country/:type", (req, res) => {
  const country = req.params.country?.toLowerCase();
  const type = req.params.type?.toLowerCase();
  const error = validateTreeArgs(country, type);
  if (error) return res.status(400).json({ success: false, error });

  try {
    const data = readTree(country, type);
    res.json({ success: true, country, type, data });
  } catch (err) {
    safeError(res, err);
  }
});

app.get("/api/tree/:country/:type/flat", (req, res) => {
  const country = req.params.country?.toLowerCase();
  const type = req.params.type?.toLowerCase();
  const error = validateTreeArgs(country, type);
  if (error) return res.status(400).json({ success: false, error });

  try {
    const data = readTree(country, type);
    const flat = flattenTree(data);
    res.json({ success: true, country, type, ...flat });
  } catch (err) {
    safeError(res, err);
  }
});

app.post("/api/calculate/:country/:type", (req, res) => {
  const country = req.params.country?.toLowerCase();
  const type = req.params.type?.toLowerCase();
  const error = validateTreeArgs(country, type);
  if (error) return res.status(400).json({ success: false, error });

  try {
    const data = readTree(country, type);
    res.json({ success: true, ...calculatePlan(data, req.body) });
  } catch (err) {
    safeError(res, err);
  }
});

app.post("/api/update/:country/:type", security.authorizeUpdate, async (req, res) => {
  const country = req.params.country?.toLowerCase();
  const type = req.params.type?.toLowerCase();
  const error = validateTreeArgs(country, type);
  if (error) return res.status(400).json({ success: false, error });

  let started = false;
  try {
    const limit = validateLimit(req.body?.limit);
    if (!security.beginUpdate()) {
      res.set("Retry-After", "60");
      return res.status(429).json({ success: false, error: "An update is running or cooling down; try again later" });
    }
    started = true;
    let review;
    const data = await updateTree(country, type, { limit, onReview: report => {
      review = { policy: report.policy, requiresReview: report.requiresReview,
        conflicts: report.conflicts.length, added: report.added.length, missing: report.missing.length,
        presentationChanges: report.updated.length };
    } });
    res.json({
      success: true,
      country,
      type,
      review,
      data: normalizeSpecialVehicleCosts(enrichTreeRanks(applyShopDependencies(data, country, type), country, type)),
    });
  } catch (err) {
    safeError(res, err);
  } finally {
    if (started) security.endUpdate();
  }
});

app.get("/api/wiki/:type", security.networkLimit, async (req, res) => {
  try {
  const type = req.params.type?.toLowerCase();
  const t_c = req.query.t_c?.toLowerCase();

  const error = validateTreeArgs(t_c, type);
  if (error) return res.status(400).json({ success: false, error });

  try {
    const html = await fetchTreeHTML(t_c, type);
    if (!html) return res.status(502).json({ success: false, error: "Failed to fetch Wiki HTML" });
    const data = extract_rank_tb(html, t_c, type);
    res.json({ success: true, country: t_c, type, cached: false, data });
  } catch (err) {
    safeError(res, err);
  }
  } finally {
    res.locals.releaseNetwork();
  }
});

app.get("/api/unit/:data_unit_id", security.networkLimit, async (req, res) => {
  try {
  const data_unit_id = req.params.data_unit_id?.toLowerCase();
  if (!/^[a-z0-9_-]{1,160}$/.test(data_unit_id || "")) return res.status(400).json({ success: false, error: "Invalid data_unit_id" });

  try {
    const data = await request_details(data_unit_id);
    res.json({ success: true, data });
  } catch (err) {
    safeError(res, err);
  }
  } finally {
    res.locals.releaseNetwork();
  }
});

app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  safeError(res, err);
});

if (require.main === module) {
  app.listen(PORT, security.host, () => {
    console.log(`War Thunder research calculator: http://localhost:${PORT}`);
  });
}

module.exports = app;
