const fs = require('node:fs');
const path = require('node:path');

function buildVehicleUpdates(root = path.resolve(__dirname, '..')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/database/manifest.json'), 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'config/data-version.json'), 'utf8'));
  const release = JSON.parse(fs.readFileSync(path.join(root, 'config/vehicle-release.json'), 'utf8'));
  // Never carry the previous major update's badges into an unreviewed new one.
  const latestVersion = [version.gameVersion, version.latestReview?.gameVersion]
    .filter(Boolean).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0];
  const reviewed = latestVersion.split('.').slice(0, 2).join('.') === release.major;
  const trees = {};
  for (const entry of manifest.files) {
    const match = /^database\/([a-z]+)\/\1_([a-z]+)\.json$/.exec(entry.path);
    if (!match) continue;
    const ranks = JSON.parse(fs.readFileSync(path.join(root, 'docs', entry.path), 'utf8'));
    const ids = new Set(ranks.flatMap(rank => [
      ...(rank.researchable_vehicles || []).flat(), ...(rank.premium_vehicles || []).flat(),
    ]).flatMap(item => item.items || [item]).map(item => item.data_unit_id));
    const key = `${match[1]}/${match[2]}`;
    trees[key] = reviewed ? [...new Set(release.trees[key] || [])].filter(id => ids.has(id)) : [];
  }
  const data = { date: release.date, basis: 'game-major-update',
    status: reviewed ? 'reviewed' : 'needs-review', major: release.major,
    name: release.name, announcement: release.announcement, trees };
  const content = `// Generated from config/vehicle-release.json; reviewed game release additions only.\nwindow.WTVehicleUpdates = ${JSON.stringify(data, null, 2)};\n`;
  for (const dir of ['docs', 'public']) fs.writeFileSync(path.join(root, dir, 'vehicle-updates-data.js'), content);
  return data;
}

if (require.main === module) {
  const data = buildVehicleUpdates();
  console.log(JSON.stringify({ date: data.date, added: Object.values(data.trees).flat().length }));
}
module.exports = { buildVehicleUpdates };
