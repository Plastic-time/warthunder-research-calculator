(function initializeModificationWorkbench() {
  const dialog = document.getElementById("modificationDialog");
  if (!dialog || !window.ModificationPlanner) return;

  const tree = document.getElementById("modificationTree");
  const viewport = document.getElementById("modificationViewport");
  const title = document.getElementById("modificationTitle");
  const vehicleImage = document.getElementById("modificationVehicleImage");
  const rpOutput = document.getElementById("modificationRp");
  const slOutput = document.getElementById("modificationSl");
  const status = document.getElementById("modificationStatus");
  const ui = { data: null, selected: new Set(), researched: new Set(), unlocked: new Set(), result: null, progressRp: Object.create(null), editProgress: false, airCombat: true };
  let catalog = null;
  let catalogPromise = null;
  const chunkCache = new Map();

  const format = value => window.WTI18n.number(Number(value || 0));
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
  const t = (source, params) => window.WTI18n.t(source, params, 'modifications');
  const failure = source => Object.assign(new Error(t(source)), { translationSource: source });
  const language = () => window.WTI18n.locale;
  let localizedNames = {};
  let nameFallbacks = {};
  const storageKey = id => `wt-research:modifications:${id}`;
  let clearedSnapshot = null;
  let undoTimer = null;

  function dismissUndo() {
    clearTimeout(undoTimer);
    undoHovered = false;
    clearedSnapshot = null;
    undoNotice.hidden = true;
    undoNotice.querySelector('[role="status"]').textContent = "";
  }

  function scheduleUndoExpiry() {
    clearTimeout(undoTimer);
    if (!clearedSnapshot || undoNotice.contains(document.activeElement) || undoHovered) return;
    undoTimer = setTimeout(dismissUndo, 15000);
  }

  async function sha256(content) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function loadCatalog() {
    if (catalog) return catalog;
    if (!catalogPromise) {
      catalogPromise = Promise.all([fetch("database/modifications/catalog.json?v=all-vehicles-20260920", { cache: "no-cache" })
        .then(response => {
          if (!response.ok) throw failure("配件索引载入失败");
          return response.json();
        })
        .then(data => {
          if (data.schema !== 2 || !data.vehicles || !data.chunks) throw failure("配件索引格式错误");
          return data;
        }), loadModificationNames()])
        .then(([data]) => { catalog = data; return data; })
        .catch(error => {
          catalogPromise = null;
          throw failure(error.translationSource || "配件索引载入失败");
        });
    }
    return catalogPromise;
  }

  async function loadModificationNames() {
    try {
      const response = await fetch("modification-names.json?v=multilingual-20260922", { cache: "no-cache", signal: AbortSignal.timeout(8000) });
      if (!response.ok) return;
      const data = await response.json();
      if (data.schema !== 1 || !data.names || typeof data.names !== "object") return;
      localizedNames = data.names;
      nameFallbacks = data.coverage?.fallbacks || {};
    } catch {
      // Names are supplementary; keep the independently verified costs usable offline.
      localizedNames = {};
      nameFallbacks = {};
    }
  }

  function hasVehicle(vehicleId) {
    return Boolean(catalog?.vehicles?.[vehicleId]);
  }

  function normalizeVehicle(raw, chunkKey) {
    const iconPrefix = "https://static.encyclopedia.warthunder.com/gui_skin/";
    return {
      vehicleId: raw.i,
      branch: chunkKey.endsWith("_aviation") ? "aviation" : "other",
      aliases: raw.aliases || {},
      vehicleName: { zh: raw.n[0], en: raw.n[1] },
      vehicleIcon: raw.v,
      tierRequirements: { 1: raw.r[0], 2: raw.r[1], 3: raw.r[2] },
      totals: { rp: raw.t[0], sl: raw.t[1] },
      categories: raw.c.map((category, index) => ({
        id: String(index), name: { zh: category[0], en: category[1] }, columns: category[2],
      })),
      mods: raw.m.map(mod => ({
        id: mod[0], category: String(mod[1]), tier: mod[2], column: mod[3],
        name: { zh: mod[4], en: mod[5] },
        icon: mod[6].startsWith("http") ? mod[6] : `${iconPrefix}${mod[6]}`,
        artwork: mod[12] || null,
        rp: mod[7], sl: mod[8], ge: mod[9], requires: mod[10], order: mod[11],
      })),
    };
  }

  function renderIcon(mod) {
    // A belt research unlock is not a selected ammunition loadout.
    const originalAircraftBelt = ui.data.branch === "aviation" && mod.icon.endsWith("/ammo.png");
    const art = originalAircraftBelt ? null : mod.artwork;
    const valid = files => Array.isArray(files) && files.every(file => /^[a-z0-9_-]+\.png$/i.test(file));
    if (!art || !valid(art.b) || !art.b.length || !valid(art.d)) {
      return `<img src="${escape(mod.icon)}" alt="" loading="eager">`;
    }
    const hint = art.v ? t("弹链组图示：{name}（{items}）", { name: art.n, items: art.v.map(item => item.w ? `${item.w}: ${item.n}` : item.n).join(" / ") }) : art.n;
    const images = files => files.map(file => `<img src="images/ammunition/${escape(file)}" alt="" loading="eager">`).join("");
    const ratio = Number.isFinite(art.r) && art.r > 0 && art.r <= 1 ? art.r : 1 / art.b.length;
    const width = ratio * 100;
    const space = 100 - width * art.b.length;
    const gap = space > 0 ? space / (art.b.length + 1) : space / Math.max(1, art.b.length - 1);
    const start = space > 0 ? gap : 0;
    const rounds = art.b.map((file, index) => `<img src="images/ammunition/${escape(file)}" alt="" loading="eager" style="left:${start + (width + gap) * index}%;width:${width}%">`).join("");
    return `<span class="modification-ammunition" title="${escape(hint)}" data-fallback="${escape(mod.icon)}">
      <span class="modification-ammunition-decor">${images(art.d)}</span>
      <span class="modification-ammunition-base">${rounds}</span>
    </span>`;
  }

  async function loadVehicle(vehicleId) {
    const index = await loadCatalog();
    const chunkKey = index.vehicles[vehicleId];
    const chunkMeta = index.chunks[chunkKey];
    if (!chunkKey || !chunkMeta) throw failure("这辆载具没有可研发配件");
    if (!chunkCache.has(chunkKey)) {
      chunkCache.set(chunkKey, fetch(`${chunkMeta.path}?v=${chunkMeta.sha256.slice(0, 16)}`, { cache: "no-cache" })
        .then(async response => {
          if (!response.ok) throw failure("配件数据载入失败");
          const content = await response.text();
          if (await sha256(content) !== chunkMeta.sha256) throw failure("配件数据版本校验失败，请刷新页面");
          return JSON.parse(content);
        })
        .catch(error => { chunkCache.delete(chunkKey); throw failure(error.translationSource || "配件数据载入失败"); }));
    }
    const chunk = await chunkCache.get(chunkKey);
    const raw = chunk.v?.[vehicleId];
    if (!raw) throw failure("配件数据中找不到这辆载具");
    return normalizeVehicle(raw, chunkKey);
  }

  function save() {
    if (!ui.data) return;
    localStorage.setItem(storageKey(ui.data.vehicleId), JSON.stringify({
      selected: [...ui.selected], researched: [...ui.researched],
      progressRp: ui.progressRp,
      airCombat: ui.airCombat,
    }));
  }

  function restore() {
    ui.airCombat = true;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(ui.data.vehicleId)) || "{}");
      ui.airCombat = saved.airCombat !== false;
      const ids = new Set(ui.data.mods.filter(mod => !ui.unlocked.has(mod.id)).map(mod => mod.id));
      const restoreIds = values => new Set((values || []).map(id => Object.hasOwn(ui.data.aliases, id) ? ui.data.aliases[id] : id).filter(id => ids.has(id)));
      ui.selected = restoreIds(saved.selected);
      ui.researched = restoreIds(saved.researched);
      ui.progressRp = window.ResearchProgress.cleanMap(saved.progressRp);
      for (const [oldId, newId] of Object.entries(ui.data.aliases)) {
        if (Object.hasOwn(ui.progressRp, oldId) && !Object.hasOwn(ui.progressRp, newId)) ui.progressRp[newId] = ui.progressRp[oldId];
      }
    } catch {
      ui.selected.clear();
      ui.researched.clear();
      ui.progressRp = Object.create(null);
    }
  }

  function currentTierCounts() {
    if (ui.result) return ui.result.tierCounts;
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const mod of ui.data.mods) {
      if (ui.unlocked.has(mod.id) || ui.researched.has(mod.id) || ui.selected.has(mod.id)) counts[mod.tier] += 1;
    }
    return counts;
  }

  function manualBudget() {
    return ui.data.mods.reduce((budget, mod) => {
      if (ui.selected.has(mod.id) && !ui.researched.has(mod.id) && !ui.unlocked.has(mod.id)) {
        budget.rp += window.ResearchProgress.remaining(mod.rp, ui.progressRp[mod.id]);
        budget.sl += mod.sl;
      }
      return budget;
    }, { rp: 0, sl: 0 });
  }

  function tileState(mod) {
    if (ui.unlocked.has(mod.id)) return "unlocked";
    if (ui.researched.has(mod.id)) return "researched";
    if (ui.selected.has(mod.id)) return "target";
    if (ui.result?.priorityIds.includes(mod.id)) return "priority";
    if (ui.result?.dependencyIds.includes(mod.id)) return "dependency";
    if (ui.result?.fillerIds.includes(mod.id)) return "filler";
    return "";
  }

  function stateLabel(mod) {
    const labels = { researched: "已研发", target: "目标", dependency: "必经", filler: "补足", priority: "优先" };
    return labels[tileState(mod)] ? t(labels[tileState(mod)]) : "";
  }

  function vehicleName() {
    return typeof displayTitle === "function"
      ? displayTitle({ data_unit_id: ui.data.vehicleId, title: ui.data.vehicleName.en, title_zh: ui.data.vehicleName.zh })
      : ui.data.vehicleName[language()] || ui.data.vehicleName.en;
  }

  function translateControls() {
    const preference = dialog.querySelector(".modification-air-combat");
    if (preference) {
      preference.hidden = ui.data?.branch !== "aviation";
      preference.querySelector("input").checked = ui.airCombat;
      preference.querySelector("span").textContent = t("空战优先");
    }
    const priorityLegend = dialog.querySelector("[data-air-combat-legend]");
    if (priorityLegend) priorityLegend.hidden = ui.data?.branch !== "aviation";
    dialog.querySelectorAll("[data-modification-mode]").forEach(button => {
      button.textContent = t(button.dataset.modificationMode === "progress" ? "剩余 RP" : "选择目标");
      button.setAttribute("aria-pressed", String((button.dataset.modificationMode === "progress") === ui.editProgress));
    });
    const text = (selector, source) => {
      const element = dialog.querySelector(selector);
      if (element) element.textContent = t(source);
    };
    text(".modification-vehicle > div > span", "配件");
    const close = dialog.querySelector("[data-modification-close]");
    close?.setAttribute("aria-label", t("关闭配件研发"));
    close?.setAttribute("title", t("关闭"));
    dialog.querySelector(".modification-legend")?.setAttribute("aria-label", t("配件状态图例"));
    for (const [kind, source] of Object.entries({ target: "目标", dependency: "必经配件", filler: "等级补足", researched: "已研发", priority: "空战优先" })) {
      const icon = dialog.querySelector(`.modification-legend i.${kind}`);
      if (icon?.nextElementSibling) {
        icon.nextElementSibling.dataset.i18nContext = 'modifications';
        icon.nextElementSibling.textContent = t(source);
      }
      else if (icon) icon.parentElement.replaceChildren(icon, document.createTextNode(t(source)));
    }
    text(".modification-toolbar > p", ui.editProgress ? "剩余 RP" : "左键选择目标 · 右键标记已研发 · 等级门槛按游戏数据计算");
    text(".modification-budget > span", "配件预算");
    text("[data-modification-undo]", "撤销清空");
    if (clearedSnapshot) text('.modification-undo-notice [role="status"]', "已清空当前载具的配件记录");
    for (const [action, source] of Object.entries({ clear: "清空配件目标、已研发标记及进度", all: "全部配件", calculate: "计算配件研发" })) {
      const button = dialog.querySelector(`[data-modification-action="${action}"]`);
      const label = button?.querySelector(".modification-action-label");
      if (label) label.textContent = t(source);
      else text(`[data-modification-action="${action}"]`, source);
      button?.setAttribute("aria-label", t(source));
    }
    if (!ui.data) {
      title.textContent = t("配件研发");
      status.textContent = t("选择配件后点击计算");
    }
  }

  function render() {
    if (!ui.data) return;
    const lang = language();
    title.textContent = t("配件研发 - {vehicle}", { vehicle: vehicleName() });
    vehicleImage.alt = vehicleName();
    const categoryOffsets = new Map();
    let totalColumns = 0;
    for (const category of ui.data.categories) {
      categoryOffsets.set(category.id, totalColumns);
      totalColumns += category.columns;
    }
    const tierCounts = currentTierCounts();
    const selectedCount = ui.selected.size;
    const plannedSet = new Set([...(ui.result?.includedIds || []), ...ui.researched, ...ui.unlocked]);
    const cells = [];
    for (let tier = 1; tier <= 4; tier += 1) {
      for (let column = 0; column < totalColumns; column += 1) {
        cells.push(`<span class="modification-grid-cell" style="grid-column:${column + 2};grid-row:${tier + 1}"></span>`);
      }
    }
    const headers = ui.data.categories.map(category => {
      const start = categoryOffsets.get(category.id) + 2;
      return `<h3 class="modification-category" style="grid-column:${start}/span ${category.columns};grid-row:1">${escape(t(category.name.zh))}</h3>`;
    });
    const tiers = [1, 2, 3, 4].map(tier => {
      const required = ui.data.tierRequirements[tier];
      const gate = required ? `<small class="${tierCounts[tier] >= required ? "met" : ""}">${tierCounts[tier]}/${required}</small>` : `<small>${tierCounts[tier]}</small>`;
      return `<div class="modification-tier" style="grid-column:1;grid-row:${tier + 1}"><b>${["I", "II", "III", "IV"][tier - 1]}</b>${gate}</div>`;
    });
    const tiles = ui.data.mods.map(mod => {
      const column = categoryOffsets.get(mod.category) + mod.column + 2;
      const stateName = tileState(mod);
      const isPlanned = plannedSet.has(mod.id);
      const unlocked = ui.unlocked.has(mod.id);
      const invested = ui.researched.has(mod.id) ? 0 : window.ResearchProgress.amount(ui.progressRp[mod.id], mod.rp);
      const remainingRp = window.ResearchProgress.remaining(mod.rp, invested);
      const names = localizedNames[mod.id] || {};
      const usable = value => typeof value === "string" && value.trim() && value !== mod.id ? value : "";
      const fallback = nameFallbacks[mod.id] || {};
      const englishName = (fallback.en ? mod.name.en : usable(names.en)) || mod.name.en;
      const name = (fallback[lang] ? mod.name[lang] || mod.name.en : usable(names[lang])) || mod.name[lang] || englishName;
      const titleText = `${name} / ${englishName}\n${unlocked ? t("已解锁") : `${t("总计 {count} RP", { count: format(mod.rp) })} · ${format(mod.sl)} SL\n${t("剩余 {count} RP", { count: format(remainingRp) })}\n${t(ui.editProgress ? "研发进度" : "左键：目标 · 右键：已研发")}`}`;
      return `
        <button class="modification-tile ${stateName}${isPlanned ? " is-planned" : ""}${invested ? " has-progress" : ""}" type="button"
          data-mod-id="${escape(mod.id)}" style="grid-column:${column};grid-row:${mod.tier + 1}" title="${escape(titleText)}"${unlocked || (ui.editProgress && (mod.rp <= 0 || ui.researched.has(mod.id))) ? " disabled" : ""}>
          ${renderIcon(mod)}
          <span class="modification-tile-copy"><b>${escape(name)}</b><small>${unlocked ? `✓ ${escape(t("已解锁"))}` : `${format(remainingRp)} RP · ${format(mod.sl)} SL`}</small>${invested && !ui.researched.has(mod.id) ? `<small class="modification-rp-progress" title="${escape(t("总计 {count} RP", { count: format(mod.rp) }))}">${escape(t("剩余 {count} RP", { count: format(remainingRp) }))}</small>` : ""}</span>
          ${stateName && !unlocked ? `<span class="modification-state">${stateName === "researched" ? "✓ " : ""}${escape(stateLabel(mod))}</span>` : ""}
        </button>`;
    });

    tree.innerHTML = `
      <div class="modification-board" style="grid-template-columns:54px repeat(${totalColumns}, 178px)">
        <svg class="modification-links" aria-hidden="true"><defs><marker id="mod-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z"></path></marker></defs></svg>
        <div class="modification-tier-title">${escape(t("等级"))}</div>${headers.join("")}${cells.join("")}${tiers.join("")}${tiles.join("")}
      </div>`;

    const budget = ui.result || manualBudget();
    rpOutput.textContent = format(budget.rp);
    slOutput.textContent = format(budget.sl);
    if (ui.unlocked.size === ui.data.mods.length) {
      status.textContent = t("全部配件已解锁");
    } else if (ui.result) {
      const autoCount = ui.result.dependencyIds.length + ui.result.fillerIds.length + ui.result.priorityIds.length;
      status.textContent = t("目标 {selected} · 自动加入 {auto} · 尚需研发 {remaining}", { selected: selectedCount, auto: autoCount, remaining: ui.result.includedIds.length });
    } else {
      status.textContent = selectedCount
        ? t("手动选择 {count} · 当前预算仅统计所选配件", { count: selectedCount })
        : t("可自由选择任意配件，点击计算后自动补齐前置");
    }
    requestAnimationFrame(drawConnections);
  }

  function drawConnections() {
    const board = tree.querySelector(".modification-board");
    const svg = board?.querySelector(".modification-links");
    if (!board || !svg || !ui.data) return;
    const boardRect = board.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${board.scrollWidth} ${board.scrollHeight}`);
    svg.setAttribute("width", board.scrollWidth);
    svg.setAttribute("height", board.scrollHeight);
    svg.querySelectorAll("path.modification-link").forEach(path => path.remove());
    const active = new Set([...(ui.result?.includedIds || []), ...ui.researched, ...ui.unlocked]);
    for (const mod of ui.data.mods) {
      const target = board.querySelector(`[data-mod-id="${CSS.escape(mod.id)}"]`);
      if (!target) continue;
      for (const requiredId of mod.requires || []) {
        const source = board.querySelector(`[data-mod-id="${CSS.escape(requiredId)}"]`);
        if (!source) continue;
        const from = source.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const x1 = from.left + from.width / 2 - boardRect.left;
        const y1 = from.bottom - boardRect.top - 3;
        const x2 = to.left + to.width / 2 - boardRect.left;
        const y2 = to.top - boardRect.top + 3;
        const middle = y1 + Math.max(8, (y2 - y1) / 2);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${x1} ${y1} V ${middle} H ${x2} V ${y2}`);
        path.setAttribute("class", `modification-link${active.has(mod.id) && active.has(requiredId) ? " active" : ""}`);
        path.setAttribute("marker-end", "url(#mod-arrow)");
        svg.append(path);
      }
    }
  }

  function calculate() {
    ui.result = window.ModificationPlanner.plan(ui.data, [...ui.selected], [...ui.researched], ui.progressRp, { airCombat: ui.airCombat });
    save();
    render();
  }

  async function open(vehicleId) {
    dismissUndo();
    try {
      if (ui.data?.vehicleId !== vehicleId) {
        ui.data = await loadVehicle(vehicleId);
        ui.unlocked = new Set(ui.data.mods.filter(window.ModificationPlanner.isAutomaticallyUnlocked).map(mod => mod.id));
        ui.result = null;
        restore();
      }
      vehicleImage.src = ui.data.vehicleIcon;
      ui.editProgress = false;
      translateControls();
      render();
      dialog.showModal();
      requestAnimationFrame(drawConnections);
    } catch (error) {
      if (typeof setStatus === "function") setStatus(t(error.translationSource || "配件数据载入失败"));
    }
  }

  document.addEventListener("click", event => {
    const launch = event.target.closest("[data-modifications-id]");
    if (launch) {
      event.preventDefault();
      event.stopPropagation();
      open(launch.dataset.modificationsId);
      return;
    }
    if (event.target === dialog || event.target.closest("[data-modification-close]")) dialog.close();
  });

  tree.addEventListener("click", event => {
    const tile = event.target.closest("[data-mod-id]");
    if (!tile) return;
    const id = tile.dataset.modId;
    if (ui.unlocked.has(id)) return;
    if (ui.editProgress) {
      const mod = ui.data.mods.find(item => item.id === id);
      if (!mod || ui.researched.has(id)) return;
      const vehicleId = ui.data.vehicleId;
      window.ResearchProgress.edit({
        title: tile.querySelector("b").textContent, total: mod.rp, value: ui.progressRp[id],
        onSave(value) {
          if (ui.data.vehicleId !== vehicleId) return;
          dismissUndo();
          if (value) ui.progressRp[id] = value; else delete ui.progressRp[id];
          if (ui.result) calculate(); else { save(); render(); }
        },
      });
      return;
    }
    dismissUndo();
    if (ui.researched.has(id)) ui.researched.delete(id);
    if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
    ui.result = null;
    save();
    render();
  });

  tree.addEventListener("error", event => {
    const artwork = event.target.closest?.(".modification-ammunition");
    if (!artwork || !tree.contains(artwork)) return;
    const fallback = document.createElement("img");
    fallback.alt = "";
    fallback.src = artwork.dataset.fallback;
    artwork.replaceWith(fallback);
  }, true);

  tree.addEventListener("contextmenu", event => {
    const tile = event.target.closest("[data-mod-id]");
    if (!tile) return;
    event.preventDefault();
    const id = tile.dataset.modId;
    if (ui.unlocked.has(id)) return;
    dismissUndo();
    if (ui.researched.has(id)) ui.researched.delete(id);
    else { ui.researched.add(id); ui.selected.delete(id); }
    ui.result = null;
    save();
    render();
  });

  dialog.addEventListener("pointerdown", event => {
    dialog.dataset.modificationPointer = event.pointerType;
  });
  dialog.addEventListener("keydown", () => { delete dialog.dataset.modificationPointer; });
  dialog.addEventListener("click", event => {
    const mode = event.target.closest("[data-modification-mode]");
    if (mode) {
      ui.editProgress = mode.dataset.modificationMode === "progress";
      translateControls();
      render();
      return;
    }
    const action = event.target.closest("[data-modification-action]")?.dataset.modificationAction;
    if (!action) return;
    if (action === "calculate") { dismissUndo(); calculate(); }
    if (action === "all") {
      dismissUndo();
      ui.selected = new Set(ui.data.mods.filter(mod => !ui.researched.has(mod.id) && !ui.unlocked.has(mod.id)).map(mod => mod.id));
      calculate();
    }
    if (action === "clear") {
      if (!ui.selected.size && !ui.researched.size && !Object.keys(ui.progressRp).length) return;
      dismissUndo();
      clearedSnapshot = {
        vehicleId: ui.data.vehicleId, selected: new Set(ui.selected), researched: new Set(ui.researched),
        progressRp: { ...ui.progressRp }, result: ui.result,
      };
      ui.selected.clear();
      ui.researched.clear();
      ui.progressRp = Object.create(null);
      ui.result = null;
      save();
      render();
      undoNotice.hidden = false;
      undoNotice.querySelector('[role="status"]').textContent = t("已清空当前载具的配件记录");
      scheduleUndoExpiry();
    }
  });

  viewport.addEventListener("scroll", drawConnections, { passive: true });
  window.addEventListener("resize", drawConnections, { passive: true });
  document.addEventListener("wt-language-change", () => {
    translateControls();
    if (!dialog.open) return;
    const focused = document.activeElement?.dataset.modId;
    const { scrollLeft, scrollTop } = viewport;
    render();
    viewport.scrollLeft = scrollLeft;
    viewport.scrollTop = scrollTop;
    if (focused) tree.querySelector(`[data-mod-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  });
  const editMode = document.createElement("div");
  editMode.className = "modification-edit-mode";
  editMode.innerHTML = '<button type="button" data-modification-mode="select" aria-pressed="true"></button><button type="button" data-modification-mode="progress" aria-pressed="false"></button>';
  const optionsBar = document.createElement("div");
  optionsBar.className = "modification-options";
  dialog.querySelector(".modification-toolbar").append(optionsBar);
  const preference = document.createElement("label");
  preference.className = "modification-air-combat";
  preference.innerHTML = '<input type="checkbox" role="switch" data-modification-air-combat checked><span></span>';
  optionsBar.append(editMode, preference);
  const toolbar = dialog.querySelector(".modification-toolbar");
  toolbar.prepend(optionsBar);
  const instructions = toolbar.querySelector(":scope > p");
  if (instructions) instructions.hidden = true;
  dialog.querySelectorAll('[data-modification-action]:not([data-modification-action="calculate"])').forEach(button => {
    button.removeAttribute("data-i18n");
    const icon = document.createElement("span");
    icon.className = "modification-action-icon";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "modification-action-label";
    label.setAttribute("role", "tooltip");
    button.replaceChildren(icon, label);
  });
  preference.querySelector("input").addEventListener("change", event => {
    dismissUndo();
    ui.airCombat = event.target.checked;
    if (ui.result) calculate(); else { save(); render(); }
  });
  const priorityLegend = document.createElement("span");
  priorityLegend.dataset.airCombatLegend = "";
  priorityLegend.innerHTML = '<i class="priority"></i><span></span>';
  dialog.querySelector(".modification-legend").append(priorityLegend);
  title.removeAttribute("data-i18n");
  status.removeAttribute("data-i18n");
  const undoNotice = document.createElement("div");
  undoNotice.className = "modification-undo-notice";
  undoNotice.hidden = true;
  undoNotice.innerHTML = '<span role="status" aria-live="polite"></span><button type="button" data-modification-undo></button>';
  dialog.querySelector(".modification-footer").before(undoNotice);
  let undoHovered = false;
  undoNotice.addEventListener("pointerenter", event => {
    if (event.pointerType !== "mouse") return;
    undoHovered = true;
    clearTimeout(undoTimer);
  });
  undoNotice.addEventListener("pointerleave", () => { undoHovered = false; scheduleUndoExpiry(); });
  undoNotice.addEventListener("focusin", () => clearTimeout(undoTimer));
  undoNotice.addEventListener("focusout", scheduleUndoExpiry);
  undoNotice.querySelector("button").addEventListener("click", () => {
    const snapshot = clearedSnapshot;
    if (!snapshot || snapshot.vehicleId !== ui.data?.vehicleId) { dismissUndo(); return; }
    ui.selected = snapshot.selected;
    ui.researched = snapshot.researched;
    ui.progressRp = snapshot.progressRp;
    ui.result = snapshot.result;
    dismissUndo();
    save();
    render();
    dialog.querySelector('[data-modification-action="clear"]').focus({ preventScroll: true });
  });
  dialog.addEventListener("close", dismissUndo);
  translateControls();

  window.ModificationWorkbench = { loadCatalog, hasVehicle, open };
})();
