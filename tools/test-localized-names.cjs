const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsvLine, cleanName, localizedName } = require('./build-localized-names.cjs');
const { parseCsv, displayName, assertDisplayName, modificationTemplate } = require('./build-game-locales.cjs');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const commit = '510a793c2bdb01c51475118199c7b66b72935ff1';
const languages = ['de', 'en', 'es', 'fr', 'ja', 'ru', 'zh'];

assert.deepEqual(parseCsv('"id";"A; B";"He said ""yes"""\n"id2";"two\nlines";""'), [['id', 'A; B', 'He said "yes"'], ['id2', 'two\nlines', '']]);
assert.equal(displayName('100\\t\u30aa\u30af\u30bf\u30f3\\t\u71c3\u6599'), '100 \u30aa\u30af\u30bf\u30f3 \u71c3\u6599');
assert.equal(displayName('A\\nB\\r\\nC\\vD\\fE\tF'), 'A B C D E F');
assert.equal(displayName('\u2417\u200bA\u00a0B'), '\u2417A B');
assert.equal(displayName('\uf059A'), '\uf059A');
for (const value of ['A\\tB', '<color=red>Name</color>', '{unlockWeapons}', 'New %s mm', 'New %1$s mm', 'A\nB']) {
  assert.throws(() => assertDisplayName(value, 'fixture'), /Unresolved display formatting/);
}
assertDisplayName('100% fuel', 'literal percent');
const templateRows = new Map([['modification/_new_gun', { en: 'New %s mm MGs' }], ['modification/_new_gun/cannon', { en: 'New %s mm cannons' }]]);
assert.equal(modificationTemplate('bmg50_new_gun', { caliber: 12.7 }, templateRows).name.en, 'New 12.7 mm MGs');
assert.equal(modificationTemplate('cannon_new_gun', { caliber: 15 }, templateRows).name.en, 'New 15 mm cannons');

assert.deepEqual(parseCsvLine('"id";"A; B";"他说""好"""'), ['id', 'A; B', '他说"好"']);
assert.equal(cleanName('布\u200b伦\u200b海\u200b姆\u00a0Mk IV'), '布伦海姆 Mk IV');
const rows = new Map([
  ['shop/group/test_group', { en: 'Full Group Name', zh: '完整分组名称' }],
  ['test_unit_shop', { en: 'Test Unit', zh: '测试载具' }],
]);
assert.deepEqual(localizedName({id:'test_group',type:'multiple',fallback:'Short'}, rows), {en:'Full Group Name',zh:'完整分组名称'});
assert.deepEqual(localizedName({id:'test_unit',type:'single',fallback:'Short'}, rows), {en:'Test Unit',zh:'测试载具'});

const docs = read('docs/vehicle-names.json');
const local = read('public/vehicle-names.json');
assert.deepEqual(local, docs);
assert.equal(docs.schema, 1);
assert.equal(Object.keys(docs.names).length, docs.count);
assert.equal(docs.names.blenheim_group.en, 'Blenheim/Beaufort');
assert.equal(docs.names.blenheim_group.zh, '布伦海姆/波佛特');
assert.equal(docs.names.beaufighter_group.en, 'Beaufighter');
assert.equal(docs.names.j_7d.zh, '歼-7D');
assert.equal(docs.names.su_30mkk.zh, '␗苏-30MKK');
assert(docs.translated > 2000);
assert.equal(docs.count, 3636);
assert.equal(docs.sourceSha256, 'dcb65aaa40cbf3279b2e77140300b5750858fa3db6b5e6a77fedef882e146788');

const modifications = read('docs/modification-names.json');
assert.equal(modifications.count, 1911);
assert.equal(modifications.occurrences, 52474);
assert.equal(modifications.sourceSha256, '9a13db9b67bc5ab676fc3feb4ae4c27df069a479f4f8a4a0ebab6f5a427454ff');
assert.equal(modifications.names['100_octan_spitfire'].ja, '100 \u30aa\u30af\u30bf\u30f3 \u71c3\u6599');
assert.equal(modifications.names.bmg50_new_gun.en, 'New 12.7 mm MGs');
assert.equal(Object.keys(modifications.templates).length, 260);

for (const [kind, payload] of [['vehicle', docs], ['modification', modifications]]) {
  assert.deepEqual(read(`public/${kind}-names.json`), payload, `${kind}: copies differ`);
  assert.equal(payload.schema, 1);
  assert.equal(payload.commit, commit);
  assert.equal(payload.version, '2.59.0.17');
  assert.ok(payload.source.includes(`/${commit}/`));
  assert.deepEqual([...payload.languages].sort(), languages);
  assert.equal(Object.keys(payload.names).length, payload.count);
  for (const [id, name] of Object.entries(payload.names)) {
    assert.deepEqual(Object.keys(name).sort(), languages, `${kind}:${id}: language keys`);
    for (const language of languages) {
      assertDisplayName(name[language], `${kind}:${id}:${language}`);
      assert.equal(displayName(name[language]), name[language], `${kind}:${id}:${language}: unnormalized`);
    }
  }
  for (const language of languages) {
    const coverage = payload.coverage.languages[language];
    assert.equal(coverage.source + coverage.englishFallback + coverage.existingFallback + coverage.idFallback, payload.count);
    assert.equal(coverage.source, kind === 'vehicle' ? 3636 : 1320);
    assert.equal(coverage.englishFallback, 0);
    assert.equal(coverage.existingFallback, kind === 'vehicle' ? 0 : 507);
    assert.equal(coverage.idFallback, kind === 'vehicle' ? 0 : 84);
    assert.equal(Object.values(payload.coverage.fallbacks).filter(value => value[language]).length, payload.count - coverage.source);
  }
  assert.equal(payload.coverage.missingKeys.length, kind === 'vehicle' ? 0 : 591);
}
for (const source of modifications.sources) {
  assert.equal(source.commit, commit);
  assert.equal(source.version, '2.59.0.17');
  assert.ok(source.source.includes(`/${commit}/`));
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
}
const catalog = read('docs/database/modifications/catalog.json');
const modificationIds = new Set();
for (const chunk of Object.values(catalog.chunks)) {
  for (const vehicle of Object.values(read(`docs/${chunk.path}`).v)) {
    for (const mod of vehicle.m) modificationIds.add(mod[0]);
  }
}
assert.deepEqual(Object.keys(modifications.names).sort(), [...modificationIds].sort());
console.log(JSON.stringify({ pass: true, commit, languages: languages.length, vehicles: docs.count, modifications: modifications.count, modificationSourceNames: 1320, modificationFallbacks: 591 }));
