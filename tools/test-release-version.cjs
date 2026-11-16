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

test('packaging rejects an old Node version or altered binary', () => {
  const {validateNode} = require('./check-packaged-node.cjs');
  const binary = Buffer.from('runtime fixture');
  const reviewed = {version:'24.22.3', sha256:require('node:crypto').createHash('sha256').update(binary).digest('hex')};
  validateNode('v24.22.3', binary, reviewed);
  assert.throws(() => validateNode('v24.22.1', binary, reviewed), /reviewed Node/);
  assert.throws(() => validateNode('v24.22.3', Buffer.from('altered'), reviewed), /official download/);
  assert.equal(require('../config/release-privacy-runtime-paths.json').node.version, '24.22.3');
  assert(read('tools/package-release.ps1').includes("'check-packaged-node.cjs'"));
});

test('package, lock, current release notes and README downloads share one version', () => {
  assert.equal(version,'1.0.32');
  assert.equal(lock.version,version);
  assert.equal(lock.packages[''].version,version);
  const notes=read('doc/release-v'+version+'.md');
  for(const text of ['v'+version,'F-15EX','F-5E','JAS39A','24.22.3','.NET 10.0.15'])
    assert(notes.includes(text),text);
  const link='https://github.com/Plastic-time/warthunder-research-calculator/releases/download/v'+version+'/WarThunderResearchCalculator-v'+version+'-portable.zip';
  for(const file of ['README.md','README.zh-CN.md']) {
    const text=read(file);
    assert(text.includes(link),file);
    assert(text.includes('(doc/release-v'+version+'.md)'),file);
    assert(!text.includes('/releases/download/v1.0.30/'),file);
  }
});

test('both app entrypoints include the new release while retaining historical entries', () => {
  for(const folder of ['public','docs']) {
    const $=cheerio.load(read(folder+'/index.html'));
    const first=$('#usageGuideChangelog article').filter((_, el) => $(el).find('.usage-guide-update-meta span').text() === 'v'+version).text();
    assert(first.includes('v'+version));
    for(const text of ['F-15EX','F-5E','JAS39A','安全','桌面']) assert(first.includes(text));
    assert($('#usageGuideChangelog').text().includes('v1.0.31'));
    assert.equal($('[data-game-version]').text(),game.gameVersion);
  }
});

test('release workflow gates builds on all three data regressions and verifies every packaged chunk', () => {
  const workflow=read('.github/workflows/release.yml');
  for(const text of ['test-battle-ratings.cjs','test-vehicle-cost-update.cjs','test-modification-update.cjs',
    'test-release-version.cjs','$manifest.files','$catalog.chunks.PSObject.Properties',
    'Stale packaged game data','check-release-privacy.ps1','test-release-privacy.ps1',
    'test-datamine-updates.cjs','check-datamine-updates.cjs','test-dependency-security.cjs',
    'Stale packaged dependency','follow-redirects','minimatch'])
    assert(workflow.includes(text),text);
});
