const tr = (source, params) => window.WTI18n.t(source, params);
const els = {
  statusText: document.getElementById("statusText"),
  countrySelect: document.getElementById("countrySelect"),
  typeSelect: document.getElementById("typeSelect"),
  searchInput: document.getElementById("searchInput"),
  languageSelect: document.getElementById("languageSelect"),
  dependencyModeSelect: document.getElementById("dependencyModeSelect"),
  guideButton: document.getElementById("guideButton"),
  routeExportButton: document.getElementById("routeExportButton"),
  budgetCount: document.getElementById("budgetCount"),
  budgetRp: document.getElementById("budgetRp"),
  budgetSl: document.getElementById("budgetSl"),
  budgetRpLabel: document.getElementById("budgetRpLabel"),
  budgetSlLabel: document.getElementById("budgetSlLabel"),
  usageGuideDialog: document.getElementById("usageGuideDialog"),
  planButton: document.getElementById("planButton"),

  floatingPlanCount: document.getElementById("floatingPlanCount"),
  unitContextMenu: document.getElementById("unitContextMenu"),
  unitContextTitle: document.getElementById("unitContextTitle"),
  unitContextHint: document.getElementById("unitContextHint"),
  avoidFoldedInput: document.getElementById("avoidFoldedInput"),
  clearButton: document.getElementById("clearButton"),
  refreshDataButton: document.getElementById("refreshDataButton"),
  totalRp: document.getElementById("totalRp"),
  totalSp: document.getElementById("totalSp"),
  missingCount: document.getElementById("missingCount"),
  plannedCount: document.getElementById("plannedCount"),
  pathCount: document.getElementById("pathCount"),
  plannerStatus: document.getElementById("plannerStatus"),
  ownedCount: document.getElementById("ownedCount"),
  waypointCount: document.getElementById("waypointCount"),
  plannedList: document.getElementById("plannedList"),
  missingList: document.getElementById("missingList"),
  treeContainer: document.getElementById("treeContainer"),
};

const state = {
  meta: null,
  localizedNames: {},
  tree: [],
  units: [],
  groups: [],
  unitMap: new Map(),
  groupMap: new Map(),
  initialUnlocked: new Set(),
  planned: new Set(),
  owned: new Set(),
  waypoints: new Set(),
  missing: [],
  planResult: null,
  rosterReport: null,
  country: "usa",
  type: "ground",
  folderMode: "all",
  dependencyMode: "selected",
  avoidFolded: false,
  language: window.WTI18n.locale,
  search: "",
};

const connectionMediaQuery = window.matchMedia("(min-width: 960px) and (pointer: fine)");
let connectionTaskId = null;
let connectionMarkerSequence = 0;
const connectionMarkerIds = new WeakMap();
let bulkOwnedUndo = null;
let bulkOwnedDialog;
let bulkOwnedNotice;


const zh = {
  countries: {
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
  },
  types: {
    ground: "陆战",
    aviation: "空战",
    helicopters: "直升机",
    ships: "远洋舰队",
    boats: "近岸舰队",
  },
  sections: {
    researchable: "可研发",
    premium: "金币 / 特殊",
  },
  roles: {
    "Light tank": "轻型坦克",
    "Medium tank": "中型坦克",
    "Heavy tank": "重型坦克",
    "Tank destroyer": "坦克歼击车",
    "SPAA": "防空车",
    "Fighter": "战斗机",
    "Strike aircraft": "攻击机",
    "Bomber": "轰炸机",
    "Interceptor": "截击机",
    "Jet fighter": "喷气战斗机",
    "Helicopter": "直升机",
    "Destroyer": "驱逐舰",
    "Light cruiser": "轻巡洋舰",
    "Heavy cruiser": "重巡洋舰",
    "Battleship": "战列舰",
    "Battlecruiser": "战列巡洋舰",
    "Motor torpedo boat": "鱼雷艇",
    "Motor gun boat": "炮艇",
    "Attack helicopter": "攻击直升机",
    "Utility helicopter": "通用直升机",
    "Barge": "驳船",
    "Boat": "快艇",
    "Frigate": "护卫舰",
    "Heavy boat": "重型快艇",
  },
};

function setStatus(text) {
  els.statusText.textContent = text;
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(data.error || "Request failed");
  return data;
}

function storageKey() {
  return `wt-research:${state.country}:${state.type}`;
}

function cleanText(value) {
  return String(value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/[\u00a0\u807d]/g, " ").replace(/\s+/g, " ").trim();
}

function translateCountry(code, fallback) {
  return tr(zh.countries[code] || fallback || code);
}

function translateType(code, fallback) {
  return tr(zh.types[code] || fallback || code);
}

function translateRole(role) {
  const cleanRole = cleanText(role);
  return tr(zh.roles[cleanRole] || cleanRole);
}

function localizedTitles(unit) {
  const id = cleanText(unit?.data_unit_id).toLowerCase();
  const localized = state.localizedNames[id] || {};
  const fallback = cleanText(unit?.title);
  return {
    ...Object.fromEntries(window.WTI18n.locales.map(language => [language, cleanText(localized[language] || localized.en || fallback)])),
    en: cleanText(localized.en || fallback),
    zh: cleanText(localized.zh || unit?.title_zh || unit?.zh_title || unit?.cn_title || localized.en || fallback),
  };
}

function displayTitle(unit) {
  const titles = localizedTitles(unit);
  return titles[state.language] || titles.en;
}

function updateLanguageControls() {
  els.languageSelect.value = state.language;
}

function setLanguage(language) {
  if (!window.WTI18n.locales.includes(language) || state.language === language) return;
  const scroll = { left: els.treeContainer.scrollLeft, top: els.treeContainer.scrollTop };
  state.language = language;
  window.WTI18n.setLocale(language);
  for (const option of els.countrySelect.options) option.textContent = translateCountry(option.value);
  for (const option of els.typeSelect.options) option.textContent = translateType(option.value);
  updateLanguageControls();
  renderSummary();
  renderTree();
  els.treeContainer.scrollLeft = scroll.left;
  els.treeContainer.scrollTop = scroll.top;
  window.TreeNavigation?.sync(false);
  if (state.units.length) setStatus(tr("{count} 个载具", { count: formatNumber(state.units.length) }));
  setPlanButtonsDisabled(els.planButton.disabled);
  closeUnitContextMenu();
  bulkOwnedDialog?.close();
  renderBulkOwnedNotice();
}

async function loadLocalizedNames() {
  const response = await fetch("/vehicle-names.json?v=371120be", { cache: "no-cache" });
  if (!response.ok) throw new Error(tr("载具名称暂不可用"));
  const payload = await response.json();
  if (payload.schema !== 1 || !payload.names) throw new Error(tr("载具名称格式错误"));
  state.localizedNames = payload.names;
  state.language = window.WTI18n.locale;
  updateLanguageControls();
}

function displayRank(rank) {
  return tr("等级 {rank}", { rank: cleanText(rank) });
}

function sectionLabel(section) {
  return tr(zh.sections[section] || section);
}

function getRankUnlockQuantity(rank) {
  return parseNumber(rank.unlock_quantity);
}

