const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const cheerio = require('cheerio');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const {version} = require('../package.json');
const lock = require('../package-lock.json');
const game = require('../config/data-version.json').latestReview;

test('package, lock, current release notes and README downloads share one version', () => {
  assert.equal(version,'1.0.30');
  assert.equal(lock.version,version);
  assert.equal(lock.packages[''].version,version);
  const notes=read('doc/release-v'+version+'.md');
  for(const text of ['v'+version,game.gameVersion,'638','442','P1Y1','B7A2','Ki-93','AIM-26B','.NET 10.0.14'])
    assert(notes.includes(text),text);
  const link='https://github.com/Plastic-time/warthunder-research-calculator/releases/download/v'+version+'/WarThunderResearchCalculator-v'+version+'-portable.zip';
  for(const file of ['README.md','README.en.md']) {
    const text=read(file);
    assert(text.includes(link),file);
    assert(text.includes('(doc/release-v'+version+'.md)'),file);
    assert(!text.includes('/releases/download/v1.0.29/'),file);
  }
});

test('both app entrypoints include the new release while retaining historical entries', () => {
  for(const folder of ['public','docs']) {
    const $=cheerio.load(read(folder+'/index.html'));
    const first=$('#usageGuideChangelog article').first().text();
    assert(first.includes('v'+version));
    for(const text of [game.gameVersion,'638','P1Y1','配件','真实前置']) assert(first.includes(text));
    assert($('#usageGuideChangelog').text().includes('v1.0.29'));
    assert.equal($('[data-game-version]').text(),game.gameVersion);
  }
});

test('release workflow gates builds on all three data regressions and verifies every packaged chunk', () => {
  const workflow=read('.github/workflows/release.yml');
  for(const text of ['test-battle-ratings.cjs','test-vehicle-cost-update.cjs','test-modification-update.cjs',
    'test-release-version.cjs','$manifest.files','$catalog.chunks.PSObject.Properties',
    'Stale packaged game data','check-release-privacy.ps1','test-release-privacy.ps1'])
    assert(workflow.includes(text),text);
});
