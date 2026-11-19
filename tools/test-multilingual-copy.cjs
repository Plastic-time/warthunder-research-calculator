const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = { window: {}, localStorage: { getItem: () => 'zh', setItem() {} },
  document: { documentElement: { setAttribute() {}, removeAttribute() {} }, addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => [] },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
};
for (const file of ['i18n.js', 'app-translations.js', 'static-translations.js', 'module-translations.js']) {
  vm.runInNewContext(fs.readFileSync(`public/${file}`, 'utf8'), sandbox);
}
const i18n = sandbox.window.WTI18n;
const terms = {
  ru: { plan: 'Подобрать маршрут', rank: 'Добор для ранга', tier: 'Добор для уровня', owned: 'В наличии', count: 'Количество техники: {count}' },
  de: { plan: 'Route optimieren', rank: 'Rangergänzung', tier: 'Stufenergänzung', owned: 'Im Besitz', count: 'Fahrzeuge: {count}' },
  fr: { plan: 'Optimiser le parcours', rank: 'Complément de rang', tier: 'Complément de palier', owned: 'Possédé', count: 'Véhicules : {count}' },
  ja: { plan: 'ルート最適化', rank: 'ランク条件の補充', tier: '改造段階の補充', owned: '所有済み', count: '兵器数：{count}' },
  es: { plan: 'Optimizar ruta', rank: 'Complemento de rango', tier: 'Complemento de nivel', owned: 'Adquirido', count: 'Vehículos: {count}' },
};
const planningInstructions = [
  '计划已改变，请点击“精确规划”重新计算',
  '选择目标后点击“精确规划”',
  '点击底部研发总计右侧的“精确规划”。下滑查看科技树时，底栏仍保持可见。',
];
const prerequisiteGuide = '“必经路线”是前置载具，“等级补足”是为满足下一级解锁数量而自动加入的载具。';
for (const locale of i18n.locales) {
  i18n.setLocale(locale);
  for (const key of planningInstructions) assert(i18n.t(key).includes(i18n.t('精确规划')), `${locale}: guide/button mismatch`);
  if (terms[locale]) {
    const expected = terms[locale];
    assert.equal(i18n.t('精确规划'), expected.plan);
    assert.equal(i18n.t('等级补足'), expected.rank);
    assert.equal(i18n.t('等级补足', {}, 'modifications'), expected.tier);
    assert.equal(i18n.t('已拥有'), expected.owned);
    assert(i18n.t(prerequisiteGuide).includes(expected.rank), `${locale}: rank legend/guide mismatch`);
    for (const count of [0, 1, 2, 5, 21]) {
      assert.equal(i18n.t('{count} 个载具', { count }), expected.count.replace('{count}', count));
    }
  }
  if (locale !== 'zh') {
    for (const key of ['选择配件后点击计算', '可自由选择任意配件，点击计算后自动补齐前置']) {
      assert(i18n.t(key).includes(i18n.t('计算配件研发')), `${locale}: modification guide/button mismatch`);
    }
    assert.notEqual(i18n.t('等级补足'), i18n.t('等级补足', {}, 'modifications'));
  }
  assert.equal(i18n.t('目标', {}, 'modifications'), i18n.t('目标'));
}

// Source: gszabi99/War-Thunder-Datamine, game 2.59.0.17,
// lang.vromfs.bin_u/lang/units_modifications.csv @ 510a793c2bdb01c51475118199c7b66b72935ff1.
const categories = {
  ru: ['Вооружение', 'Подвижность', 'Защищенность', 'Мореходность', 'Непотопляемость'],
  de: ['Bewaffnung', 'Mobilität', 'Schutz', 'Seegangverhalten', 'Sinkschutz'],
  fr: ['Armement', 'Mobilité', 'Protection', 'Tenue en mer', 'Insubmersibilité'],
  ja: ['武装関連', '機動力', '防御力', '凌波性', '応急処置'],
  es: ['Armamento', 'Movilidad', 'Protección', 'Navegabilidad', 'Insumergibilidad'],
};
for (const [locale, expected] of Object.entries(categories)) {
  i18n.setLocale(locale);
  assert.deepEqual(['武器', '机动性', '防护', '适航性', '抗沉性'].map(key => i18n.t(key)), expected);
}
assert.equal(i18n.missing.size, 0);
console.log(JSON.stringify({ languages: 7, commandConsistency: true, rankTierSeparation: true,
  ownershipSemantics: true, countGrammar: true, pinnedCategoryTerms: true }));
