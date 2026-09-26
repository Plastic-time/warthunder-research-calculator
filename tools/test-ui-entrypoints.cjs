const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const root = path.resolve(__dirname, '..');
for (const folder of ['public', 'docs']) {
  const read = file => fs.readFileSync(path.join(root, folder, file), 'utf8');
  const $ = cheerio.load(read('index.html'));
  assert.equal($('h1').attr('data-i18n'), '战争雷霆研发计算器');
  assert.equal($('title').text(), '战争雷霆研发计算器');
  const creator = $('a.creator-watermark');
  assert.equal(creator.length, 1);
  assert.equal(creator.attr('href'), 'https://space.bilibili.com/543495611');
  assert.equal(creator.attr('target'), '_blank');
  assert(creator.attr('rel').split(/\s+/).includes('noopener'));
  assert(creator.attr('rel').split(/\s+/).includes('noreferrer'));
  assert.equal(creator.find('strong').text(), '扑街的靓仔');
  const avatar = creator.find('img.creator-avatar');
  assert.equal(avatar.length, 1);
  assert.equal(avatar.attr('width'), '26');
  assert.equal(avatar.attr('height'), '26');
  assert.equal(avatar.attr('src'), (folder === 'public' ? '/' : '') + 'assets/creator-avatar.jpg');
  assert(fs.existsSync(path.join(root, folder, 'assets/creator-avatar.jpg')));
  assert.equal($('#planButton').length, 1);
  assert.equal($('#planButton').closest('#floatingBudget').length, 1);
  assert.equal($('#floatingPlanButton').length, 0);
  assert.equal($('.topbar-actions #planButton').length, 0);
  assert.equal($('#planButton .floating-plan-test').text(), '\u6d4b\u8bd5');
  assert.equal($('#budgetCount').length, 1);
  assert.equal($('#budgetRp').length, 1);
  assert.equal($('#budgetSl').length, 1);
  const scripts = $('script[src]').map((_, node) => $(node).attr('src').replace(/^\//, '').split('?')[0]).get();
  for (const script of ['research-progress.js', 'vehicle-long-press.js', 'roster.js', 'modifications.js', 'tree-navigation.js', 'header-layout.js']) {
    assert(scripts.includes(script), `${folder}: missing ${script}`);
    assert(scripts.indexOf(script) < scripts.indexOf('app.js'));
  }
  for (const script of scripts.filter(src => !/^https?:/.test(src))) assert(fs.existsSync(path.join(root, folder, script)));
  const styles = $('link[rel="stylesheet"]').map((_, node) => $(node).attr('href').replace(/^\//, '').split('?')[0]).get();
  assert(styles.includes('ui-dark.css'));
  assert(styles.includes('tree-navigation.css'));
  assert(styles.includes('header-layout.css'));
  for (const file of ['assets/research-emblem.png', 'assets/navigation/search.svg', 'assets/navigation/ellipsis.svg', 'assets/navigation/sliders-horizontal.svg']) {
    assert(fs.existsSync(path.join(root, folder, file)), file);
  }
  assert(!styles.some(file => /preview/.test(file)));
  for (const file of styles.filter(src => !/^https?:/.test(src))) assert(fs.existsSync(path.join(root, folder, file)));
  assert($('#usageGuideDialog').text().includes('\u957f\u6309'));
  assert($('#usageGuideDialog').text().includes('\u9014\u7ecf\u70b9'));
  assert.match(read('app.js'), /VehicleLongPress\?\.configure/);
  assert.match(read('app.js'), /RosterAudit\?\.badges/);
  assert.match(read('modifications.js'), /isAutomaticallyUnlocked/);
}
for (const file of ['styles.css', 'tree-scroll.css', 'vehicle-long-press.js', 'modifications.js', 'modification-planner.js', 'ui-dark.css', 'tree-navigation.css', 'tree-navigation.js', 'header-layout.js', 'header-layout.css', 'assets/research-emblem.png', 'assets/navigation/search.svg', 'assets/navigation/ellipsis.svg', 'assets/navigation/sliders-horizontal.svg']) {
  assert(fs.readFileSync(path.join(root, 'public', file)).equals(fs.readFileSync(path.join(root, 'docs', file))), `${file}: copies differ`);
}
const pkg = require('../package.json');
assert(fs.readFileSync(path.join(root, 'public/assets/creator-avatar.jpg')).equals(fs.readFileSync(path.join(root, 'docs/assets/creator-avatar.jpg'))));
for (const file of ['README.md', 'README.en.md']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert(text.includes('<a href="https://space.bilibili.com/543495611">扑街的靓仔</a>'));
  const readme = cheerio.load(text);
  const image = readme('img[src="doc/assets/creator-avatar.svg"]');
  assert.equal(image.length, 1);
  assert.equal(image.attr('width'), '26');
  assert.equal(image.attr('height'), '26');
  assert.equal(image.parent('a').attr('href'), 'https://space.bilibili.com/543495611');
}
const avatarSvg = fs.readFileSync(path.join(root, 'doc/assets/creator-avatar.svg'), 'utf8');
assert(avatarSvg.includes('clip-path="url(#avatar)"'));
const avatarData = avatarSvg.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/)[1];
assert(Buffer.from(avatarData, 'base64').equals(fs.readFileSync(path.join(root, 'public/assets/creator-avatar.jpg'))));
const lock = require('../package-lock.json');
assert.equal(pkg.version, lock.version);
assert.equal(pkg.version, lock.packages[''].version);
console.log(JSON.stringify({ version: pkg.version, singlePlanner: true, touchMenu: true, categoryLabels: true, pass: true }));
