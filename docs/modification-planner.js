(function exposeModificationPlanner(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./research-progress.js") : root.ResearchProgress);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModificationPlanner = api;
})(typeof globalThis === "object" ? globalThis : this, function createModificationPlanner(progress) {
  function isAutomaticallyUnlocked(mod) {
    return mod.rp === 0 && mod.sl === 0;
  }

  function plan(data, selectedIds, researchedIds, savedProgress = {}) {
    const progressRp = progress.cleanMap(savedProgress);
    const remaining = mod => progress.remaining(mod.rp, progressRp[mod.id]);
    const byId = new Map(data.mods.map(mod => [mod.id, mod]));
    const unlocked = new Set(data.mods.filter(isAutomaticallyUnlocked).map(mod => mod.id));
    const selected = new Set(selectedIds.filter(id => byId.has(id) && !unlocked.has(id)));
    const manuallyResearched = new Set(researchedIds.filter(id => byId.has(id) && !unlocked.has(id)));
    const researched = new Set([...manuallyResearched, ...unlocked]);
    const included = new Set();
    const dependencies = new Set();
    const fillers = new Set();

    function includeWithDependencies(id, reason) {
      if (researched.has(id) || included.has(id)) return;
      const mod = byId.get(id);
      if (!mod) return;
      included.add(id);
      if (reason === "dependency" && !selected.has(id)) dependencies.add(id);
      if (reason === "filler" && !selected.has(id)) fillers.add(id);
      for (const required of mod.requires || []) includeWithDependencies(required, "dependency");
    }

    for (const id of selected) includeWithDependencies(id, "target");

    function countTier(tier, extra = new Set()) {
      return data.mods.filter(mod => mod.tier === tier && (researched.has(mod.id) || included.has(mod.id) || extra.has(mod.id))).length;
    }

    function expansionFor(id) {
      const extra = new Set();
      function visit(candidateId) {
        if (researched.has(candidateId) || included.has(candidateId) || extra.has(candidateId)) return;
        const mod = byId.get(candidateId);
        if (!mod) return;
        extra.add(candidateId);
        for (const required of mod.requires || []) visit(required);
      }
      visit(id);
      const cost = [...extra].reduce((sum, candidateId) => sum + remaining(byId.get(candidateId)), 0);
      return { extra, cost };
    }

    for (let tier = 1; tier <= 3; tier += 1) {
      const higherPlanned = [...included].some(id => byId.get(id).tier > tier);
      // A free high-tier module alone does not prove that earlier tiers were completed.
      const higherResearched = [...manuallyResearched].some(id => byId.get(id).tier > tier);
      if (!higherPlanned || higherResearched) continue;
      const requiredCount = Number(data.tierRequirements[tier] || 0);
      while (countTier(tier) < requiredCount) {
        const candidates = data.mods
          .filter(mod => mod.tier === tier && !researched.has(mod.id) && !included.has(mod.id))
          .map(mod => ({ mod, expansion: expansionFor(mod.id) }))
          .sort((a, b) => a.expansion.cost - b.expansion.cost || a.mod.order - b.mod.order);
        if (!candidates.length) break;
        includeWithDependencies(candidates[0].mod.id, "filler");
      }
    }

    for (const id of selected) {
      dependencies.delete(id);
      fillers.delete(id);
    }
    for (const id of dependencies) fillers.delete(id);

    const plannedMods = [...included].map(id => byId.get(id)).sort((a, b) => a.order - b.order);
    const tierCounts = {};
    for (let tier = 1; tier <= 4; tier += 1) tierCounts[tier] = countTier(tier);

    return {
      selectedIds: [...selected],
      researchedIds: [...researched],
      includedIds: plannedMods.map(mod => mod.id),
      dependencyIds: [...dependencies],
      fillerIds: [...fillers],
      tierCounts,
      rp: plannedMods.reduce((sum, mod) => sum + remaining(mod), 0),
      sl: plannedMods.reduce((sum, mod) => sum + mod.sl, 0),
    };
  }

  return { plan, isAutomaticallyUnlocked };
});
