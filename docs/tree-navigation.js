(function () {
  "use strict";
  const asset = file => window.WTAssets?.url(file) || file;
  const flags = {usa: "us", germany: "de", ussr: "su", britain: "gb", japan: "jp", china: "cn", italy: "it", france: "fr", sweden: "se", israel: "il"};
  const icons = {ground: "truck", aviation: "plane", helicopters: "fan", ships: "ship", boats: "sailboat"};
  const labels = {ships: "远洋", boats: "近岸"};
  const countryLabels = {usa: "美国", germany: "德国", ussr: "苏联", britain: "英国", japan: "日本", china: "中国", italy: "意大利", france: "法国", sweden: "瑞典", israel: "以色列"};
  const typeLabels = {ground: "陆战", aviation: "空战", helicopters: "直升机", ships: "远洋舰队", boats: "近岸舰队"};
  const t = (source, params) => window.WTI18n.t(source, params);
  let loadingState = false;
  let pickerTitle, dismiss;
  let country, type, trigger, dialog, tabs, choices;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function icon(name) {
    const node = element("span", "nav-icon");
    node.style.setProperty("--nav-icon", `url("${asset(`assets/navigation/${name}.svg`)}")`);
    node.setAttribute("aria-hidden", "true");
    return node;
  }
  function flag(code) {
    const image = element("img", "country-flag");
    image.src = asset(`assets/flags/${flags[code]}.svg`);
    image.alt = "";
    return image;
  }
  function button(className, label) {
    const node = element("button", className);
    node.type = "button";
    node.setAttribute("aria-label", label);
    return node;
  }
  function close() { if (dialog.open) dialog.close(); }
  function position() {
    if (!dialog.open) return;
    if (matchMedia("(max-width: 720px)").matches) {
      dialog.style.removeProperty("left");
      dialog.style.removeProperty("top");
      return;
    }
    const anchor = trigger.getBoundingClientRect();
    dialog.style.left = Math.max(12, Math.min(anchor.left, innerWidth - dialog.offsetWidth - 12)) + "px";
    dialog.style.top = Math.max(12, Math.min(anchor.bottom + 8, innerHeight - dialog.offsetHeight - 12)) + "px";
  }
  function choose(select, value) {
    if (trigger.disabled) return;
    close();
    if (select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event("change", {bubbles: true}));
  }
  function sync(loading = false) {
    if (!trigger) return;
    loadingState = loading;
    const option = country.selectedOptions[0];
    const current = t(countryLabels[country.value] || option?.textContent || country.value);
    trigger.replaceChildren(flag(country.value), element("span", "country-current", current), icon("chevron-down"));
    trigger.setAttribute("aria-label", t("切换国家，当前{country}", {country: current}));
    trigger.title = t("切换国家");
    tabs.setAttribute("aria-label", t("军种"));
    pickerTitle.textContent = t("选择国家");
    dismiss.setAttribute("aria-label", t("关闭国家选择"));
    dismiss.title = t("关闭");
    trigger.disabled = loading;
    for (const node of tabs.children) {
      const source = typeLabels[node.dataset.type] || node.dataset.source;
      node.setAttribute("aria-label", t(source));
      node.title = t(source);
      node.querySelector(".branch-label").textContent = t(labels[node.dataset.type] || source);
      node.disabled = loading;
      node.setAttribute("aria-pressed", String(node.dataset.type === type.value));
    }
    for (const node of choices.children) {
      const label = t(countryLabels[node.dataset.country] || node.dataset.source);
      node.querySelector(".country-label").textContent = label;
      node.setAttribute("aria-label", label);
      node.setAttribute("aria-pressed", String(node.dataset.country === country.value));
    }
    tabs.setAttribute("aria-busy", String(loading));
  }
  function mount(countrySelect, typeSelect) {
    if (trigger) return;
    country = countrySelect;
    type = typeSelect;
    const toolbar = country.closest(".toolbar");
    const navigation = element("div", "tree-navigation");
    trigger = button("country-trigger", t("切换国家"));
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", "countryPicker");
    trigger.setAttribute("aria-expanded", "false");
    tabs = element("div", "branch-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", t("军种"));
    for (const option of type.options) {
      const node = button("branch-tab", option.textContent);
      node.dataset.type = option.value;
      node.dataset.source = option.textContent;
      node.title = option.textContent;
      node.append(icon(icons[option.value]), element("span", "branch-label", t(labels[option.value] || typeLabels[option.value] || option.textContent)));
      node.addEventListener("click", () => choose(type, option.value));
      tabs.append(node);
    }
    dialog = element("dialog", "country-picker");
    dialog.id = "countryPicker";
    dialog.setAttribute("aria-labelledby", "countryPickerTitle");
    const heading = element("header", "country-picker-heading");
    pickerTitle = element("h2", "", t("选择国家"));
    pickerTitle.id = "countryPickerTitle";
    dismiss = button("country-picker-close", t("关闭国家选择"));
    dismiss.title = t("关闭");
    dismiss.append(icon("x"));
    dismiss.addEventListener("click", close);
    heading.append(pickerTitle, dismiss);
    choices = element("div", "country-grid");
    for (const option of country.options) {
      const node = button("country-choice", option.textContent);
      node.dataset.country = option.value;
      node.dataset.source = option.textContent;
      node.append(flag(option.value), element("span", "country-label", t(countryLabels[option.value] || option.textContent)), icon("check"));
      node.addEventListener("click", () => choose(country, option.value));
      choices.append(node);
    }
    dialog.append(heading, choices);
    document.body.append(dialog);
    trigger.addEventListener("click", () => {
      dialog.showModal();
      trigger.setAttribute("aria-expanded", "true");
      position();
      choices.querySelector('[aria-pressed="true"]')?.focus({preventScroll: true});
    });
    dialog.addEventListener("close", () => trigger.setAttribute("aria-expanded", "false"));
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
    });
    window.addEventListener("resize", position);
    // The original selects remain the application's state and change-event contract.
    country.closest("label").hidden = true;
    type.closest("label").hidden = true;
    const filters = element("div", "tree-filters");
    filters.append(...toolbar.childNodes);
    navigation.append(trigger, tabs);
    toolbar.append(navigation, filters);
    toolbar.classList.add("has-tree-navigation");
    sync();
  }
  document.addEventListener("wt-language-change", () => {
    // Keep the current selection, focus, open picker and in-flight loading state.
    sync(loadingState);
    if (dialog?.open) position();
  });
  window.TreeNavigation = {mount, sync};
})();
