const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = { window: {}, localStorage: { getItem: () => 'en', setItem() {} },
  document: { documentElement: { setAttribute() {}, removeAttribute() {} }, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => [] },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
};
for (const file of ['i18n.js', 'app-translations.js', 'static-translations.js', 'module-translations.js']) {
  vm.runInNewContext(fs.readFileSync(`public/${file}`, 'utf8'), sandbox);
}
const i18n = sandbox.window.WTI18n;
assert.equal(i18n.t('精确规划'), 'Optimize route');
assert.equal(i18n.t('等级 {rank}', { rank: 'II' }), 'Rank II');
assert.equal(i18n.t('等级'), 'Tier');
assert.equal(i18n.t('等级补足'), 'Rank filler');
assert.equal(i18n.t('等级补足', {}, 'modifications'), 'Tier filler');
assert.equal(i18n.t('组合载具部件'), 'Multi-vehicle component');
assert.equal(i18n.t('金鹰载具'), 'Premium (GE)');
assert.equal(i18n.t('清除已研发'), 'Clear researched marks');
assert.equal(i18n.t('全部配件'), 'Select all modifications');
assert.equal(i18n.t('{count} 个载具', { count: 1 }), 'Vehicles: 1');
assert.equal(i18n.t('{count} 个载具', { count: 2 }), 'Vehicles: 2');
assert.equal(i18n.t('已选 {count} 辆', { count: 1 }), '1 selected');
assert(i18n.t('可自由选择任意配件，点击计算后自动补齐前置').includes('Calculate costs'));
assert(i18n.t('选择目标后点击“精确规划”').includes('Optimize route'));
for (const locale of i18n.locales) {
  i18n.setLocale(locale);
  if (locale === 'zh') assert.equal(i18n.t('等级补足', {}, 'modifications'), i18n.t('等级补足'));
  assert.equal(i18n.t('目标', {}, 'modifications'), i18n.t('目标'), 'Context falls back to shared labels');
}
console.log(JSON.stringify({ terminology: true, contextSpecificTier: true, commandConsistency: true, counts: true, contextFallback: true }));
