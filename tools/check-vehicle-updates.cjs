const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function checkVehicleUpdates({ evaluate, call, artifacts, suffix }) {
  const checkMarks = async () => {
    const result = await evaluate(`(() => {
      const expected = WTVehicleUpdates.trees[state.country + '/' + state.type] || [];
      const cards = [...document.querySelectorAll('.unit-tile')];
      return {
        expected: cards.filter(card => expected.includes(card.dataset.unitId)).map(card => card.dataset.unitId).sort(),
        actual: cards.filter(card => card.querySelector('.unit-update-edge')).map(card => card.dataset.unitId).sort(),
        badges: cards.filter(card => card.querySelector('.unit-update-label')).map(card => card.dataset.unitId).sort(),
        accurateTips: cards.every(card => !card.querySelector('.unit-update-label') ||
          card.querySelector('.unit-update-label').title.includes(WTVehicleUpdates.date)),
      };
    })()`);
    assert.deepEqual(result.actual, result.expected);
    assert.deepEqual(result.badges, result.expected);
    assert(result.accurateTips);
    return result.actual;
  };
  await evaluate("els.countrySelect.value='britain';els.typeSelect.value='aviation';loadTree()");
  assert((await checkMarks()).includes('fulmar_mk2'));
  await evaluate("els.searchInput.value='fulmar_mk2';els.searchInput.dispatchEvent(new Event('input'))");
  await checkMarks();
  await evaluate("setLanguage('en')");
  assert.equal(await evaluate("document.querySelector('.unit-update-label').textContent"), 'NEW');
  await evaluate("setLanguage('zh')");
  await evaluate("document.querySelector('[data-unit-id=fulmar_mk2]').click()");
  assert(await evaluate("document.querySelector('[data-unit-id=fulmar_mk2]').classList.contains('planned')"));
  await checkMarks();
  await evaluate("document.querySelector('[data-unit-id=fulmar_mk2]').click()");
  await evaluate(`els.treeContainer.scrollTop=0;
    els.treeContainer.scrollLeft += document.querySelector('[data-unit-id=fulmar_mk2]').getBoundingClientRect().left - els.treeContainer.getBoundingClientRect().left - 104;
    WTTreeScroll.sync()`);
  assert(await evaluate(`(() => {
    const card = document.querySelector('[data-unit-id=fulmar_mk2]');
    const badge = card.querySelector('.unit-update-label').getBoundingClientRect();
    const tile = card.getBoundingClientRect();
    const edge = card.querySelector('.unit-update-edge').getBoundingClientRect();
    return badge.left >= tile.left && badge.right <= tile.right && edge.height === 4;
  })()`));
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(artifacts, suffix + '-new-vehicle.png'), Buffer.from(shot.data, 'base64'));
  await evaluate("els.searchInput.value='';els.searchInput.dispatchEvent(new Event('input'));els.countrySelect.value='usa';els.typeSelect.value='aviation';loadTree()");
  const aviation = await checkMarks();
  assert(!aviation.includes('b_52h'));
  assert(!aviation.includes('f_14d'));
  assert(!aviation.includes('f_16xl'));
  assert(aviation.includes('f_15ex'));
  assert(!aviation.includes('f_14d_vf_11'));
  if (suffix.startsWith('pages')) assert(await evaluate(`(() => {
    // Exercise the folder indicator even in releases with no new folded aircraft.
    const marks = WTVehicleUpdates.trees['usa/aviation'];
    WTVehicleUpdates.trees['usa/aviation'] = [...marks, 'f_14d_vf_11'];
    renderTree();
    WTVehicleUpdates.trees['usa/aviation'] = marks;
    const unit = state.unitMap.get('f_14d_vf_11');
    if (!unit.parent_group_id) return document.querySelector('[data-unit-id="f_14d_vf_11"] .unit-update-label') !== null;
    return [...document.querySelectorAll('[data-folder-group]')].some(button =>
      button.dataset.folderGroup === unit.parent_group_id && button.classList.contains('has-new'));
  })()`), 'Collapsed folders indicate new vehicles inside');
  await evaluate("els.countrySelect.value='germany';els.typeSelect.value='ground';loadTree()");
  await checkMarks();
  await evaluate("els.countrySelect.value='usa';els.typeSelect.value='ground';loadTree()");
  console.log(JSON.stringify({ updates: suffix, goldEdge: true, language: true, selection: true, countryScope: true }));
}

module.exports = { checkVehicleUpdates };
