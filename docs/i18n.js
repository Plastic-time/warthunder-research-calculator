(() => {
  const locales = ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es'];
  const tags = { zh: 'zh-CN', en: 'en-US', ru: 'ru-RU', de: 'de-DE', fr: 'fr-FR', ja: 'ja-JP', es: 'es-ES' };
  const catalog = new Map();
  const missing = new Set();
  let locale = 'zh';
  try {
    const saved = localStorage.getItem('wt-research:language') || localStorage.getItem('wt-research:vehicle-language');
    if (locales.includes(saved)) locale = saved;
  } catch { /* Language switching still works when browser storage is disabled. */ }
  function t(source, params = {}, context = '') {
    const row = (context && catalog.get(context + '\u0004' + source)) || catalog.get(source);
    if (!row && locale !== 'zh' && /\p{Script=Han}/u.test(source)) missing.add(source);
    return String(row?.[locales.indexOf(locale)] || row?.[1] || source)
      .replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(params, key) ? String(params[key]) : match);
  }
  const attributes = ['title', 'placeholder', 'aria-label'];
  function translate(root = document) {
    const selector = '[data-i18n], ' + attributes.map(name => `[data-i18n-${name}]`).join(', ');
    const nodes = [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    for (const node of nodes) {
      const context = node.getAttribute('data-i18n-context') || '';
      if (node.hasAttribute('data-i18n')) node.textContent = t(node.getAttribute('data-i18n'), {}, context);
      for (const name of attributes) if (node.hasAttribute(`data-i18n-${name}`)) {
        node.setAttribute(name, t(node.getAttribute(`data-i18n-${name}`), {}, context));
      }
    }
  }
  function setLocale(value) {
    if (!locales.includes(value)) return;
    locale = value;
    document.documentElement.lang = tags[locale];
    try { localStorage.setItem('wt-research:language', locale); } catch { /* Optional persistence. */ }
    translate();
    document.dispatchEvent(new CustomEvent('wt-language-change', { detail: { locale } }));
  }
  window.WTI18n = { locales, tags, get locale() { return locale; }, get tag() { return tags[locale]; },
    t, translate, setLocale, missing,
    register(rows, context = '') {
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== locales.length || row.some(value => typeof value !== 'string' || !value)) {
          throw new Error('Incomplete translation row');
        }
        catalog.set(context ? context + '\u0004' + row[0] : row[0], row);
      }
    },
    number(value) { return new Intl.NumberFormat(tags[locale]).format(value); },
  };
  document.documentElement.lang = tags[locale];
  document.documentElement.setAttribute('data-ui-starting', '');
  document.addEventListener('DOMContentLoaded', () => {
    try {
      translate();
    } finally {
      document.documentElement.removeAttribute('data-ui-starting');
    }
  }, { once: true });
})();
