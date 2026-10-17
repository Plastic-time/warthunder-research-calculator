const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const {root,cache,sha,readTrees} = require('./refresh-wiki.cjs');
const {parseWikiDetail} = require('../src/wiki-snapshot');
const {applyWikiPresentation} = require('./apply-wiki-presentation.cjs');

// Deliberately read raw DOM fields separately from the production detail parser.
function verifyDetail(html, item) {
  const $ = cheerio.load(html);
  const card = label => $('.game-unit_card-info_title').filter((_,e)=>$(e).text().trim()===label).first().parent().find('.game-unit_card-info_value').first();
  const text = label => {
    const value = card(label).clone(); value.find('svg,img').remove();
    return value.text().replace(/\s+/g,' ').trim() || null;
  };
  const rawRp = text('Research');
  const rawSp = text('Purchase');
  assert.equal(item.wiki.research, rawRp);
  assert.equal(item.wiki.purchase, rawSp);
  assert.equal(item.wiki.purchase_currency, card('Purchase').find('img[alt]').attr('alt') || (rawSp === 'Free' ? 'SL' : null));
  assert.equal(item.wiki.rank, text('Rank'));
  assert.equal(item.main_role, text('Main role'));
  assert.equal(item.research_country, text('Research country'));
  $('.game-unit_br-item').each((_,element)=>{
    const mode=$(element).find('.mode').text().trim();
    const panel=$(element).parents('[role="tabpanel"]').first().attr('id');
    const battle=panel?panel.slice('unit-br-'.length):'default';
    assert.equal(item.wiki.battle_ratings_by_battle[battle][mode], $(element).find('.value').text().trim());
  });
  assert.equal(item.br, item.wiki.battle_ratings.RB || null);
  const cost = value => value === null ? null : value === 'Free' ? 0 : Number(value.replace(/[,\s]/g,''));
  const excluded = item.is_squadron || item.is_premium || item.is_component;
  assert.equal(item.rp, excluded ? 0 : cost(rawRp));
  assert.equal(item.sp, excluded ? 0 : item.wiki.purchase_currency !== 'SL' ? null : cost(rawSp));
  if (item.is_component) {
    const basic=$('a.game-unit_multiunit-item').filter((_,e)=>$(e).find('.subtitle').text().trim()==='Basic unit');
    assert.equal(basic.attr('href'), `/unit/${item.component_of}`);
    assert.equal(rawRp,null); assert.equal(rawSp,null); assert.equal(item.wiki.rank,null);
  }
}

