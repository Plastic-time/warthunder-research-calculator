(function (root) {
  "use strict";
  const normalize = value => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{Dash_Punctuation}_]+/gu, "");
  const matches = (text, query) => normalize(text).includes(normalize(query));

  function create(options) {
    const { input, tree } = options;
    const label = input.closest(".search-label");
    const heading = document.createElement("div");
    heading.className = "search-heading";
    const title = label.querySelector("[data-i18n]");
    title.id = "treeSearchLabel";
    input.setAttribute("aria-labelledby", title.id);
    title.before(heading);
    heading.append(title);
    const count = document.createElement("output");
    count.id = "searchResultCount";
    count.setAttribute("aria-live", "polite");
    count.setAttribute("aria-atomic", "true");
    heading.append(count);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.id = "clearSearchButton";
    clear.className = "search-clear";
    clear.innerHTML = '<span class="nav-icon" aria-hidden="true"></span>';
    label.append(clear);
    input.setAttribute("enterkeyhint", "search");
    let timer;
    let composing = false;
    let savedPosition = null;
    let scope = options.scope();
    let revision = 0;
    const t = (text, params) => root.WTI18n.t(text, params);
    const results = () => options.units().filter(options.matches);

    function refresh() {
      clear.hidden = !input.value;
      clear.title = t("清除搜索");
      clear.setAttribute("aria-label", clear.title);
      count.hidden = !options.query() || options.busy() || options.failed();
      const text = count.hidden ? "" : t("匹配 {count} 辆", { count: results().length });
      if (count.textContent !== text) count.textContent = text;
    }
    function restore(position) {
      tree.scrollLeft = position.left;
      tree.scrollTop = position.top;
      root.WTTreeScroll?.sync();
    }
    function commit() {
      clearTimeout(timer);
      if (composing) return;
      const query = input.value.trim();
      if (query === options.query()) { refresh(); return; }
      const version = ++revision;
      if (!options.query() && query && !options.busy()) {
        savedPosition = { left: tree.scrollLeft, top: tree.scrollTop };
      }
      options.setQuery(query);
      if (!options.busy()) {
        options.render();
        if (query) positionFirstMatch();
      }
      if (!query && savedPosition) {
        const position = savedPosition;
        savedPosition = null;
        restore(position);
        requestAnimationFrame(() => { if (version === revision) restore(position); });
      }
      refresh();
    }
    function changed() {
      ++revision;
      clearTimeout(timer);
      clear.hidden = !input.value;
      if (composing) return;
      if (!input.value.trim()) commit();
      else timer = setTimeout(commit, 180);
    }
    function positionFirstMatch() {
      if (options.busy() || options.failed() || !options.query()) return null;
      const unit = results()[0];
      if (!unit) return null;
      const selector = '[data-unit-id="' + CSS.escape(unit.data_unit_id) + '"]';
      const card = tree.querySelector(selector);
      const folder = !card && unit.parent_group_id
        ? tree.querySelector('[data-folder-group="' + CSS.escape(unit.parent_group_id) + '"]') : null;
      const anchor = card || folder?.closest(".folder-tile");
      if (!anchor) return null;
      const bounds = anchor.getBoundingClientRect();
      const viewport = tree.getBoundingClientRect();
      const rail = tree.querySelector(".rank-rail")?.getBoundingClientRect().width || 44;
      restore({ left: tree.scrollLeft + bounds.left - viewport.left - rail - 8,
        top: tree.scrollTop + bounds.top - viewport.top - 16 });
      return { selector, card, folder, anchor };
    }
    function locate() {
      const match = positionFirstMatch();
      if (!match) return;
      const { selector, card, folder, anchor } = match;
      const version = revision;
      // Let the tree's scroll-to-close handlers settle before opening a folded match.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (version !== revision || !anchor.isConnected) return;
        if (card) { card.focus({ preventScroll: true }); return; }
        folder.click();
        requestAnimationFrame(() => {
          if (version !== revision) return;
          const content = document.querySelector(".folder-popup-content");
          const match = content?.querySelector(selector);
          if (!match || !content.offsetWidth) return;
          content.scrollTop += match.getBoundingClientRect().top - content.getBoundingClientRect().top - 8;
          match.focus({ preventScroll: true });
        });
      }));
    }
    input.addEventListener("compositionstart", () => { composing = true; ++revision; clearTimeout(timer); });
    input.addEventListener("compositionend", () => { composing = false; changed(); });
    input.addEventListener("input", changed);
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter" || composing || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      document.dispatchEvent(new Event("wt-search-results"));
    });
    clear.addEventListener("click", event => {
      event.preventDefault();
      composing = false;
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus({ preventScroll: true });
    });
    document.addEventListener("wt-search-results", () => {
      commit();
      const version = revision;
      requestAnimationFrame(() => { if (!composing && version === revision) locate(); });
    });
    refresh();
    return {
      refresh,
      treeChanged() {
        ++revision;
        clearTimeout(timer);
        const next = options.scope();
        if (next !== scope) savedPosition = null;
        scope = next;
        if (!composing) options.setQuery(input.value.trim());
        refresh();
      },
    };
  }
  const api = { normalize, matches, create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TreeSearch = api;
})(typeof window === "undefined" ? globalThis : window);
