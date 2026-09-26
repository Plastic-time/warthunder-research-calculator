(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ResearchProgress = api;
})(typeof globalThis === "object" ? globalThis : this, function (root) {
  function amount(value, total) {
    if (!Number.isFinite(total) || total <= 0 || !Number.isSafeInteger(value) || value < 0) return 0;
    return Math.min(value, total);
  }
  function remaining(total, value) {
    return total == null ? null : total - amount(value, total);
  }
  function cleanMap(value) {
    const result = Object.create(null);
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [key, rp] of Object.entries(value)) {
      if (Number.isSafeInteger(rp) && rp > 0) result[key] = rp;
    }
    return result;
  }

  let dialog;
  function edit({ title, total, value, onSave }) {
    if (!Number.isSafeInteger(total) || total <= 0) return;
    const document = root.document;
    const t = (source, params) => root.WTI18n.t(source, params);
    const number = value => root.WTI18n.number(value);
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "research-progress-dialog";
      dialog.setAttribute("aria-labelledby", "researchProgressTitle");
      document.body.append(dialog);
    }
    if (dialog.open) dialog.close();
    dialog.innerHTML = '<form><h2 id="researchProgressTitle"></h2><p data-progress-name></p><label for="researchProgressInput"></label><input id="researchProgressInput" type="number" inputmode="numeric" min="0" step="1"><p data-progress-total></p><output for="researchProgressInput"></output><p data-progress-note></p><div class="research-progress-actions"><button type="button" data-progress-cancel></button><button type="submit" data-progress-save></button></div></form>';
    const input = dialog.querySelector("input");
    input.max = String(total);
    input.value = String(amount(value, total));
    dialog.querySelector("h2").textContent = t("研发进度");
    dialog.querySelector("[data-progress-name]").textContent = title;
    dialog.querySelector("label").textContent = t("已投入 RP");
    dialog.querySelector("[data-progress-total]").textContent = t("总计 {count} RP", { count: number(total) });
    dialog.querySelector("[data-progress-note]").textContent = t("仅扣减剩余 RP；银狮和已拥有、已研发状态不变。填 0 可清除进度。");
    dialog.querySelector("[data-progress-cancel]").textContent = t("取消");
    dialog.querySelector("[data-progress-save]").textContent = t("保存进度");
    const update = () => {
      const value = input.value === "" ? 0 : input.valueAsNumber;
      dialog.querySelector("output").textContent = input.validity.valid && Number.isSafeInteger(value)
        ? t("剩余 {count} RP", { count: number(remaining(total, value)) }) : t("请输入有效的整数 RP");
    };
    input.addEventListener("input", update);
    dialog.querySelector("[data-progress-cancel]").addEventListener("click", () => dialog.close());
    dialog.querySelector("form").addEventListener("submit", event => {
      event.preventDefault();
      const value = input.value === "" ? 0 : input.valueAsNumber;
      if (!input.reportValidity() || !Number.isSafeInteger(value)) return;
      onSave(value);
      dialog.close();
    });
    update();
    dialog.showModal();
    input.focus();
    input.select();
  }
  return { amount, remaining, cleanMap, edit };
});