function getUnlockCountVehicleIds() {
  const ids = new Set([...state.initialUnlocked, ...state.owned]);
  const source = state.planResult?.selectedIds || [...state.planned, ...state.waypoints];
  source.forEach((id) => ids.add(id));
  return [...ids];
}

function getSelectedVehicleCount(rankValue) {
  let count = 0;
  for (const id of getUnlockCountVehicleIds()) {
    const unit = state.unitMap.get(id);
    if (unit && unit.rank === rankValue) count += 1;
  }
  return count;
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return window.WTI18n.number(Math.round(parseNumber(value)));
}

function formatCost(value) {
  const number = parseNumber(value);
  return number ? formatNumber(number) : "0";
}

function getGroupMainChildId(group) {
  return (group.items || []).map((item) => item.data_unit_id).find(Boolean) || "";
}

function isFirstRankValue(rank) {
  const value = cleanText(rank).toLowerCase();
  return value === "i" || value === "1";
}

function getRankOrder(rank) {
  const value = cleanText(rank).toLowerCase();
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
    displayTitle(a).localeCompare(displayTitle(b), "zh-CN")
  );
}

function getIndexedItem(id) {
  return state.unitMap.get(id) || state.groupMap.get(id);
}

function shouldIgnoreRequirement(unit, reqId) {
  if (!unit || !reqId) return false;
  if (isFirstRankValue(unit.rank)) return true;

  const requiredItem = getIndexedItem(reqId);
  return requiredItem ? isFirstRankValue(requiredItem.rank) : false;
}

function isInitialUnlockedUnit(unit) {
  if (!unit) return false;
  const className = cleanText(unit.class_name).toLowerCase();
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
  const className = cleanText(unit.class_name).toLowerCase();
  return unit.is_squadron === true || unit.isSquadron === true || className === "squad";
}

function loadSavedState() {
  discardBulkOwnedUndo();
  bulkOwnedDialog?.close();
  const saved = JSON.parse(localStorage.getItem(storageKey()) || "{}");
  state.planned = new Set(saved.planned || []);
  state.owned = new Set(saved.owned || []);
  state.waypoints = new Set(saved.waypoints || []);
  state.avoidFolded = saved.avoidFolded === true;
  state.planResult = Array.isArray(saved.route?.selectedIds) ? {
    selectedIds: saved.route.selectedIds.filter(id => typeof id === "string"),
    fillerIds: Array.isArray(saved.route.fillerIds) ? saved.route.fillerIds.filter(id => typeof id === "string") : [],
    removedAutoRoles: Object.fromEntries(Object.entries(saved.route.removedAutoRoles || {}).filter(([, role]) => role === "filler" || role === "route")),
    dirty: true,
  } : null;
  state.folderMode = "all";
  state.dependencyMode = saved.dependencyMode || "selected";
  els.dependencyModeSelect.value = state.dependencyMode;
  els.avoidFoldedInput.checked = state.avoidFolded;
}

function saveState() {
  discardBulkOwnedUndo();
  localStorage.setItem(
    storageKey(),
    JSON.stringify({
      planned: [...state.planned],
      owned: [...state.owned],
      waypoints: [...state.waypoints],
      avoidFolded: state.avoidFolded,
      dependencyMode: state.dependencyMode,
      route: state.planResult ? {
        selectedIds: state.planResult.selectedIds,
        fillerIds: state.planResult.fillerIds,
        removedAutoRoles: state.planResult.removedAutoRoles || {},
      } : null,
    })
  );
}

