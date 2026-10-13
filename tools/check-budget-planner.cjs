const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function checkBudgetPlanner({ evaluate, call, artifacts, suffix }) {
  const layout = () => evaluate(`(() => {
    const dock = document.getElementById('floatingBudget');
    const button = els.planButton;
    const box = node => { const r = node.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
    const d = box(dock), b = box(button), s = box(dock.querySelector('.budget-summary'));
    const point = {x:b.left+b.width/2, y:b.top+b.height/2};
    return {
      dock:d, button:b, summary:s,
      oneButton: document.querySelectorAll('#planButton').length === 1 && !document.getElementById('floatingPlanButton') && !document.querySelector('.topbar-actions #planButton'),
      fixed: getComputedStyle(dock).position === 'fixed',
      contained: d.left >= 0 && d.right <= innerWidth && d.top > 0 && d.bottom <= innerHeight - 20,
      aligned: b.left > s.right && b.top >= d.top && b.bottom <= d.bottom && b.right <= d.right,
      textFits: [...dock.querySelectorAll('.budget-count, .budget-cost, [data-plan-button-label], .floating-plan-test')].every(node => node.scrollWidth <= node.clientWidth + 1),
      translucent: getComputedStyle(dock).backgroundColor.startsWith('rgba('),
      clickable: document.elementFromPoint(point.x, point.y)?.closest('button') === button,
      testTag: button.querySelector('.floating-plan-test').textContent,
      treeWidth: els.treeContainer.getBoundingClientRect().width,
      // Free space beside the tree, ignoring the desktop branch rail on its left.
      treeGutter: (() => {
        const tree = els.treeContainer.getBoundingClientRect();
        const rail = document.querySelector('.branch-tabs')?.getBoundingClientRect();
        const railRight = rail && rail.height > rail.width ? rail.right : 0;
        return Math.max(tree.left - railRight, innerWidth - tree.right);
      })(),
      viewportWidth: innerWidth,
      point,
    };
  })()`);
  const initial = await layout();
  assert(initial.oneButton && initial.fixed && initial.contained && initial.aligned && initial.textFits && initial.translucent && initial.clickable, JSON.stringify(initial));
  assert.equal(initial.testTag, '\u6d4b\u8bd5');
  assert(initial.treeGutter <= 2, 'Retired side button must not leave an empty gutter');
  await evaluate(`(() => {
    window.__budgetTexts = ['budgetCount','budgetRp','budgetSl'].map(id => document.getElementById(id).textContent);
    document.getElementById('budgetCount').textContent = '3235';
    for (const id of ['budgetRp','budgetSl']) document.getElementById(id).textContent = '999,999,999,999';
  })()`);
  const large = await layout();
  assert(large.contained && large.aligned && large.textFits && large.clickable, `Large totals overflow: ${JSON.stringify(large)}`);
  await evaluate(`['budgetCount','budgetRp','budgetSl'].forEach((id,i) => document.getElementById(id).textContent = window.__budgetTexts[i]); delete window.__budgetTexts`);
  await evaluate(`els.treeContainer.scrollTop = els.treeContainer.scrollHeight`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const bottom = await layout();
  assert.deepEqual(bottom.dock, initial.dock, 'Bottom control must stay fixed while scrolling');
  assert(bottom.clickable, 'Planning must remain clickable at the bottom');
  await evaluate(`(() => {
    els.clearButton.click();
    const goal = state.units.find(unit => getRankOrder(unit.rank) === 3 && unit.section === 'researchable' && unit.rp > 0);
    toggleUnitMode(goal.data_unit_id, 'target');
  })()`);
  const target = await layout();
  await call('Input.dispatchMouseEvent', {type:'mouseMoved', ...target.point});
  await call('Input.dispatchMouseEvent', {type:'mousePressed', ...target.point, button:'left', clickCount:1});
  await call('Input.dispatchMouseEvent', {type:'mouseReleased', ...target.point, button:'left', clickCount:1});
  await evaluate(`(async () => { for (let i=0;i<300 && (!state.planResult || els.planButton.disabled);i++) await new Promise(resolve => setTimeout(resolve,100)); })()`);
  assert(await evaluate('!!state.planResult?.feasible && !els.planButton.disabled'), 'Bottom button must run the actual planner');
  const budget = await evaluate('[els.budgetRp.textContent, els.budgetSl.textContent]');
  assert(budget.every(value => Number(value.replaceAll(',', '')) > 0));
  // The click above starts the press-release spring; measure only once it has settled.
  await evaluate('Promise.all(els.planButton.getAnimations().map(animation => animation.finished)).then(() => true)');
  const ready = await layout();
  await evaluate('setPlanButtonsDisabled(true)');
  const busy = await layout();
  assert.deepEqual(busy.button, ready.button, 'Busy state must not shift the button');
  assert.equal(busy.testTag, ready.testTag);
  await evaluate('setPlanButtonsDisabled(false)');
  await evaluate('els.treeContainer.scrollTop = els.treeContainer.scrollHeight');
  await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  assert(await evaluate(`(() => {
    const content = els.treeContainer.querySelector('.tree-canvas').getBoundingClientRect();
    const dock = document.getElementById('floatingBudget').getBoundingClientRect();
    return content.bottom < dock.top;
  })()`), 'Final rank must scroll above the floating budget');
  await call('Input.dispatchMouseEvent', {type:'mouseMoved', x:8, y:8});
  await evaluate('document.activeElement?.blur(); document.fonts.ready');
  await new Promise(resolve => setTimeout(resolve, 180));
  const shot = await call('Page.captureScreenshot', {format:'png'});
  fs.writeFileSync(path.join(artifacts, `${suffix}-budget-planner.png`), Buffer.from(shot.data,'base64'));
  await evaluate('els.clearButton.click(); els.treeContainer.scrollTop = 0');
  console.log(JSON.stringify({budgetPlanner:suffix, singleEntry:true, fixed:true, budget, pass:true}));
}

module.exports = { checkBudgetPlanner };
