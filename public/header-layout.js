(() => {
  "use strict";
  const mobile = matchMedia("(max-width: 720px), (max-width: 900px) and (max-height: 500px) and (pointer: coarse)");
  const topbar = document.querySelector(".topbar");
  const toolbar = document.querySelector(".toolbar");
  const brand = document.querySelector(".brand-title");
  const heading = brand.querySelector("h1");
  const t = source => window.WTI18n.t(source);
  const asset = file => new URL(file, document.baseURI).href;
  const node = (tag, className) => Object.assign(document.createElement(tag), { className });
  const lockup = node("div", "brand-lockup");
  const emblem = Object.assign(node("img", "brand-emblem"), { src: asset("assets/research-emblem.png"), alt: "", width: 44, height: 44 });
  brand.prepend(lockup);
  lockup.append(emblem, heading);
  heading.removeAttribute("data-i18n");
  const metadata = node("div", "header-metadata");
  const status = document.getElementById("statusText");
  status.before(metadata);
  metadata.append(status);
  const version = document.querySelector(".game-version");
  const online = document.getElementById("onlineCount");
  if (online) metadata.append(online);
  const controls = node("div", "mobile-header-controls");
  topbar.append(controls);
  const sheets = [];
  const buttons = [];
  const placements = [];
  let compactTools;
  const budget = document.getElementById("floatingBudget");
  const tree = document.getElementById("treeContainer");
  // Translations and large totals can make the dock taller; keep the last row reachable.
  if (budget && tree) {
    new ResizeObserver(() => {
      tree.style.setProperty("--mobile-budget-height", Math.ceil(budget.getBoundingClientRect().height) + "px");
    }).observe(budget);
  }

  function iconButton(label, name) {
    const button = node("button", "header-icon-button");
    button.type = "button";
    button.dataset.label = label;
    if (name) {
      const icon = node("span", "nav-icon");
      icon.style.setProperty("--nav-icon", 'url("' + asset("assets/navigation/" + name + ".svg") + '")');
      icon.setAttribute("aria-hidden", "true");
      button.append(icon);
    }
    buttons.push(button);
    return button;
  }
  function closeSheets() {
    for (const entry of sheets) if (entry.dialog.open) entry.dialog.close();
  }
  function sheet(id, title, trigger) {
    const dialog = node("dialog", "mobile-header-sheet");
    dialog.id = id;
    const header = node("header", "mobile-sheet-heading");
    const label = node("h2", "");
    label.id = id + "-title";
    label.dataset.i18n = title;
    dialog.setAttribute("aria-labelledby", label.id);
    const dismiss = iconButton("关闭", "x");
    dismiss.addEventListener("click", () => dialog.close());
    header.append(label, dismiss);
    const body = node("div", "mobile-sheet-body");
    dialog.append(header, body);
    document.body.append(dialog);
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", id);
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", () => {
      closeSheets();
      dialog.showModal();
      trigger.setAttribute("aria-expanded", "true");
      if (id === "mobileSearch") document.getElementById("searchInput").focus();
    });
    dialog.addEventListener("close", () => trigger.setAttribute("aria-expanded", "false"));
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    sheets.push({ dialog, trigger });
    return body;
  }
  function relocate(element, target) {
    const placeholder = document.createComment("Desktop position");
    element.before(placeholder);
    placements.push({ element, target, placeholder });
  }
  const authorButton = iconButton("作者", "");
  authorButton.id = "mobileAuthorButton";
  const avatar = document.querySelector(".creator-avatar").cloneNode();
  avatar.width = avatar.height = 30;
  authorButton.append(avatar);
  const moreButton = iconButton("更多", "ellipsis");
  moreButton.id = "mobileMoreButton";
  controls.append(authorButton, moreButton);
  const creator = document.querySelector(".creator-watermark");
  const creatorSlot = node("div", "header-creator");
  topbar.insertBefore(creatorSlot, controls);
  creatorSlot.append(creator);
  relocate(creator, sheet("mobileAuthor", "作者", authorButton));
  const actions = document.querySelector(".topbar-actions");
  const actionArea = node("div", "header-actions-area");
  actions.before(actionArea);
  actionArea.append(version, actions);
  relocate(actions, sheet("mobileMore", "更多", moreButton));
  actions.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (mobile.matches && button && !button.disabled) closeSheets();
  }, true);

  function refreshText() {
    const full = t("战争雷霆研发计算器");
    const name = node("span", "brand-name");
    name.textContent = window.WTI18n.locale === "zh" ? "战争雷霆" : "Warthunder";
    if (window.WTI18n.locale === "zh") {
      name.classList.add("is-chinese");
      name.replaceChildren(...Array.from(name.textContent, character => {
        const glyph = node("span", "");
        glyph.textContent = character;
        return glyph;
      }));
    }
    const subtitle = node("span", "brand-subtitle");
    subtitle.textContent = full.replace(/战争雷霆|Warthunder\s*/i, "").trim();
    heading.replaceChildren(name, document.createTextNode(window.WTI18n.locale === "zh" ? "" : " "), subtitle);
    for (const button of buttons) {
      button.title = t(button.dataset.label);
      button.setAttribute("aria-label", button.title);
      const caption = button.querySelector(".select-tree-label");
      if (caption) caption.textContent = t("全选");
    }
    for (const { dialog } of sheets) window.WTI18n.translate(dialog);
  }
  function respond() {
    closeSheets();
    topbar.classList.toggle("compact-header", mobile.matches);
    for (const { element, target, placeholder } of placements) {
      if (mobile.matches) target.append(element);
      else placeholder.after(element);
    }
    window.dispatchEvent(new Event("resize"));
  }
  function mountFilters() {
    const filters = toolbar.querySelector(".tree-filters");
    if (!filters) return false;
    compactTools = node("div", "mobile-tree-tools");
    const search = iconButton("搜索", "search");
    search.id = "mobileSearchButton";
    const options = iconButton("筛选", "sliders-horizontal");
    options.id = "mobileFiltersButton";
    const searchBody = sheet("mobileSearch", "搜索", search);
    const filterBody = sheet("mobileFilters", "筛选", options);
    const done = node("button", "secondary-button mobile-search-done");
    done.type = "button";
    done.dataset.i18n = "查看结果";
    done.addEventListener("click", closeSheets);
    searchBody.append(done);
    searchBody.addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target.id === "searchInput") {
        event.preventDefault();
        closeSheets();
      }
    });
    const selectTree = iconButton("全选当前科技树", "check");
    selectTree.id = "selectTreeButton";
    selectTree.setAttribute("role", "checkbox");
    selectTree.setAttribute("aria-checked", "false");
    const checkbox = node("span", "select-tree-box");
    checkbox.setAttribute("aria-hidden", "true");
    checkbox.append(selectTree.firstElementChild);
    const caption = node("span", "select-tree-label");
    selectTree.replaceChildren(checkbox, caption);
    selectTree.disabled = true;
    selectTree.addEventListener("click", () => document.dispatchEvent(new Event("wt-select-tree")));
    const selectionOptions = node("div", "tree-selection-options");
    const avoidFolded = filters.querySelector(".planner-option");
    avoidFolded.before(selectionOptions);
    selectionOptions.append(avoidFolded, selectTree);
    const searchLabel = filters.querySelector(".search-label");
    // Move the original controls: their listeners, selections and planner state stay intact.
    relocate(searchLabel, searchBody);
    for (const field of [...filters.children]) {
      if (field !== searchLabel && !field.hidden) relocate(field, filterBody);
    }
    relocate(metadata, compactTools);
    const actions = node("div", "mobile-tree-actions");
    actions.append(search, options);
    compactTools.append(actions);
    toolbar.append(compactTools);
    const input = document.getElementById("searchInput");
    function searchState() {
      search.classList.toggle("has-value", !!input.value.trim());
    }
    input.addEventListener("input", searchState);
    searchState();
    refreshText();
    respond();
    return true;
  }
  mobile.addEventListener("change", respond);
  document.addEventListener("wt-language-change", refreshText);
  document.addEventListener("DOMContentLoaded", refreshText, { once: true });
  refreshText();
  respond();
  if (!mountFilters()) {
    const observer = new MutationObserver(() => { if (mountFilters()) observer.disconnect(); });
    observer.observe(toolbar, { childList: true });
  }
})();