function build(apply=false) {
  const trees=readTrees();
  const manifest={schema_version:1, source:'https://wiki.warthunder.com/', verified_at:new Date().toISOString(), battle_rating_mode:'RB', tree_count:trees.length, unit_count:0, unique_units:0, failures:[], limitations:['Wiki tree pages do not expose rank unlock counts; unknown counts are null, not zero.', 'Squadron and premium costs are excluded from ordinary research totals; unmodified source values remain in each wiki field.', 'This is a dated Wiki snapshot, not a live game-data or future accuracy guarantee.'], files:[]};
  const unique=new Set();
  manifest.limitations[0]='Wiki rank unlock counts are unavailable; the calculator retains the existing dict/unlock_quantity.js rules separately from this source snapshot.';
  manifest.source_missing_costs=[];
  const oldManifestPath=path.join(root,'docs/database/manifest.json');
  const oldManifest=fs.existsSync(oldManifestPath)?JSON.parse(fs.readFileSync(oldManifestPath,'utf8')):null;
  const outputs=[];
  const times=[];
  for (const {country,type,data,sourceHash} of trees) {
    const html=fs.readFileSync(path.join(cache,`${type}.html`),'utf8');
    const $=cheerio.load(html);
    const source=$(`.unit-tree[data-tree-id="${country}"]`);
    const treeTime=fs.statSync(path.join(cache,`${type}.html`)).mtimeMs;
    assert(Date.now()-treeTime<12*3600000,`${type}: stale source cache`);
    times.push(treeTime);
    const ids=new Set();
    const nodes=[];
    let count=0;
    for (const rank of data) {
      rank.unlock_quantity=null;
      rank.source='wiki';
      for (const section of ['researchable_vehicles','premium_vehicles']) {
        for (const item of rank[section].flat()) {
          nodes.push(item);
          if (item.type==='multiple') nodes.push(...item.items);
          for (const single of item.type==='multiple' ? item.items : [item]) {
            const id=single.data_unit_id;
            assert(!ids.has(id), `Duplicate ${country}/${type}/${id}`); ids.add(id); unique.add(id);
            const file=path.join(cache,'units',`${id}.html`);
            const detailHtml=fs.readFileSync(file,'utf8');
            const detail=parseWikiDetail(detailHtml,id);
            if (!detail.is_component) assert.equal(detail.rank,rank.rank, `${id}: tree/detail rank mismatch`);
            const timestamp=fs.statSync(file).mtimeMs; times.push(timestamp);
            assert(Date.now()-timestamp<12*3600000, `${id}: stale source cache`);
            Object.assign(single,detail);
            single.rank=rank.rank;
            single.class_name=detail.is_squadron ? 'squad' : detail.is_premium ? 'prem' : '';
            single.wiki.fetched_at=new Date(timestamp).toISOString();
            single.wiki.sha256=sha(detailHtml);
            if (single.rp===null || single.sp===null) manifest.source_missing_costs.push({id,country,type,section,research:single.wiki.research,purchase:single.wiki.purchase});
            verifyDetail(detailHtml,{...single,section:section==='researchable_vehicles'?'researchable':'premium'});
            count++;
          }
          if (item.type==='multiple') {
            item.rp=item.items.some(i=>i.rp===null)?null:item.items.reduce((sum,i)=>sum+i.rp,0);
            item.sp=item.items.some(i=>i.sp===null)?null:item.items.reduce((sum,i)=>sum+i.sp,0);
            const ratings=item.items.filter(i=>i.br!==null).map(i=>Number(i.br));
            const min=Math.min(...ratings),max=Math.max(...ratings);
            item.br=min===max ? min.toFixed(1) : `${min.toFixed(1)}-${max.toFixed(1)}`;
            item.details=true;
          }
        }
      }
    }
    const allIds=new Set(nodes.map(n=>n.data_unit_id));
    for (const node of nodes) {
      const element=source.find(node.type==='multiple'?'.wt-tree_group':'.wt-tree_item').filter((_,e)=>$(e).attr('data-unit-id')===node.data_unit_id);
      assert.equal(element.length,1,`${node.data_unit_id}: ambiguous source node`);
      assert.equal(node.required_unit_id,element.attr('data-unit-req')||'',`${node.data_unit_id}: prerequisite mismatch`);
      const selector=node.type==='multiple'?'.wt-tree_group-folder .wt-tree_item-text span':'.wt-tree_item-text span';
      assert.equal(node.title,element.find(selector).first().text().replace(/\s+/g,' ').trim());
      if (node.required_unit_id) assert(allIds.has(node.required_unit_id),`${node.data_unit_id}: dangling prerequisite ${node.required_unit_id}`);
      if (node.component_of) assert(allIds.has(node.component_of),`${node.data_unit_id}: missing basic unit`);
    }
    const file=`database/${country}/${country}_${type}.json`;
    const content=JSON.stringify(data,null,2)+'\n';
    const previous=JSON.parse(fs.readFileSync(path.join(root,'docs',file),'utf8'));
    const oldItems=previous.flatMap(r=>[...(r.researchable_vehicles||[]),...(r.premium_vehicles||[])].flat()).flatMap(i=>i.items||[i]);
    const oldIds=new Set(oldItems.map(i=>i.data_unit_id));
    const last=oldManifest?.files.find(entry=>entry.path===file && entry.sha256===sha(content));
    manifest.files.push({path:file,units:count,sha256:sha(content),tree_source_sha256:sourceHash,added:last?.added||[...ids].filter(id=>!oldIds.has(id)),removed:last?.removed||[...oldIds].filter(id=>!ids.has(id))});
    manifest.unit_count+=count;
    outputs.push({file,content});
  }
  manifest.unique_units=unique.size;
  manifest.fetched_from=new Date(Math.min(...times)).toISOString();
  manifest.fetched_to=new Date(Math.max(...times)).toISOString();
  if (apply) {
    const report=JSON.parse(fs.readFileSync(path.join(cache,'live-report.json'),'utf8'));
    assert(Date.now()-Date.parse(report.verified_at)<2*3600000,'Live verification is stale');
    assert.equal(report.failures,0,'Live verification reported failures');
    assert.deepEqual(report.snapshot_files,manifest.files.map(({path,sha256})=>({path,sha256})),'Live verification is for a different snapshot');
    manifest.live_recheck={verified_at:report.verified_at,tree_pages:report.live_tree_pages,unit_samples:report.live_unit_samples,failures:report.failures};
  }
  for (const {file,content} of outputs) {
    const target=path.join(cache,'staged',file); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,content);
  }
  fs.writeFileSync(path.join(cache,'staged/database/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  if (apply) {
    const published = applyWikiPresentation(root, outputs, manifest.live_recheck);
    console.log(JSON.stringify({applied:true,policy:'wiki-presentation-only',trees:published.tree_count,
      units:published.unit_count,requiresReview:published.wiki_presentation_refresh.requires_review,
      report:'logs/wiki-refresh/presentation-review.json'}));
    return published;
  }
  console.log(JSON.stringify({applied:apply,trees:trees.length,units:manifest.unit_count,uniqueUnits:unique.size,failures:0,fetchedFrom:manifest.fetched_from,fetchedTo:manifest.fetched_to}));
  return manifest;
}
if (require.main===module) {try {build(process.argv.includes('--apply'));} catch(error){console.error(error);process.exitCode=1;}}
module.exports={build,verifyDetail};