function flattenTree(tree) {
  const units = [];
  const groups = [];
  const previousByColumn = {
    researchable: [],
    premium: [],
  };
  let rankIndex = 0;

  for (const rank of tree) {
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
            const squadronGroup = isSquadronUnit(item);
            const group = {
              ...item,
              is_squadron: squadronGroup,
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
                class_name: subItem.class_name || (squadronGroup ? "squad" : ""),
                is_squadron: squadronGroup || subItem.is_squadron === true,
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
            const reqId = item.required_unit_id || inferredReqId;
            units.push({ ...item, required_unit_id: reqId, rank: rank.rank, section: sectionType, columnIndex, rowIndex });
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

  state.units = units;
  state.groups = groups;
  state.unitMap = new Map(units.map((unit) => [unit.data_unit_id, unit]));
  state.groupMap = new Map(groups.map((group) => [group.data_unit_id, group]));
  state.initialUnlocked = new Set(units.filter(isInitialUnlockedUnit).map((unit) => unit.data_unit_id));
  state.initialUnlocked.forEach((id) => state.planned.delete(id));
  state.initialUnlocked.forEach((id) => state.owned.delete(id));
  state.initialUnlocked.forEach((id) => state.waypoints.delete(id));
}

function getDependencyIds(unitId, visited = new Set()) {
  if (!unitId || visited.has(unitId)) return [];
  visited.add(unitId);

  const unit = state.unitMap.get(unitId);
  if (!unit) {
    const group = state.groupMap.get(unitId);
    if (group) {
      const mainChildId = getGroupMainChildId(group);
      if (mainChildId && mainChildId !== unitId) return getDependencyIds(mainChildId, visited);
      return getDependencyIds(group.required_unit_id, visited);
    }

    return [];
  }

  const parentReq = unit.parent_required_unit_id && !unit.required_unit_id ? unit.parent_required_unit_id : "";
  const reqId = unit.required_unit_id || parentReq;
  const dependencyIds = shouldIgnoreRequirement(unit, reqId) ? [] : getDependencyIds(reqId, visited);
  return [...dependencyIds, unitId];
}

function calculatePlan() {
  const orderedIds = state.planResult?.selectedIds || [...state.planned, ...state.waypoints];

  state.missing = orderedIds
    .map((id) => state.unitMap.get(id))
    .filter((unit) => unit && !isInitialUnlockedUnit(unit) && !state.owned.has(unit.data_unit_id))
    .filter(Boolean)
    .sort(compareUnitsByProgression);

  renderSummary();
  renderTree();
}

function invalidateExactPlan(removedId = null) {
  if (!state.planResult) return;
  // Keep the editable route, but discard the previous search's validity claims.
  const selectedIds = [...new Set([
    ...state.planResult.selectedIds, ...state.planned, ...state.waypoints,
  ])].filter(id => id !== removedId && !state.owned.has(id) && !state.initialUnlocked.has(id));
  const selected = new Set(selectedIds);
  state.planResult = {
    selectedIds,
    fillerIds: state.planResult.fillerIds.filter(id => selected.has(id) && !state.planned.has(id) && !state.waypoints.has(id)),
    removedAutoRoles: state.planResult.removedAutoRoles || {},
    dirty: true,
  };
}

const contextModeLabels = {
  target: ["设为目标", "取消目标"],
  owned: ["标记为已拥有", "取消拥有标记"],
  waypoint: ["设为途经点", "取消途经点"],
};

function getModeSet(mode) {
  if (mode === "owned") return state.owned;
  if (mode === "waypoint") return state.waypoints;
  return state.planned;
}

function getRankOwnedCandidates(rank) {
  const rankIndex = state.tree.findIndex(item => String(item.rank) === String(rank));
  if (rankIndex < 0) return [];
  const includedRanks = new Set(state.tree.slice(0, rankIndex + 1).map(item => String(item.rank)));
  return state.units.filter(unit => {
    const id = unit.data_unit_id;
    const info = window.RosterAudit?.info(state.country, state.type, id);
    return includedRanks.has(String(unit.rank)) && unit.section === "researchable"
      && !state.initialUnlocked.has(id) && !state.owned.has(id)
      && !isSquadronUnit(unit)
      && !["prem", "premium", "squad", "event", "gift"].includes(cleanText(unit.class_name).toLowerCase())
      && info?.category === "standard" && !info.hidden;
  });
}

function discardBulkOwnedUndo() {
  bulkOwnedUndo = null;
  if (bulkOwnedNotice) bulkOwnedNotice.hidden = true;
}

function renderBulkOwnedNotice() {
  if (!bulkOwnedNotice) return;
  bulkOwnedNotice.hidden = !bulkOwnedUndo;
  if (!bulkOwnedUndo) return;
  bulkOwnedNotice.querySelector("[role=status]").textContent = tr("已标记 {count} 辆为已拥有", { count: bulkOwnedUndo.count });
  bulkOwnedNotice.querySelector("button").textContent = tr("撤销本次标记");
}

function undoBulkOwned() {
  if (!bulkOwnedUndo || bulkOwnedUndo.key !== storageKey() || els.planButton.disabled) return;
  const before = bulkOwnedUndo.before;
  state.owned = new Set(before.owned);
  state.planned = new Set(before.planned);
  state.waypoints = new Set(before.waypoints);
  state.planResult = before.planResult;
  saveState();
  calculatePlan();
}

function markRankOwned(rank) {
  if (els.planButton.disabled) return;
  const units = getRankOwnedCandidates(rank);
  if (!units.length) return;
  const before = {
    owned: [...state.owned], planned: [...state.planned], waypoints: [...state.waypoints],
    planResult: state.planResult ? JSON.parse(JSON.stringify(state.planResult)) : null,
  };
  units.forEach(unit => {
    const id = unit.data_unit_id;
    state.owned.add(id);
    state.planned.delete(id);
    state.waypoints.delete(id);
    if (state.planResult?.removedAutoRoles) delete state.planResult.removedAutoRoles[id];
  });
  invalidateExactPlan();
  saveState();
  calculatePlan();
  bulkOwnedUndo = { key: storageKey(), before, count: units.length };
  renderBulkOwnedNotice();
}

function openRankOwnedDialog(rank) {
  if (els.planButton.disabled) return;
  closeUnitContextMenu();
  const units = getRankOwnedCandidates(rank);
  bulkOwnedDialog.dataset.rank = rank;
  bulkOwnedDialog.innerHTML = `
    <h2 id="bulkOwnedTitle">${escapeHtml(displayRank(rank))} · ${tr("批量标记已拥有")}</h2>
    <p data-bulk-scope>${tr(isFirstRankValue(rank) ? "本级普通载具（含折叠载具，不含特殊及隐藏载具）" : "本级及以下普通载具（含折叠载具，不含特殊及隐藏载具）")}</p>
    <p class="bulk-owned-count">${tr("新增标记：{count} 辆", { count: units.length })}</p>
    <ul>${units.map(unit => `<li><span class="bulk-owned-rank">${escapeHtml(displayRank(unit.rank))}</span> ${escapeHtml(displayTitle(unit))}</li>`).join("")}</ul>
    <div class="bulk-owned-actions">
      <button type="button" data-bulk-cancel>${tr("取消")}</button>
      <button type="button" data-bulk-confirm ${units.length ? "" : "disabled"}>${tr("标记为已拥有")}</button>
    </div>`;
  bulkOwnedDialog.showModal();
  bulkOwnedDialog.querySelector("[data-bulk-cancel]").focus();
}

function setupBulkOwned() {
  bulkOwnedDialog = document.createElement("dialog");
  bulkOwnedDialog.className = "bulk-owned-dialog";
  bulkOwnedDialog.setAttribute("aria-labelledby", "bulkOwnedTitle");
  bulkOwnedDialog.addEventListener("click", event => {
    if (event.target.closest("[data-bulk-confirm]")) {
      const rank = bulkOwnedDialog.dataset.rank;
      bulkOwnedDialog.close();
      markRankOwned(rank);
    } else if (event.target.closest("[data-bulk-cancel]")) bulkOwnedDialog.close();
  });
  bulkOwnedNotice = document.createElement("div");
  bulkOwnedNotice.className = "bulk-owned-notice";
  bulkOwnedNotice.hidden = true;
  bulkOwnedNotice.innerHTML = '<span role="status"></span><button type="button"></button>';
  bulkOwnedNotice.querySelector("button").addEventListener("click", undoBulkOwned);
  document.body.append(bulkOwnedDialog, bulkOwnedNotice);
}

function closeUnitContextMenu() {
  if (!els.unitContextMenu) return;
  els.unitContextMenu.hidden = true;
  delete els.unitContextMenu.dataset.unitId;
}

function openUsageGuide() {
  closeUnitContextMenu();
  setUsageGuideTab("usageGuideQuickStart");
  if (els.usageGuideDialog && !els.usageGuideDialog.open) els.usageGuideDialog.showModal();
}

function setUsageGuideTab(panelId, focus = false) {
  const tabs = [...els.usageGuideDialog.querySelectorAll("[data-guide-tab]")];
  if (!tabs.some(tab => tab.dataset.guideTab === panelId)) return;
  tabs.forEach(tab => {
    const selected = tab.dataset.guideTab === panelId;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.dataset.guideTab).hidden = !selected;
    if (selected && focus) tab.focus();
  });
}

function closeUsageGuide() {
  if (els.usageGuideDialog?.open) els.usageGuideDialog.close();
}

function openUnitContextMenu(id, clientX, clientY) {
  const unit = state.unitMap.get(id);
  if (!unit || !els.unitContextMenu) return;
  const initial = state.initialUnlocked.has(id);
  els.unitContextMenu.dataset.unitId = id;
  els.unitContextTitle.textContent = displayTitle(unit);
  els.unitContextHint.textContent = tr(initial ? "初始载具已经自动计入，无需设置" : "再次选择当前状态即可取消");
  els.unitContextMenu.querySelectorAll("[data-context-action]").forEach((button) => {
    const mode = button.dataset.contextAction;
    const active = getModeSet(mode).has(id);
    button.disabled = initial;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", String(active));
    button.querySelector("[data-context-label]").textContent = tr(contextModeLabels[mode][active ? 1 : 0]);
  });
  els.unitContextMenu.hidden = false;
  els.unitContextMenu.style.left = "0px";
  els.unitContextMenu.style.top = "0px";
  const rect = els.unitContextMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(clientX, document.documentElement.clientWidth - rect.width - 8));
  const top = Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8));
  els.unitContextMenu.style.left = `${Math.round(left)}px`;
  els.unitContextMenu.style.top = `${Math.round(top)}px`;
}

