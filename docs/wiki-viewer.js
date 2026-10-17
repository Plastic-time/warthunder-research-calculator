(() => {
  'use strict';
  const asset = file => window.WTAssets?.url(file) || file;
  const t = (source, params) => window.WTI18n.t(source, params);
  const dialog = document.createElement('dialog');
  dialog.id = 'wikiDialog';
  dialog.className = 'wiki-dialog';
  dialog.setAttribute('aria-labelledby', 'wikiTitle');
  dialog.innerHTML = `<div class="wiki-window">
    <header class="wiki-heading"><div><small></small><h2 id="wikiTitle"></h2></div>
      <nav><button type="button" data-wiki-reload><img src="${asset('assets/wiki/rotate-cw.svg')}" alt=""></button>
      <a data-wiki-external target="_blank" rel="noopener noreferrer"><img src="${asset('assets/wiki/external-link.svg')}" alt=""></a>
      <button type="button" data-wiki-close autofocus><img src="${asset('assets/wiki/x.svg')}" alt=""></button></nav>
    </header><p class="wiki-load-status" role="status" hidden><span></span><a target="_blank" rel="noopener noreferrer" hidden></a></p><div class="wiki-frame-host"></div></div>`;
  document.body.append(dialog);
  const heading = dialog.querySelector('h2');
  const external = dialog.querySelector('[data-wiki-external]');
  const status = dialog.querySelector('[role="status"]');
  const statusText = status.querySelector('span');
  const statusLink = status.querySelector('a');
  const host = dialog.querySelector('.wiki-frame-host');
  let url = '', timeout, trigger, requestId = 0;
  let vehicleId = '', fallbackTitle = '';
  function translate() {
    dialog.querySelector('small').textContent = t('战争雷霆 Wiki');
    dialog.querySelector('nav').setAttribute('aria-label', t('Wiki 操作'));
    for (const [selector, source] of [['[data-wiki-reload]', '重新加载'], ['[data-wiki-external]', '在新标签页打开 Wiki'], ['[data-wiki-close]', '关闭 Wiki']]) {
      const element = dialog.querySelector(selector);
      element.title = t(source);
      element.setAttribute('aria-label', t(source));
    }
    statusLink.textContent = t('在新标签页打开 Wiki');
    const states = { loading: '正在载入 Wiki…', error: 'Wiki 未能载入。', slow: '如果页面空白或无法浏览，' };
    statusText.textContent = states[dialog.dataset.loadState] ? t(states[dialog.dataset.loadState]) : '';
    if (vehicleId) heading.textContent = typeof displayTitle === 'function'
      ? displayTitle({ data_unit_id: vehicleId, title: fallbackTitle || vehicleId }) : fallbackTitle || vehicleId;
    if (host.firstElementChild) host.firstElementChild.title = t('{vehicle} - 战争雷霆 Wiki', { vehicle: heading.textContent });
  }
  let touchStart = null;
  document.addEventListener('touchstart', event => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    touchStart = touch ? {x: touch.clientX, y: touch.clientY, time: performance.now()} : null;
  }, {capture: true, passive: true});
  document.addEventListener('click', event => {
    const start = touchStart;
    touchStart = null;
    if (!start || event.detail === 0 || performance.now() - start.time > 1200) return;
    const target = event.target.closest('.unit-actions button, .unit-tile[data-unit-id]');
    if (!target) return;
    const box = target.getBoundingClientRect();
    // Mobile browsers may redirect a tap in a gap to a nearby control.
    if (start.x < box.left || start.x > box.right || start.y < box.top || start.y > box.bottom) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  function load() {
    clearTimeout(timeout);
    const currentRequest = ++requestId;
    dialog.dataset.loadState = 'loading';
    status.hidden = false;
    statusText.textContent = t('正在载入 Wiki…');
    statusLink.hidden = true;
    statusLink.href = url;
    const frame = document.createElement('iframe');
    const isCurrent = () => dialog.open && requestId === currentRequest && host.firstElementChild === frame;
    frame.title = t('{vehicle} - 战争雷霆 Wiki', { vehicle: heading.textContent });
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    frame.addEventListener('load', () => {
      if (!isCurrent()) return;
      clearTimeout(timeout);
      dialog.dataset.loadState = 'loaded';
      status.hidden = true;
      statusText.textContent = '';
    });
    frame.addEventListener('error', () => {
      if (!isCurrent()) return;
      clearTimeout(timeout);
      dialog.dataset.loadState = 'error';
      status.hidden = false;
      statusText.textContent = t('Wiki 未能载入。');
      statusLink.hidden = false;
    });
    frame.src = url;
    host.replaceChildren(frame);
    // A cross-origin frame may show content while still waiting for subresources.
    timeout = setTimeout(() => {
      if (!isCurrent()) return;
      dialog.dataset.loadState = 'slow';
      status.hidden = false;
      statusText.textContent = t('如果页面空白或无法浏览，');
      statusLink.hidden = false;
    }, 8000);
  }

  function open(id, title, source) {
    if (typeof id !== 'string' || !/^[a-z0-9_-]+$/i.test(id)) return;
    url = `https://wiki.warthunder.com/unit/${encodeURIComponent(id)}`;
    vehicleId = id;
    fallbackTitle = title || id;
    translate();
    external.href = url;
    trigger = source || document.activeElement;
    if (!dialog.open) dialog.showModal();
    load();
  }
  dialog.querySelector('[data-wiki-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-wiki-reload]').addEventListener('click', load);
  dialog.addEventListener('close', () => {
    requestId += 1;
    clearTimeout(timeout);
    dialog.dataset.loadState = 'closed';
    status.hidden = true;
    statusText.textContent = '';
    host.replaceChildren();
    if (trigger?.isConnected) trigger.focus({preventScroll: true});
  });
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-wiki-id]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    open(button.dataset.wikiId, button.dataset.wikiTitle, button);
  });
  window.WikiViewer = {open};
  document.addEventListener('wt-language-change', translate);
  translate();
})();
