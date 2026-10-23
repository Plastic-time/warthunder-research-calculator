(function () {
  "use strict";
  const t = (source, params) => window.WTI18n.t(source, params);
  const failure = (source, params) => Object.assign(new Error(t(source, params)), { translationSource: source, translationParams: params });

  let activeJob = null;
  const imageCache = new Map();
  const CACHE_ENTRIES = 128;
  const CACHE_BYTES = 16 * 1024 * 1024;
  let cacheBytes = 0;
  let dialog;

  function forgetImage(url) {
    if (imageCache.has(url)) {
      cacheBytes -= imageCache.get(url).length * 2;
      imageCache.delete(url);
    }
  }

  function cacheImage(url, value) {
    forgetImage(url);
    const bytes = value.length * 2;
    if (bytes > CACHE_BYTES) return;
    imageCache.set(url, value);
    cacheBytes += bytes;
    while (imageCache.size > CACHE_ENTRIES || cacheBytes > CACHE_BYTES) {
      const oldest = imageCache.keys().next().value;
      forgetImage(oldest);
    }
  }

  function cancel() {
    if (!activeJob) return;
    activeJob.controller.abort();
    report(activeJob, "正在取消…");
  }

  function report(job, source, done, total) {
    job.progress = { source, done, total };
    if (!job.showProgress) return;
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "tree-export-dialog";
      dialog.setAttribute("aria-labelledby", "treeExportTitle");
      dialog.innerHTML = '<h2 id="treeExportTitle"></h2><p data-export-status role="status" aria-live="polite"></p><progress></progress><footer><button type="button" data-export-cancel><span class="nav-icon" aria-hidden="true"></span><span></span></button></footer>';
      dialog.querySelector(".nav-icon").style.setProperty("--nav-icon", `url('${window.WTAssets?.url("assets/navigation/x.svg") || "assets/navigation/x.svg"}')`);
      dialog.querySelector("button").addEventListener("click", cancel);
      dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); });
      document.body.append(dialog);
    }
    dialog.querySelector("h2").textContent = t("导出科技树截图");
    const text = t(source, { done, total });
    dialog.querySelector("[data-export-status]").textContent = text;
    const meter = dialog.querySelector("progress");
    meter.setAttribute("aria-label", text);
    if (total > 0) { meter.max = total; meter.value = done; }
    else meter.removeAttribute("value");
    dialog.querySelector("button").disabled = job.controller.signal.aborted;
    dialog.querySelector("button span:last-child").textContent = t("取消");
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener("wt-language-change", () => {
    if (!activeJob?.progress) return;
    const { source, done, total } = activeJob.progress;
    report(activeJob, source, done, total);
  });

  function readDataUrl(blob, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const abort = () => reader.abort();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(t("图片读取失败")));
      reader.onabort = () => reject(signal.reason);
      reader.onloadend = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      reader.readAsDataURL(blob);
    });
  }

  async function embedImage(url, job) {
    const signal = job.controller.signal;
    signal.throwIfAborted();
    if (url.startsWith("data:")) return url;
    if (imageCache.has(url)) {
      const value = imageCache.get(url);
      imageCache.delete(url);
      imageCache.set(url, value);
      return value;
    }
    if (!job.pending.has(url)) {
      const pending = (async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          signal.throwIfAborted();
          const controller = new AbortController();
          const abort = () => controller.abort(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          const timeout = setTimeout(() => controller.abort(), 15000);
          try {
            // Reload avoids a cached no-CORS image response being reused for export.
            const response = await fetch(url, {
              mode: "cors", cache: "reload", signal: controller.signal,
            });
            if (!response.ok) throw new Error("HTTP " + response.status);
            const blob = await response.blob();
            if (!blob.type.startsWith("image/")) throw new Error(t("无效图片"));
            const value = await readDataUrl(blob, controller.signal);
            signal.throwIfAborted();
            cacheImage(url, value);
            return value;
          } catch (error) {
            signal.throwIfAborted();
            if (attempt === 1) throw error;
          } finally {
            clearTimeout(timeout);
            signal.removeEventListener("abort", abort);
          }
        }
      })();
      job.pending.set(url, pending);
      pending.then(() => job.pending.delete(url), () => job.pending.delete(url));
    }
    return job.pending.get(url);
  }

  async function embedImages(root, job) {
    const images = [...root.querySelectorAll("img")];
    let index = 0;
    let done = 0;
    const failed = [];
    report(job, "载入图片 {done}/{total}", done, images.length);
    await Promise.all(Array.from({ length: Math.min(8, images.length) }, async () => {
      while (index < images.length) {
        job.controller.signal.throwIfAborted();
        const img = images[index++];
        const url = img.src;
        try {
          img.src = await embedImage(url, job);
          img.removeAttribute("srcset");
          img.loading = "eager";
          await img.decode();
        } catch {
          job.controller.signal.throwIfAborted();
          forgetImage(url);
          failed.push(img);
        }
        job.controller.signal.throwIfAborted();
        report(job, "载入图片 {done}/{total}", ++done, images.length);
      }
    }));
    if (failed.length) throw failure("{count} 张载具图片未能读取，请检查网络后重试", { count: failed.length });
  }

  async function renderCanvas(payload, source, drawConnections, job) {
    let host;
    let canvas;
    try {
      // Snapshot before awaiting assets so later UI changes cannot alter this export.
      const tree = source.cloneNode(true);
      const width = Math.ceil(Math.max(source.scrollWidth, source.getBoundingClientRect().width));
      tree.style.width = width + "px";
      tree.style.minWidth = width + "px";
      host = document.createElement("div");
      host.inert = true;
      host.setAttribute("aria-hidden", "true");
      Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", width: width + "px", pointerEvents: "none" });
      const sheet = document.createElement("div");
      sheet.className = "tree-screenshot";
      sheet.style.width = width + "px";
      const header = document.createElement("header");
      header.className = "tree-screenshot-header";
      const title = document.createElement("strong");
      title.textContent = t("{country} · {type} 科技树", { country: payload.country, type: payload.type });
      const meta = document.createElement("span");
      meta.textContent = payload.generatedAt;
      header.append(title, meta);
      const totals = document.createElement("div");
      totals.className = "tree-screenshot-totals";
      const groups = [
        { heading: "科技树总额", count: payload.treeCount, rp: payload.treeRp, sl: payload.treeSl, rpLabel: payload.treeRpLabel, slLabel: payload.treeSlLabel, unknown: payload.treeUnknownCount, unavailable: payload.treeUnavailable },
        { heading: "当前选择还需", count: payload.pendingCount, rp: payload.totalRp, sl: payload.totalSl, rpLabel: payload.rpLabel, slLabel: payload.slLabel, unknown: payload.pendingUnknownCount },
      ];
      for (const group of groups) {
        const section = document.createElement("section");
        section.className = "tree-screenshot-budget";
        const label = document.createElement("h2");
        label.textContent = t(group.heading) + (group.count == null ? "" : " · " + t("{count} 个载具", { count: group.count }));
        section.append(label);
        const prices = document.createElement("div");
        prices.className = "tree-screenshot-prices";
        for (const [name, value, kind] of [[group.rpLabel, group.rp, "rp"], [group.slLabel, group.sl, "sl"]]) {
          const cost = document.createElement("div");
          cost.className = "tree-screenshot-cost " + kind;
          const caption = document.createElement("span");
          caption.textContent = name;
          const number = document.createElement("strong");
          number.textContent = value;
          cost.append(caption, number);
          prices.append(cost);
        }
        section.append(prices);
        if (group.unknown || group.unavailable) {
          const warning = document.createElement("p");
          warning.className = "tree-screenshot-warning";
          warning.textContent = group.unavailable ? t("载具收录对照暂不可用") : t("{count} 辆费用不完整，仅汇总已知数值", { count: group.unknown });
          section.append(warning);
        }
        totals.append(section);
      }
      const scope = document.createElement("p");
      scope.className = "tree-screenshot-scope";
      scope.textContent = t("科技树总额含折叠载具，不含金币、联队及隐藏载具；当前选择按未拥有和剩余研发计算。");
      sheet.append(header, totals, scope, tree, totals.cloneNode(true));
      host.append(sheet);
      document.body.append(host);
      // Draw immediately against the same unit state as the snapshot, including on mobile.
      drawConnections?.(tree);
      await new Promise((resolve, reject) => {
        const signal = job.controller.signal;
        signal.throwIfAborted();
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        document.fonts.ready.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
      job.controller.signal.throwIfAborted();
      await embedImages(tree, job);
      const height = Math.ceil(sheet.scrollHeight);
      // Re-render text and paths at 2x without increasing the existing mobile canvas limits.
      const scale = Math.min(2, 16000 / width, 16000 / height, Math.sqrt(32000000 / (width * height)));
      report(job, "生成高清截图…");
      canvas = await window.htmlToImage.toCanvas(sheet, {
        width, height, pixelRatio: scale, backgroundColor: getComputedStyle(sheet).backgroundColor,
        skipAutoScale: true,
      });
      // Rasterization cannot be interrupted. Keep the job locked until it settles.
      job.controller.signal.throwIfAborted();
      if (!canvas.width || !canvas.height) throw failure("科技树截图尺寸无效");
      return canvas;
    } catch (error) {
      if (canvas) canvas.width = canvas.height = 0;
      job.controller.signal.throwIfAborted();
      throw failure(error.translationSource || "截图生成失败", error.translationParams);
    } finally {
      host?.remove();
    }
  }

  async function run(payload, source, drawConnections, save) {
    if (activeJob) throw new Error(t("正在生成科技树截图，请稍候"));
    if (!source || !window.htmlToImage) throw new Error(t("科技树或截图组件尚未载入"));
    const job = { controller: new AbortController(), pending: new Map(), showProgress: save };
    activeJob = job;
    let canvas;
    try {
      report(job, "准备科技树…");
      canvas = await renderCanvas(payload, source, drawConnections, job);
      if (!save) return canvas;
      report(job, "保存图片…");
      return await saveCanvas(canvas, payload, job);
    } catch (error) {
      job.controller.signal.throwIfAborted();
      throw error;
    } finally {
      job.controller.abort();
      job.pending.clear();
      if (save && canvas) canvas.width = canvas.height = 0;
      if (job.showProgress && dialog?.open) dialog.close();
      activeJob = null;
    }
  }

  async function saveCanvas(canvas, payload, job) {
    const blob = await new Promise((resolve, reject) => {
      try {
        canvas.toBlob(value => value ? resolve(value) : reject(failure("截图生成失败")), "image/png");
      } catch {
        reject(failure("截图生成失败"));
      }
    });
    job.controller.signal.throwIfAborted();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = (payload.filename || "war-thunder-tree.png").replace("route-", "tree-");
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { width: canvas.width, height: canvas.height, blob };
  }

  window.RouteExporter = {
    render: (payload, source, draw) => run(payload, source, draw, false),
    download: (payload, source, draw) => run(payload, source, draw, true),
    cancel,
    isBusy: () => Boolean(activeJob),
  };
})();