function toggleUnitMode(id, mode) {
  if (state.initialUnlocked.has(id)) return;
  if (state.planResult?.removedAutoRoles) delete state.planResult.removedAutoRoles[id];
  const targetSet = getModeSet(mode);
  const removing = targetSet.has(id);
  if (removing) {
    targetSet.delete(id);
  } else {
    state.planned.delete(id);
    state.owned.delete(id);
    state.waypoints.delete(id);
    targetSet.add(id);
  }
  invalidateExactPlan(removing ? id : null);
  saveState();
  calculatePlan();
}

async function loadRosterReport() {
  try {
    const response = await fetch("/roster-audit.json?v=roster-1", { cache: "no-cache" });
    if (response.ok) state.rosterReport = await response.json();
  } catch {
    state.rosterReport = null;
  }
}

function runExactPlan() {
  if (!state.planned.size && !state.waypoints.size) {
    els.plannerStatus.textContent = tr("请先选择至少一个目标或途经点");
    return;
  }
  if (!window.LocalPlanner?.plan) {
    els.plannerStatus.textContent = tr("本地规划器未能载入");
    return;
  }
  discardBulkOwnedUndo();
  setPlanButtonsDisabled(true);
  els.plannerStatus.textContent = tr("正在本机搜索最低 RP 路线");
  window.setTimeout(() => {
    try {
      const rosterUnits = state.rosterReport?.trees?.[`${state.country}/${state.type}`]?.units || {};
      const hiddenIds = Object.entries(rosterUnits).filter(([, unit]) => unit.hidden).map(([id]) => id);
      state.planResult = window.LocalPlanner.plan({
        units: state.units,
        groups: state.groups,
        ranks: state.tree.map(rank => ({ rank: rank.rank, unlockQuantity: getRankUnlockQuantity(rank) })),
        initialIds: [...state.initialUnlocked],
        ownedIds: [...state.owned],
        targetIds: [...state.planned],
        waypointIds: [...state.waypoints],
        hiddenIds,
        avoidFolded: state.avoidFolded,
        timeLimitMs: 1800,
      });
      calculatePlan();
      saveState();
    } catch (error) {
      invalidateExactPlan();
      calculatePlan();
      els.plannerStatus.textContent = tr("规划失败：{error}", { error: error.message });
    } finally {
      setPlanButtonsDisabled(false);
    }
  }, 20);
}

function setPlanButtonsDisabled(disabled) {
  els.planButton.disabled = disabled;
  els.planButton.querySelector("[data-plan-button-label]").textContent = tr(disabled ? "规划中" : "精确规划");
}


function renderSummary() {
  const plannedUnits = [...state.planned].map((id) => state.unitMap.get(id)).filter(Boolean).sort(compareUnitsByProgression);
  const rawRp = state.missing.reduce((sum, unit) => sum + parseNumber(unit.rp), 0);
  const totalSp = state.missing.reduce((sum, unit) => sum + parseNumber(unit.sp), 0);

  els.totalRp.textContent = formatNumber(rawRp);
  els.totalSp.textContent = formatNumber(totalSp);
  els.missingCount.textContent = state.missing.length;
  els.plannedCount.textContent = plannedUnits.length;
  els.pathCount.textContent = state.missing.length;
  els.ownedCount.textContent = state.owned.size;
  els.waypointCount.textContent = state.waypoints.size;
  els.floatingPlanCount.textContent = tr("目标 {targets} · 途经点 {waypoints}", { targets: state.planned.size, waypoints: state.waypoints.size });
  els.budgetCount.textContent = state.missing.length;
  els.budgetRp.textContent = formatNumber(rawRp);
  els.budgetSl.textContent = formatNumber(totalSp);
  els.budgetRpLabel.textContent = state.missing.some(unit => unit.rp == null) ? tr("已知 RP") : "RP";
  els.budgetSlLabel.textContent = state.missing.some(unit => unit.sp == null) ? tr("已知 SL") : "SL";
  els.routeExportButton.disabled = !state.units.length || window.RouteExporter?.isBusy();

  if (state.planResult && !state.planResult.dirty) {
    const result = state.planResult;
    const mainStatus = result.feasible
      ? (result.searchComplete ? tr("已找到最低 RP 路线") : tr("已返回当前找到的最低路线"))
      : tr("当前数据无法组成完整路线");
    const details = tr("{fillers} 个等级补足 · {states} 个方案状态 · {time} ms", { fillers: result.fillerIds.length, states: formatNumber(result.exploredStates), time: result.elapsedMs });
    const warnings = (result.warningMessages || []).map(item => tr(item.source, item.params));
    els.plannerStatus.textContent = `${mainStatus} · ${details}${warnings.length ? ` · ${warnings.join(" ")}` : ""}`;
  } else {
    els.plannerStatus.textContent = state.planned.size || state.waypoints.size
      ? tr("计划已改变，请点击“精确规划”重新计算")
      : tr("选择目标后点击“精确规划”");
  }

  els.plannedList.innerHTML = plannedUnits.length
    ? plannedUnits.map((unit) => renderListItem(unit, true)).join("")
    : `<div class="empty-state">${tr("暂无选择")}</div>`;

  els.missingList.innerHTML = state.missing.length
    ? state.missing.map((unit) => renderListItem(unit, false)).join("")
    : `<div class="empty-state">${tr("暂无计算结果")}</div>`;
}

function getRouteKind(unit) {
  const id = unit.data_unit_id;
  if (state.planned.has(id)) return tr("目标");
  if (state.waypoints.has(id)) return tr("途经点");
  if (state.planResult?.fillerIds?.includes(id)) return tr("等级补足");
  return tr("必经路线");
}

function buildRouteExportPayload() {
  const hasUnknownRp = state.missing.some((unit) => unit.rp == null);
  const hasUnknownSl = state.missing.some((unit) => unit.sp == null);
  const totalRp = state.missing.reduce((sum, unit) => sum + parseNumber(unit.rp), 0);
  const totalSl = state.missing.reduce((sum, unit) => sum + parseNumber(unit.sp), 0);
  const date = new Date();
  const stamp = date.toISOString().slice(0, 10);

  return {
    country: translateCountry(state.country),
    type: translateType(state.type),
    generatedAt: new Intl.DateTimeFormat(window.WTI18n.tag, { dateStyle: "medium", timeStyle: "short" }).format(date),
    targetCount: state.planned.size,
    pendingCount: state.missing.length,
    rpLabel: hasUnknownRp ? tr("已知 RP") : tr("总 RP"),
    slLabel: hasUnknownSl ? tr("已知 SL") : tr("总 SL"),
    totalRp: formatNumber(totalRp),
    totalSl: formatNumber(totalSl),
    filename: `war-thunder-route-${state.country}-${state.type}-${stamp}.png`,
    routes: state.missing.map((unit) => ({
      title: displayTitle(unit),
      rank: displayRank(unit.rank || "-"),
      br: cleanText(unit.br) || "-",
      rp: unit.rp == null ? tr("未提供") : formatNumber(unit.rp),
      sl: unit.sp == null ? tr("未提供") : formatNumber(unit.sp),
      kind: getRouteKind(unit),
    })),
  };
}

