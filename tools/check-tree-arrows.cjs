const assert = require('node:assert/strict');

async function checkTreeArrows(evaluate) {
  const result = await evaluate(`(() => {
    const before = JSON.stringify(state.units);
    const costsBefore = JSON.stringify([els.budgetCount.textContent, els.budgetRp.textContent, els.budgetSl.textContent]);
    renderTreeConnections();
    const canvas = els.treeContainer.querySelector('.tree-canvas');
    const svg = canvas.querySelector('.tree-links');
    const paths = [...svg.querySelectorAll(':scope > path')];
    const expected = [...canvas.querySelectorAll('.unit-tile')].reduce((sum, tile) => {
      const unit=state.unitMap.get(tile.dataset.unitId);
      return sum + resolveRequirementSources(unit.required_unit_id || unit.parent_required_unit_id || '').filter(id => {
        const parent=state.groupMap.get(state.unitMap.get(id)?.parent_group_id);
        const target=id === tile.dataset.unitId;
        const visible=[...canvas.querySelectorAll('.unit-tile')].some(t => t.dataset.unitId === id);
        const fallback=parent && getGroupMainChildId(parent);
        return !target && (visible || (fallback !== tile.dataset.unitId &&
          [...canvas.querySelectorAll('.unit-tile')].some(t => t.dataset.unitId === fallback)));
      }).length;
    },0);
    const tile=canvas.querySelector('.unit-tile');
    const lowRankEdges=paths.filter(p => {
      const from=state.unitMap.get(p.dataset.from), to=state.unitMap.get(p.dataset.to);
      return isFirstRankValue(from.rank) || isFirstRankValue(to.rank);
    });
    const lowRankPlanUnchanged=lowRankEdges.every(p => {
      const unit=state.unitMap.get(p.dataset.to);
      const req=unit.required_unit_id || unit.parent_required_unit_id || '';
      return shouldIgnoreRequirement(unit,req) && JSON.stringify(getDependencyIds(unit.data_unit_id)) === JSON.stringify([unit.data_unit_id]);
    });
    const id=svg.querySelector('marker').id;
    const clone=canvas.cloneNode(true);
    const host=document.createElement('div');
    Object.assign(host.style,{position:'fixed',left:'-100000px',top:'0',width:canvas.scrollWidth+'px'});
    host.append(clone);document.body.append(host);
    renderTreeConnections(clone);
    const exportSvg=clone.querySelector('.tree-links');
    const exportId=exportSvg.querySelector('marker').id;
    const exportValid=[...exportSvg.querySelectorAll(':scope > path')].every(p =>
      p.getAttribute('marker-end') === 'url(#'+exportId+(p.classList.contains('is-route') ? '-route' : '')+')');
    host.remove();
    return {
      paths:paths.length,expected,
      lowRankEdges:lowRankEdges.length,lowRankPlanUnchanged,
      costsUnchanged:costsBefore === JSON.stringify([els.budgetCount.textContent, els.budgetRp.textContent, els.budgetSl.textContent]),
      visible:getComputedStyle(svg).display !== 'none',
      markers:paths.every(p => p.getAttribute('marker-end') === 'url(#'+id+(p.classList.contains('is-route') ? '-route' : '')+')' && !p.getAttribute('d').includes('NaN')),
      widths:paths.every(p => getComputedStyle(p).strokeWidth === (p.classList.contains('is-route') ? '3px' : '2px')),
      headAtBase:svg.querySelector('marker').getAttribute('refX') === '0',
      headLength:svg.querySelector('marker').getAttribute('markerWidth'),
      headWidth:svg.querySelector('marker').getAttribute('markerHeight'),
      noDots:getComputedStyle(tile,'::before').content === 'none' && getComputedStyle(tile,'::after').content === 'none',
      noRepeatedTitle:canvas.querySelectorAll('.researchable-band .band-title').length === 0,
      hasUnlock:canvas.querySelectorAll('.rank-unlock-line').length > 0,
      exportValid,uniqueExportId:id !== exportId,unchanged:before === JSON.stringify(state.units),
    };
  })()`);
  assert(result.paths > 0 && result.paths === result.expected, 'Same prerequisite relations are drawn');
  assert(result.visible && result.markers && result.noDots && result.noRepeatedTitle && result.hasUnlock);
  assert(result.widths, 'Neutral and selected paths use the intended thin weights');
  assert(result.headAtBase);
  assert.equal(result.headLength,'7');
  assert.equal(result.headWidth,'10');
  assert(result.exportValid && result.uniqueExportId && result.unchanged);
  assert(result.lowRankEdges > 0, 'Rank-I relationships must now be visible');
  assert(result.lowRankPlanUnchanged && result.costsUnchanged, 'Display arrows must not change planning exemptions or costs');
}

module.exports = { checkTreeArrows };
