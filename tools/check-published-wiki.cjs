const fs=require('fs');
const path=require('path');
const assert=require('node:assert/strict');
const axios=require('axios');
const {root,sha}=require('./refresh-wiki.cjs');

async function check() {
  const base='https://plastic-time.github.io/warthunder-research-calculator/';
  const stamp=Date.now();
  const get=async file=>(await axios.get(`${base}${file}?verify=${stamp}`,{timeout:30000,responseType:'arraybuffer'})).data;
  const manifest=JSON.parse(await get('database/manifest.json'));
  assert.deepEqual(manifest,JSON.parse(fs.readFileSync(path.join(root,'docs/database/manifest.json'),'utf8')),'Published manifest differs');
  let index=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(index<manifest.files.length) {
      const entry=manifest.files[index++];
      assert.equal(sha(await get(entry.path)),entry.sha256,`Published hash mismatch: ${entry.path}`);
    }
  }));
  const assets=['index.html','app.js','planner.js','styles.css','vehicle-names.json','unlock-quantity.js','assets/fonts/wt-symbols.ttf','assets/fonts/source.json','assets/flags/cn.svg','assets/flags/gb.svg','roster.js','roster.css','roster-audit.json','tree-scroll.js','tree-scroll.css','modifications.js','modifications.css','modification-planner.js','database/modifications/catalog.json'];
  assets.push('route-export.js', 'route-export.css', 'html-to-image.js', 'html-to-image.LICENSE.txt');
  for(const file of assets) assert.equal(sha(await get(file)),sha(fs.readFileSync(path.join(root,'docs',file))),`Stale frontend: ${file}`);
  const modificationCatalog=JSON.parse(fs.readFileSync(path.join(root,'docs/database/modifications/catalog.json'),'utf8'));
  let chunkIndex=0;
  const chunks=Object.values(modificationCatalog.chunks);
  await Promise.all(Array.from({length:4},async()=>{
    while(chunkIndex<chunks.length) {
      const entry=chunks[chunkIndex++];
      const content=await get(entry.path);
      assert.equal(sha(content),entry.sha256,`Published modification hash mismatch: ${entry.path}`);
      assert.equal(sha(content),sha(fs.readFileSync(path.join(root,'docs',entry.path))),`Published modification differs locally: ${entry.path}`);
    }
  }));
  console.log(JSON.stringify({url:base,publishedSnapshot:manifest.fetched_to,trees:manifest.files.length,units:manifest.unit_count,modificationVehicles:modificationCatalog.stats.vehicles,modifications:modificationCatalog.stats.modifications,modificationChunks:chunks.length,staticFiles:assets.length+chunks.length,hashMismatches:0}));
}
check().catch(error=>{console.error(error);process.exitCode=1;});