async function exportRouteImage() {
  if (!state.units.length || window.RouteExporter?.isBusy()) return;
  if (!window.RouteExporter?.download) {
    setStatus(tr("路线图生成器未能载入"));
    return;
  }

  els.routeExportButton.disabled = true;
  els.routeExportButton.textContent = tr("正在生成截图…");
  try {
    await window.RouteExporter.download(buildRouteExportPayload(), els.treeContainer.querySelector(".tree-canvas"), renderTreeConnections);
    setStatus(tr("完整科技树截图已下载"));
  } catch (error) {
    setStatus(tr("路线图生成失败：{error}", { error: error.message }));
  } finally {
    els.routeExportButton.disabled = !state.units.length;
    els.routeExportButton.textContent = tr("导出科技树截图");
  }
}

window.WTRouteExport = {
  buildPayload: buildRouteExportPayload,
  render: () => window.RouteExporter?.render(buildRouteExportPayload(), els.treeContainer.querySelector(".tree-canvas"), renderTreeConnections),
};

function renderListItem(unit, removable) {
  const removeButton = removable
    ? `<button class="mini-button" type="button" data-remove-plan="${escapeHtml(unit.data_unit_id)}">${tr("移除")}</button>`
    : `<span class="list-meta">${escapeHtml(displayRank(unit.rank || ""))}</span>`;
  const role = translateRole(unit.main_role);
  const routeLabel = !removable && state.planResult
    ? (state.planResult.fillerIds.includes(unit.data_unit_id) ? ` · ${tr("等级补足")}` : ` · ${tr("必经路线")}`)
    : "";

  return `
    <div class="list-item">
      ${unit.vehicle_icon ? `<img src="${escapeHtml(unit.vehicle_icon)}" alt="">` : `<span></span>`}
      <div>
        <div class="list-title">${escapeHtml(displayTitle(unit))}</div>
        <div class="list-meta">BR ${escapeHtml(unit.br || "-")} · RP ${formatCost(unit.rp)} · SL ${formatCost(unit.sp)}${role ? ` · ${escapeHtml(role)}` : ""}${routeLabel}</div>
      </div>
      ${removeButton}
    </div>
  `;
}

function unitMatchesSearch(unit) {
  if (!state.search) return true;
  const titles = localizedTitles(unit);
  const parentTitles = state.localizedNames[cleanText(unit.parent_group_id).toLowerCase()] || {};
  const haystack =
    `${Object.values(titles).join(" ")} ${unit.title || ""} ${unit.data_unit_id || ""} ${Object.values(parentTitles).join(" ")} ${unit.parent_group_title || ""} ${translateRole(unit.main_role)}`.toLowerCase();
  return haystack.includes(state.search.toLowerCase());
}

function renderUnit(unit, inFolder = false) {
  const id = unit.data_unit_id;
  const autoSelected = inFolder && state.planResult?.selectedIds.includes(id)
    && !state.owned.has(id) && !state.planned.has(id) && !state.waypoints.has(id);
  const update = window.WTVehicleUpdates;
  const isNew = update?.trees?.[`${state.country}/${state.type}`]?.includes(id);
  const updateTip = isNew ? tr("{major} {name} 游戏版本新增载具（{date}）。", update) : "";
  const updateBadge = isNew ? `<span class="unit-update-label" title="${escapeHtml(updateTip)}">${tr("新增")}</span> ` : "";
  const classes = ["unit-tile"];
  if (autoSelected) classes.push("auto-planned");
  const className = cleanText(unit.class_name).toLowerCase();
  const squadron = isSquadronUnit(unit);
  if (state.planned.has(id)) classes.push("planned");
  if (state.owned.has(id)) classes.push("owned");
  if (state.waypoints.has(id)) classes.push("waypoint");
  if (state.planResult?.fillerIds.includes(id)) classes.push("rank-filler");
  if (state.missing.some((missing) => missing.data_unit_id === id)) classes.push("missing");
  if (isInitialUnlockedUnit(unit)) classes.push("unlocked");
  if (squadron) classes.push("squadron");
  if (className) classes.push(className);
  if (unit.section === "premium" || className === "prem" || className === "premium") classes.push("premium");
  const role = translateRole(unit.main_role);
  const unlocked = isInitialUnlockedUnit(unit);

  const modificationButton = window.ModificationWorkbench?.hasVehicle(id)
    ? `<button class="unit-modifications-launch" type="button" data-modifications-id="${escapeHtml(id)}" aria-label="${escapeHtml(tr("打开 {name} 配件研发", { name: displayTitle(unit) }))}" title="${tr("配件研发")}"><span aria-hidden="true">⚙</span><b>${tr("配件")}</b></button>`
    : "";

  return `
    <div class="unit-tile-shell has-unit-actions${modificationButton ? " has-modifications" : ""}">
    <button class="${classes.join(" ")}" type="button" data-unit-id="${escapeHtml(id)}" title="${escapeHtml(id)} · ${tr("右键或长按设置目标、已拥有或途经点")}">
      ${unit.vehicle_icon ? `<img src="${escapeHtml(unit.vehicle_icon)}" alt="">` : `<span></span>`}
      <span>
        <span class="unit-title">${updateBadge}${escapeHtml(displayTitle(unit))}</span>
        <span class="unit-meta">
          ${window.RosterAudit?.badges(state.country, state.type, unit, displayTitle(unit)) || ""}
          <span class="pill">BR ${escapeHtml(unit.br || "-")}</span>
          ${squadron ? `<span class="pill squadron-label">${tr("联队载具")}</span>` : `<span class="pill rp">RP ${formatCost(unit.rp)}</span><span class="pill sp">SL ${formatCost(unit.sp)}</span>`}
          ${unlocked ? `<span class="pill unlocked">${tr("初始载具")}</span>` : ""}
          ${state.planned.has(id) ? `<span class="pill target-label">${tr("目标")}</span>` : ""}
          ${state.owned.has(id) ? `<span class="pill owned-label">${tr("已拥有")}</span>` : ""}
          ${state.waypoints.has(id) ? `<span class="pill waypoint-label">${tr("途经点")}</span>` : ""}
          ${autoSelected ? `<span class="pill auto-planned-label">${tr("已选")} · ${tr(state.planResult.fillerIds.includes(id) ? "等级补足" : "必经路线")}</span>` : ""}
          ${state.planResult?.fillerIds.includes(id) ? `<span class="pill filler-label">${tr("等级补足")}</span>` : ""}
          ${role ? `<span class="pill role">${escapeHtml(role)}</span>` : ""}
        </span>
      </span>
      ${isNew ? '<span class="unit-update-edge" aria-hidden="true"></span>' : ""}
    </button><div class="unit-actions">${modificationButton}<button class="unit-wiki-launch" type="button" data-wiki-id="${escapeHtml(id)}" data-wiki-title="${escapeHtml(displayTitle(unit))}" aria-label="${escapeHtml(tr("查看 {name} Wiki 详情", { name: displayTitle(unit) }))}" title="${tr("Wiki 载具详情")}"><span class="wiki-bookmark"><img src="assets/wiki/book-open.svg" alt=""></span></button></div>
    </div>
  `;
}

