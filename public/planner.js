(function (root, factory) {
  const planner = factory(typeof module === "object" && module.exports ? require("./research-progress.js") : root.ResearchProgress);
  if (typeof module === "object" && module.exports) module.exports = planner;
  if (root) root.LocalPlanner = planner;
})(typeof window !== "undefined" ? window : globalThis, function (progress) {
  const SPECIAL_CLASSES = new Set(["prem", "premium", "squad", "event", "gift"]);

  function number(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (value == null) return 0;
    const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function rankOrder(rank) {
    const value = String(rank || "").trim().toLowerCase();
    const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    return roman[value] || number(value) || Number.MAX_SAFE_INTEGER;
  }

  function compareCost(a, b) {
    return a.rp - b.rp || a.sp - b.sp || a.count - b.count || a.key.localeCompare(b.key);
  }

  class MinHeap {
    constructor(compare) {
      this.items = [];
      this.compare = compare;
    }

    get size() {
      return this.items.length;
    }

    push(value) {
      const items = this.items;
      items.push(value);
      let index = items.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (this.compare(items[parent], value) <= 0) break;
        items[index] = items[parent];
        index = parent;
      }
      items[index] = value;
    }

    pop() {
      const items = this.items;
      if (!items.length) return null;
      const first = items[0];
      const last = items.pop();
      if (items.length && last) {
        let index = 0;
        while (true) {
          const left = index * 2 + 1;
          const right = left + 1;
          if (left >= items.length) break;
          let child = left;
          if (right < items.length && this.compare(items[right], items[left]) < 0) child = right;
          if (this.compare(last, items[child]) <= 0) break;
          items[index] = items[child];
          index = child;
        }
        items[index] = last;
      }
      return first;
    }
  }

  function plan(input) {
    const started = Date.now();
    const timeLimitMs = Math.max(100, number(input.timeLimitMs) || 1800);
    const maxStates = Math.max(1000, number(input.maxStates) || 120000);
    const units = Array.isArray(input.units) ? input.units : [];
    const groups = Array.isArray(input.groups) ? input.groups : [];
    const unitMap = new Map(units.filter(unit => unit?.data_unit_id).map(unit => [unit.data_unit_id, unit]));
    const groupMap = new Map(groups.filter(group => group?.data_unit_id).map(group => [group.data_unit_id, group]));
    const initial = new Set(input.initialIds || []);
    const owned = new Set(input.ownedIds || []);
    const targets = new Set(input.targetIds || []);
    const waypoints = new Set(input.waypointIds || []);
    const hidden = new Set(input.hiddenIds || []);
    const avoidFolded = input.avoidFolded === true;
    const progressRp = progress.cleanMap(input.progressRp);
    const warnings = [];
    const warningMessages = [];
    const warn = (source, params = {}) => {
      warningMessages.push({ source, params });
      warnings.push(source.replace(/\{(\w+)\}/g, (_, key) => String(params[key])));
    };
    const closureCache = new Map();

    function isFirstRank(rank) {
      return rankOrder(rank) === 1;
    }

    function resolveRequirement(id) {
      const group = groupMap.get(id);
      if (!group) return id;
      return (group.items || []).map(item => item.data_unit_id).find(Boolean) || group.required_unit_id || "";
    }

    function dependencyClosure(id, visiting = new Set()) {
      if (!id || initial.has(id) || owned.has(id)) return new Set();
      if (closureCache.has(id)) return new Set(closureCache.get(id));
      if (visiting.has(id)) return new Set();
      visiting.add(id);
      const unit = unitMap.get(id);
      if (!unit) {
        const resolved = resolveRequirement(id);
        const result = resolved && resolved !== id ? dependencyClosure(resolved, visiting) : new Set();
        visiting.delete(id);
        return result;
      }

      const result = new Set();
      const rawRequirement = unit.required_unit_id || unit.parent_required_unit_id || "";
      const requirement = resolveRequirement(rawRequirement);
      const requiredItem = unitMap.get(requirement) || groupMap.get(requirement);
      const ignoreRequirement = isFirstRank(unit.rank) || (requiredItem && isFirstRank(requiredItem.rank));
      if (requirement && !ignoreRequirement) {
        for (const dependencyId of dependencyClosure(requirement, visiting)) result.add(dependencyId);
      }
      result.add(id);
      visiting.delete(id);
      closureCache.set(id, [...result]);
      return result;
    }

    const requested = [...new Set([...targets, ...waypoints])].filter(id => unitMap.has(id));
    const activeRequested = requested.filter(id => !initial.has(id) && !owned.has(id));
    const mandatory = new Set();
    for (const id of activeRequested) {
      for (const dependencyId of dependencyClosure(id)) mandatory.add(dependencyId);
    }

    const mandatoryHidden = [...mandatory].filter(id => hidden.has(id) && !targets.has(id) && !waypoints.has(id));
    if (mandatoryHidden.length) warn("前置链包含 {count} 个持有后可见载具，请在游戏内确认。", { count: mandatoryHidden.length });

    const ignoredRequested = requested.filter(id => {
      const unit = unitMap.get(id);
      const className = String(unit?.class_name || "").trim().toLowerCase();
      return unit?.section !== "researchable" || SPECIAL_CLASSES.has(className) || unit?.is_squadron === true;
    });
    if (ignoredRequested.length) warn("{count} 个非科技树目标只作标记，不计入自动研发费用。", { count: ignoredRequested.length });

    const maxRequestedRank = activeRequested.reduce((max, id) => {
      const unit = unitMap.get(id);
      const className = String(unit?.class_name || "").trim().toLowerCase();
      const researchable = unit?.section === "researchable" && !SPECIAL_CLASSES.has(className) && unit?.is_squadron !== true;
      return researchable ? Math.max(max, rankOrder(unit.rank)) : max;
    }, 0);

    const rankRequirements = new Map();
    for (const rank of input.ranks || []) {
      const order = rankOrder(rank.rank);
      if (order < maxRequestedRank) rankRequirements.set(order, Math.max(0, number(rank.unlockQuantity)));
    }

    const base = new Set([...initial, ...mandatory]);
    const countAtRank = (selected, rank) => {
      const ids = new Set([...selected, ...owned]);
      let count = 0;
      for (const id of ids) {
        if (rankOrder(unitMap.get(id)?.rank) === rank) count += 1;
      }
      return count;
    };

    function highestDeficiency(selected) {
      const orders = [...rankRequirements.keys()].sort((a, b) => b - a);
      for (const order of orders) {
        const required = rankRequirements.get(order) || 0;
        const count = countAtRank(selected, order);
        if (count < required) return { rank: order, count, required, missing: required - count };
      }
      return null;
    }

    function isAutomaticCandidate(unit) {
      if (!unit?.data_unit_id || unit.section !== "researchable") return false;
      const id = unit.data_unit_id;
      const className = String(unit.class_name || "").trim().toLowerCase();
      if (initial.has(id) || owned.has(id) || hidden.has(id)) return false;
      if (SPECIAL_CLASSES.has(className) || unit.is_squadron === true) return false;
      if (avoidFolded && unit.parent_group_id) return false;
      return unit.rp != null;
    }

    const candidatesByRank = new Map();
    for (const unit of units) {
      if (!isAutomaticCandidate(unit)) continue;
      const closure = dependencyClosure(unit.data_unit_id);
      if ([...closure].some(id => hidden.has(id) && !mandatory.has(id) && !owned.has(id))) continue;
      const order = rankOrder(unit.rank);
      if (!candidatesByRank.has(order)) candidatesByRank.set(order, []);
      candidatesByRank.get(order).push({ id: unit.data_unit_id, closure });
    }

    function selectedCost(selected) {
      let rp = 0;
      let sp = 0;
      let count = 0;
      const ids = [];
      for (const id of selected) {
        if (initial.has(id) || owned.has(id)) continue;
        const unit = unitMap.get(id);
        if (!unit || unit.section !== "researchable" || isInitialLike(unit)) continue;
        const className = String(unit.class_name || "").trim().toLowerCase();
        if (SPECIAL_CLASSES.has(className) || unit.is_squadron === true) continue;
        rp += progress.remaining(number(unit.rp), progressRp[id]);
        sp += number(unit.sp);
        count += 1;
        ids.push(id);
      }
      ids.sort();
      return { rp, sp, count, key: ids.join("|") };
    }

    function isInitialLike(unit) {
      return isFirstRank(unit.rank) && number(unit.rp) === 0 && number(unit.sp) === 0;
    }

    function union(selected, additions) {
      const result = new Set(selected);
      for (const id of additions) result.add(id);
      return result;
    }

    function stateSignature(selected) {
      return [...selected].filter(id => !initial.has(id)).sort().join("|");
    }

    function greedy(start) {
      let selected = new Set(start);
      while (true) {
        const deficiency = highestDeficiency(selected);
        if (!deficiency) return selected;
        let best = null;
        for (const candidate of candidatesByRank.get(deficiency.rank) || []) {
          if (selected.has(candidate.id)) continue;
          const next = union(selected, candidate.closure);
          const gained = countAtRank(next, deficiency.rank) - deficiency.count;
          if (gained <= 0) continue;
          const before = selectedCost(selected);
          const after = selectedCost(next);
          const score = {
            rp: (after.rp - before.rp) / gained,
            sp: (after.sp - before.sp) / gained,
            count: (after.count - before.count) / gained,
            key: candidate.id,
          };
          if (!best || compareCost(score, best.score) < 0) best = { next, score };
        }
        if (!best) return null;
        selected = best.next;
      }
    }

    let best = greedy(base);
    let bestCost = best ? selectedCost(best) : null;
    const queue = new MinHeap((a, b) => compareCost(a.cost, b.cost));
    const startCost = selectedCost(base);
    queue.push({ selected: base, cost: startCost });
    const visited = new Set();
    let explored = 0;
    let searchComplete = false;

    while (queue.size && Date.now() - started < timeLimitMs && explored < maxStates) {
      const current = queue.pop();
      const signature = stateSignature(current.selected);
      if (visited.has(signature)) continue;
      visited.add(signature);
      explored += 1;
      if (bestCost && compareCost(current.cost, bestCost) >= 0 && highestDeficiency(current.selected)) continue;

      const deficiency = highestDeficiency(current.selected);
      if (!deficiency) {
        best = current.selected;
        bestCost = current.cost;
        searchComplete = true;
        break;
      }

      for (const candidate of candidatesByRank.get(deficiency.rank) || []) {
        if (current.selected.has(candidate.id)) continue;
        const next = union(current.selected, candidate.closure);
        if (countAtRank(next, deficiency.rank) <= deficiency.count) continue;
        const cost = selectedCost(next);
        if (bestCost && compareCost(cost, bestCost) >= 0) continue;
        queue.push({ selected: next, cost });
      }
    }

    const finalSelected = best || base;
    const unresolved = highestDeficiency(finalSelected);
    if (unresolved) warn("等级 {rank} 仍缺少 {count} 个可用载具，当前数据无法形成完整路线。", { rank: unresolved.rank, count: unresolved.missing });
    if (!searchComplete && !unresolved && queue.size) warn("搜索达到本机计算上限，已返回当前找到的最低路线。");
    if (!searchComplete && !unresolved && !queue.size) searchComplete = true;

    const selectedIds = [...finalSelected]
      .filter(id => !initial.has(id) && !owned.has(id))
      .filter(id => {
        const unit = unitMap.get(id);
        const className = String(unit?.class_name || "").trim().toLowerCase();
        return unit?.section === "researchable" && !SPECIAL_CLASSES.has(className) && unit?.is_squadron !== true;
      });
    const mandatoryIds = selectedIds.filter(id => mandatory.has(id));
    const fillerIds = selectedIds.filter(id => !mandatory.has(id));
    const total = selectedCost(finalSelected);
    const rankCounts = [...rankRequirements.entries()].sort((a, b) => a[0] - b[0]).map(([rank, required]) => ({
      rank,
      selected: countAtRank(finalSelected, rank),
      required,
    }));

    return {
      selectedIds,
      mandatoryIds,
      fillerIds,
      ownedIds: [...owned],
      totalRp: total.rp,
      totalSp: total.sp,
      rankCounts,
      warnings,
      warningMessages,
      searchComplete: searchComplete && !unresolved,
      feasible: !unresolved,
      exploredStates: explored,
      elapsedMs: Date.now() - started,
    };
  }

  return { plan, rankOrder };
});