function renderGroup(group, context) {
  const matchingItems = (group.items || []).filter(unitMatchesSearch);
  const groupMatches = unitMatchesSearch(group);
  if (!groupMatches && matchingItems.length === 0) return "";
  const className = cleanText(group.class_name).toLowerCase();
  const squadronGroup = isSquadronUnit(group);
  const classes = ["group-tile", "folder-tile"];
  if (className) classes.push(className);
  if (context.section === "premium" || className === "prem" || className === "premium") classes.push("premium");

  const children = group.items || [];
  if (!children.length) return "";
  const key = `${state.country}/${state.type}/${group.data_unit_id}`;
  const folded = children.slice(1);
  const selectedIds = new Set(state.planResult?.selectedIds || [...state.planned, ...state.waypoints]);
  const selectedCount = children.filter(item =>
    !state.owned.has(item.data_unit_id) &&
    selectedIds.has(item.data_unit_id)
  ).length;
  const selected = folded.filter(item => selectedIds.has(item.data_unit_id) || state.owned.has(item.data_unit_id)).length;
  const hasNew = folded.some(item => window.WTVehicleUpdates?.trees?.[`${state.country}/${state.type}`]?.includes(item.data_unit_id));
  const matches = state.search ? folded.filter(unitMatchesSearch).length : 0;

  const items = children.slice(0, 1).map((item) =>
    renderUnit({
      ...item,
      class_name: item.class_name || (squadronGroup ? "squad" : ""),
      is_squadron: squadronGroup || item.is_squadron === true,
      rank: context.rank,
      section: context.section,
      parent_group_id: group.data_unit_id,
      parent_group_title: group.title,
      parent_required_unit_id: group.required_unit_id || "",
    })
  );

  return `
    <div class="${classes.join(" ")}">
      ${items[0]}
      ${folded.length && selectedCount ? `<span class="folder-selection-count" data-selected-count="${selectedCount}" title="${tr("本组当前路线已选载具，含主载具及自动规划载具，不含已拥有载具。")}">${tr("已选 {count} 辆", { count: selectedCount })}</span>` : ""}
      ${folded.length ? `<button type="button" class="folder-toggle${selected ? " has-selection" : ""}${hasNew ? " has-new" : ""}${matches ? " has-match" : ""}"
        data-folder-key="${escapeHtml(key)}" data-folder-group="${escapeHtml(group.data_unit_id)}"
        aria-expanded="false" aria-haspopup="dialog"
        aria-label="${escapeHtml(displayTitle(group))} · ${tr("{count} 个载具", { count: children.length })}"
        title="${escapeHtml(displayTitle(group))} · ${tr("{count} 个载具", { count: children.length })}${selected ? ` · ${tr("已标记")} ${selected}` : ""}${matches ? ` · ${tr("匹配")} ${matches}` : ""}${hasNew ? ` · ${tr("新增")}` : ""}"><span aria-hidden="true">≡</span></button>` : ""}
    </div>
  `;
}

function renderColumn(column, context) {
  return `
    <div class="tree-column">
      ${column
        .map((item) => {
          if (item.type === "multiple") return renderGroup(item, context);
          return unitMatchesSearch(item)
            ? renderUnit({ ...item, rank: context.rank, section: context.section })
            : "";
        })
        .join("")}
    </div>
  `;
}

function visibleTreeColumns(columns) {
  return columns.map(column => column.filter(item => item.type === "multiple"
    ? unitMatchesSearch(item) || (item.items || []).some(unitMatchesSearch)
    : unitMatchesSearch(item)));
}

function renderBand(columns, context) {
  const visibleColumns = visibleTreeColumns(columns);

  if (!visibleColumns.some((column) => column.length > 0)) return "";

  const count = context.columnCount;
  const sectionClass = `${context.section}-band`;
  return `
    <div class="tree-band ${sectionClass}">
      <div class="column-grid" style="grid-template-columns: repeat(${count}, 168px);">
        ${visibleColumns.map((column) => renderColumn(column, context)).join("")}
      </div>
    </div>
  `;
}

function resolveRequirementSources(reqId) {
  if (!reqId) return [];
  const group = state.groupMap.get(reqId);
  if (!group) return [reqId];

  const mainChildId = getGroupMainChildId(group);
  return mainChildId ? [mainChildId] : [reqId];
}

function getDisplayRequirement(unit) {
  // Draw the stored relationship without applying research-planning exemptions.
  return unit?.required_unit_id || unit?.parent_required_unit_id || "";
}

function svgNumber(value) {
  return Number(value).toFixed(1);
}

function tilePoint(tile, canvasBox, edge) {
  const box = tile.getBoundingClientRect();
  const x = box.left + box.width / 2 - canvasBox.left;
  const y = edge === "top" ? box.top - canvasBox.top : box.bottom - canvasBox.top;
  return { x, y, box };
}

function renderOrthogonalConnector(from, to, canvasBox) {
  const fromBox = from.getBoundingClientRect();
  const toBox = to.getBoundingClientRect();
  const fromCenterY = fromBox.top + fromBox.height / 2;
  const toCenterY = toBox.top + toBox.height / 2;
  const fromAbove = fromCenterY <= toCenterY;
  const start = tilePoint(from, canvasBox, fromAbove ? "bottom" : "top");
  const end = tilePoint(to, canvasBox, fromAbove ? "top" : "bottom");
  const direction = fromAbove ? 1 : -1;
  const folderToggle = from.closest(".folder-tile")?.querySelector(".folder-toggle");
  if (fromAbove && folderToggle) start.y = Math.max(start.y, folderToggle.getBoundingClientRect().bottom - canvasBox.top);
  start.y += 4 * direction;
  // The main-tree shaft stops at the arrowhead base, leaving the tip clear of the card.
  end.y -= (from.closest(".folder-popup") ? 5 : 15) * direction;
  const sameColumn = Math.abs(start.x - end.x) < 6;
  const gap = Math.abs(end.y - start.y);
  const minStub = 14;

  if (sameColumn) {
    return `M ${svgNumber(start.x)} ${svgNumber(start.y)} V ${svgNumber(end.y)}`;
  }

  const railY =
    gap > minStub * 3
      ? start.y + (end.y - start.y) / 2
      : (fromAbove ? Math.max(fromBox.bottom, toBox.bottom) - canvasBox.top + 18 : Math.min(fromBox.top, toBox.top) - canvasBox.top - 18);

  return [
    `M ${svgNumber(start.x)} ${svgNumber(start.y)}`,
    `v ${svgNumber(minStub * direction)}`,
    `V ${svgNumber(railY)}`,
    `H ${svgNumber(end.x)}`,
    `V ${svgNumber(end.y - minStub * direction)}`,
    `v ${svgNumber(minStub * direction)}`,
  ].join(" ");
}

function renderTreeConnections(exportCanvas = null) {
  const canvas = exportCanvas || els.treeContainer.querySelector(".tree-canvas");
  const svg = canvas?.querySelector(".tree-links");
  if (!svg || !canvas) return;

  svg.innerHTML = "";
  svg.setAttribute("width", canvas.scrollWidth);
  svg.setAttribute("height", canvas.scrollHeight);
  svg.setAttribute("viewBox", `0 0 ${canvas.scrollWidth} ${canvas.scrollHeight}`);

  const canvasBox = canvas.getBoundingClientRect();
  const visibleTiles = new Map(
    [...canvas.querySelectorAll(".unit-tile[data-unit-id]")]
      .filter(tile => !tile.closest("details:not([open])"))
      .map((tile) => [tile.dataset.unitId, tile])
  );
  const segments = [];
  if (!connectionMarkerIds.has(svg)) connectionMarkerIds.set(svg, `tree-arrow-${++connectionMarkerSequence}`);
  const markerId = connectionMarkerIds.get(svg);

  for (const [id, to] of visibleTiles.entries()) {
    const unit = state.unitMap.get(id);
    const reqId = getDisplayRequirement(unit);
    for (const sourceId of resolveRequirementSources(reqId)) {
      const sourceGroup = state.groupMap.get(state.unitMap.get(sourceId)?.parent_group_id);
      const from = visibleTiles.get(sourceId) || (sourceGroup && visibleTiles.get(getGroupMainChildId(sourceGroup)));
      if (!from || !to || from === to) continue;

      segments.push(`<path data-from="${escapeHtml(from.dataset.unitId)}" data-to="${escapeHtml(id)}" d="${renderOrthogonalConnector(from, to, canvasBox)}" marker-end="url(#${markerId})" />`);
    }
  }

  svg.innerHTML = `<defs><marker id="${markerId}" viewBox="0 0 10 20" refX="0" refY="10" markerWidth="10" markerHeight="20" markerUnits="userSpaceOnUse" orient="auto"><polygon points="0,0 10,10 0,20" fill="#657f8a"/></marker></defs>` + segments.join("");
}

function scheduleTreeConnections() {
  if (connectionTaskId !== null) {
    if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(connectionTaskId);
    else window.clearTimeout(connectionTaskId);
  }

  const render = () => {
    connectionTaskId = null;
    renderTreeConnections();
  };

  if (typeof window.requestIdleCallback === "function") {
    connectionTaskId = window.requestIdleCallback(render, { timeout: 500 });
  } else {
    connectionTaskId = window.setTimeout(render, 40);
  }
}

function renderRankUnlockGate(rank, nextRank) {
  const quantity = getRankUnlockQuantity(rank);
  const selected = getSelectedVehicleCount(rank.rank);
  const complete = quantity > 0 && selected >= quantity;
  const targetLabel = nextRank ? tr("解锁等级 {rank}", { rank: nextRank.rank }) : tr("后续等级要求");

  return `
    <div class="rank-unlock-line ${quantity ? "" : "is-zero"} ${complete ? "is-complete" : ""}" aria-label="${escapeHtml(tr("已选择 {selected} 个，{target}需要 {quantity} 个载具", { selected, target: targetLabel, quantity }))}">
      <span>${targetLabel}: ${selected} / ${quantity}</span>
    </div>
  `;
}

function renderRankRail(rank) {
  const quantity = getRankUnlockQuantity(rank);
  const selected = getSelectedVehicleCount(rank.rank);
  const complete = quantity > 0 && selected >= quantity;
  const ownedLabel = tr(isFirstRankValue(rank.rank) ? "标记本级已拥有" : "标记本级及以下已拥有");

  return `
    <div class="rank-rail ${complete ? "is-complete" : ""}">
      <button type="button" class="rank-owned-trigger" data-owned-rank="${escapeHtml(rank.rank)}" aria-haspopup="dialog" title="${escapeHtml(ownedLabel)}" aria-label="${escapeHtml(displayRank(rank.rank))} · ${escapeHtml(ownedLabel)}">
        <span class="rank-name">${escapeHtml(displayRank(rank.rank))}</span>
        <img src="assets/navigation/check.svg" width="16" height="16" alt="">
      </button>
    </div>
  `;
}

function renderTree() {
  window.VehicleFolders?.beforeTreeRender();
  if (!state.tree.length) {
    els.treeContainer.innerHTML = `<div class="loading">${tr("没有本地数据")}</div>`;
    return;
  }

  const researchColumns = Math.max(0, ...state.tree.map(rank => (rank.researchable_vehicles || []).length));
  const premiumColumns = Math.max(0, ...state.tree.map(rank => (rank.premium_vehicles || []).length));
  const columnWidth = count => count ? count * 168 + (count - 1) * 8 : 0;
  const html = state.tree
    .map((rank, index, ranks) => {
      const researchable = renderBand(rank.researchable_vehicles || [], {
        rank: rank.rank,
        section: "researchable",
        columnCount: researchColumns,
      });
      const premium = renderBand(rank.premium_vehicles || [], {
        rank: rank.rank,
        section: "premium",
        columnCount: premiumColumns,
      });
      if (!researchable && !premium) return "";
      const rows = Math.max(1, ...visibleTreeColumns([
        ...(rank.researchable_vehicles || []), ...(rank.premium_vehicles || []),
      ]).map(column => column.length));
      return `
        <article class="rank-block">
          ${renderRankRail(rank)}
          <div class="rank-field" style="grid-template-rows: repeat(${rows}, max-content);">
            ${researchable}
            ${premium}
          </div>
          ${renderRankUnlockGate(rank, ranks[index + 1])}
        </article>
      `;
    })
    .join("");

  els.treeContainer.innerHTML = html
    ? `<div class="tree-canvas" style="--research-width: ${columnWidth(researchColumns)}px; --premium-width: ${premiumColumns ? columnWidth(premiumColumns) + 27 : 0}px;"><svg class="tree-links" aria-hidden="true"></svg><div class="tree-content"><div class="tree-headings rank-field">${researchColumns ? `<h3 class="band-title researchable-title">${sectionLabel("researchable")}</h3>` : ""}${premiumColumns ? `<h3 class="band-title premium-title">${sectionLabel("premium")}</h3>` : ""}</div>${html}</div></div>`
    : `<div class="loading">${tr("没有匹配项")}</div>`;
  scheduleTreeConnections();

  window.VehicleFolders?.refresh();
}

async function loadMeta() {
  state.meta = await api("/api/meta");
  els.countrySelect.innerHTML = state.meta.countries
    .map((country) => `<option value="${country.code}">${escapeHtml(translateCountry(country.code, country.label))}</option>`)
    .join("");
  els.typeSelect.innerHTML = state.meta.types
    .map((type) => `<option value="${type.code}">${escapeHtml(translateType(type.code, type.label))}</option>`)
    .join("");
  els.countrySelect.value = state.country;
  els.typeSelect.value = state.type;
  window.TreeNavigation?.mount(els.countrySelect, els.typeSelect);
}

async function loadTree() {
  closeUnitContextMenu();
  state.country = els.countrySelect.value;
  state.type = els.typeSelect.value;
  window.TreeNavigation?.sync(true);
  setStatus(tr("正在读取科技树数据"));
  els.treeContainer.innerHTML = `<div class="loading">${tr("正在载入科技树")}</div>`;

  loadSavedState();

  try {
    const result = await api(`/api/tree/${state.country}/${state.type}`);
    state.tree = result.data || [];
    flattenTree(state.tree);
    setStatus(tr("{count} 个载具", { count: formatNumber(state.units.length) }));
    calculatePlan();
  } catch (err) {
    state.tree = [];
    state.units = [];
    state.groups = [];
    state.unitMap = new Map();
    state.groupMap = new Map();
    state.initialUnlocked = new Set();
    state.missing = [];
    setStatus(err.message);
    renderSummary();
    renderTree();
  } finally {
    window.TreeNavigation?.sync(false);
  }
}

function toggleUnit(id) {
  if (state.initialUnlocked.has(id)) return;
  if (state.planResult?.selectedIds.includes(id) && !state.planned.has(id)) {
    if (!state.waypoints.has(id)) {
      state.planResult.removedAutoRoles ||= {};
      state.planResult.removedAutoRoles[id] = state.planResult.fillerIds.includes(id) ? "filler" : "route";
    }
    state.waypoints.delete(id);
    invalidateExactPlan(id);
    saveState();
    calculatePlan();
    return;
  }
  const previousRole = state.planResult?.removedAutoRoles?.[id];
  if ((previousRole === "filler" || previousRole === "route") && !state.planned.has(id) && !state.owned.has(id) && !state.waypoints.has(id)) {
    state.planResult.selectedIds.push(id);
    if (previousRole === "filler") state.planResult.fillerIds.push(id);
    delete state.planResult.removedAutoRoles[id];
    invalidateExactPlan();
    saveState();
    calculatePlan();
    return;
  }
  toggleUnitMode(id, "target");
}

async function refreshCurrentTree() {
  discardBulkOwnedUndo();
  bulkOwnedDialog?.close();
  setStatus(tr("正在从官方 Wiki 更新当前树"));
  els.refreshDataButton.disabled = true;
  try {
    const session = await api("/api/session", { cache: "no-store" });
    const result = await api(`/api/update/${state.country}/${state.type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WT-Update-Token": session.token },
      body: JSON.stringify({ limit: 4 }),
    });
    state.tree = result.data || [];
    flattenTree(state.tree);
    setStatus(tr("已更新 {country} · {type}", { country: translateCountry(state.country), type: translateType(state.type) }));
    calculatePlan();
  } catch (err) {
    setStatus(err.message);
  } finally {
    els.refreshDataButton.disabled = false;
  }
}

function wireEvents() {
  setupBulkOwned();
  window.VehicleLongPress?.configure({ open: openUnitContextMenu, close: closeUnitContextMenu });
  els.countrySelect.addEventListener("change", loadTree);
  els.typeSelect.addEventListener("change", loadTree);
  els.languageSelect.addEventListener("change", event => setLanguage(event.target.value));

  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value.trim();
    renderTree();
  });

  els.dependencyModeSelect.addEventListener("change", () => {
    state.dependencyMode = els.dependencyModeSelect.value;
    saveState();
    calculatePlan();
  });

  els.avoidFoldedInput.addEventListener("change", () => {
    state.avoidFolded = els.avoidFoldedInput.checked;
    invalidateExactPlan();
    saveState();
    calculatePlan();
  });

  els.planButton.addEventListener("click", runExactPlan);

  els.guideButton.addEventListener("click", openUsageGuide);
  els.routeExportButton.addEventListener("click", exportRouteImage);

  els.usageGuideDialog.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-guide-tab]");
    if (tab) setUsageGuideTab(tab.dataset.guideTab);
    if (event.target === els.usageGuideDialog || event.target.closest("[data-guide-close]")) closeUsageGuide();
  });

  els.usageGuideDialog.addEventListener("keydown", event => {
    const tab = event.target.closest("[data-guide-tab]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...els.usageGuideDialog.querySelectorAll("[data-guide-tab]")];
    const index = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setUsageGuideTab(tabs[next].dataset.guideTab, true);
  });

  els.clearButton.addEventListener("click", () => {
    state.planned.clear();
    state.owned.clear();
    state.waypoints.clear();
    state.planResult = null;
    invalidateExactPlan();
    saveState();
    calculatePlan();
  });

  els.refreshDataButton.addEventListener("click", refreshCurrentTree);

  window.addEventListener("resize", scheduleTreeConnections, { passive: true });

  if (typeof connectionMediaQuery.addEventListener === "function") {
    connectionMediaQuery.addEventListener("change", scheduleTreeConnections);
  } else {
    connectionMediaQuery.addListener(scheduleTreeConnections);
  }

  window.VehicleFolders?.configure({
    tree: els.treeContainer,
    group: id => {
      const group = state.groupMap.get(id);
      return group ? {
        title: displayTitle(group),
        html: (group.items || []).map(item => renderUnit(state.unitMap.get(item.data_unit_id), true)).join(""),
      } : null;
    },
    select: toggleUnit,
    context: openUnitContextMenu,
    closeContext: closeUnitContextMenu,
    draw: renderTreeConnections,
  });

  els.treeContainer.addEventListener("click", (event) => {
    const rankButton = event.target.closest("[data-owned-rank]");
    if (rankButton) {
      openRankOwnedDialog(rankButton.dataset.ownedRank);
      return;
    }
    const button = event.target.closest("[data-unit-id]");
    if (!button) return;
    toggleUnit(button.dataset.unitId);
  });

  els.treeContainer.addEventListener("contextmenu", (event) => {
    const tile = event.target.closest("[data-unit-id]");
    if (!tile) return;
    event.preventDefault();
    openUnitContextMenu(tile.dataset.unitId, event.clientX, event.clientY);
  });

  els.treeContainer.addEventListener("keydown", (event) => {
    const tile = event.target.closest("[data-unit-id]");
    if (!tile || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
    event.preventDefault();
    const rect = tile.getBoundingClientRect();
    openUnitContextMenu(tile.dataset.unitId, rect.left + Math.min(rect.width, 48), rect.top + Math.min(rect.height, 36));
  });

  els.unitContextMenu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-context-action]");
    const id = els.unitContextMenu.dataset.unitId;
    if (!action || !id || action.disabled) return;
    closeUnitContextMenu();
    toggleUnitMode(id, action.dataset.contextAction);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#unitContextMenu")) closeUnitContextMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeUnitContextMenu();
  });
  window.addEventListener("scroll", closeUnitContextMenu, { passive: true });
  els.treeContainer.addEventListener("scroll", closeUnitContextMenu, { passive: true });

  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-plan]");
    if (!button) return;
    state.planned.delete(button.dataset.removePlan);
    invalidateExactPlan(button.dataset.removePlan);
    saveState();
    calculatePlan();
  });
}

async function init() {
  try {
    wireEvents();
    await loadRosterReport();
    await window.RosterAudit?.load();
    await loadLocalizedNames();
    await window.ModificationWorkbench?.loadCatalog();
    await loadMeta();
    await loadTree();
  } catch (err) {
    setStatus(err.message);
  }
}

init();
