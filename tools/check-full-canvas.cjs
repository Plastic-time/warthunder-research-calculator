const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const express = require('express');
const { checkBudgetPlanner } = require('./check-budget-planner.cjs');
const { checkMobileLongPress } = require('./check-mobile-long-press.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'logs', 'full-canvas-check');
  fs.mkdirSync(artifacts, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--in-process-gpu', '--disable-gpu-compositing', '--disable-features=SkiaGraphite,UseDComp,Vulkan', '--use-angle=swiftshader',
    `--user-data-dir=${path.join(artifacts, `profile-${Date.now()}`)}`,
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });

  let sequence = 0;
  let buffer = '';
  const pending = new Map();
  const pageErrors = [];
  browser.stdio[4].on('data', (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails);
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    }
  });

  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 120000);
      pending.set(id, { resolve, reject, timer });
      browser.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  }

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    let { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await call('Page.enable');
    await call('Runtime.enable');

    for (const width of (process.env.WT_CHECK_LOCAL_ONLY ? [] : [1440, 900, 390, 320])) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/pages/` });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await evaluate('document.querySelectorAll(".unit-tile").length > 0')) break;
        await pause(100);
      }

      if (width === 390 || width === 320) await checkMobileLongPress({ evaluate, call, artifacts, suffix: `pages-${width}` });
      await checkBudgetPlanner({ evaluate, call, artifacts, suffix: `pages-${width}` });
      const layout = await evaluate(`(() => {
        const summary = document.querySelector('.summary-panel');
        const workspace = document.querySelector('.workspace').getBoundingClientRect();
        const tree = document.getElementById('treeContainer');
        const treeRect = tree.getBoundingClientRect();
        const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
        const topbar = document.querySelector('.topbar').getBoundingClientRect();
        const brand = document.querySelector('.brand-block').getBoundingClientRect();
        const heading = document.querySelector('.topbar h1');
        const headingRect = heading.getBoundingClientRect();
        const actions = document.querySelector('.topbar-actions').getBoundingClientRect();
        return {
          summaryHidden: getComputedStyle(summary).display === 'none',
          workspaceLeft: workspace.left,
          workspaceWidth: workspace.width,
          treeLeft: treeRect.left,
          treeRight: treeRect.right,
          // Right edge of the desktop branch rail; 0 when the branches sit in a horizontal row.
          railRight: (() => { const r = document.querySelector('.branch-tabs')?.getBoundingClientRect(); return r && r.height > r.width ? r.right : 0; })(),
          treeHeight: treeRect.height,
          treeScrollable: tree.scrollHeight > tree.clientHeight,
          toolbarBottom: toolbar.bottom,
          treeTop: treeRect.top,
          bodyOverflow: getComputedStyle(document.body).overflow,
          topbar: { width: topbar.width, height: topbar.height, direction: getComputedStyle(document.querySelector('.topbar')).flexDirection },
          brand: { width: brand.width, height: brand.height },
          heading: { left: headingRect.left, top: headingRect.top, width: headingRect.width, height: headingRect.height, scrollWidth: heading.scrollWidth, text: heading.textContent },
          actions: { left: actions.left, top: actions.top, width: actions.width, height: actions.height },
        };
      })()`);
      assert(layout.summaryHidden, 'Summary panel must not occupy the main UI');
      assert(layout.workspaceLeft <= layout.railRight + 1 && layout.workspaceWidth >= width - layout.railRight - 2, `Workspace must span viewport: ${JSON.stringify(layout)}`);
      assert(layout.treeLeft <= layout.railRight + 1 && layout.treeRight >= width - (width <= 720 ? 2 : 78), `Tree must be full canvas: ${JSON.stringify(layout)}`);
      assert(layout.treeHeight >= 430, `Tree viewport is too short: ${JSON.stringify(layout)}`);
      assert(layout.treeScrollable, `Tree must own vertical scrolling: ${JSON.stringify(layout)}`);
      assert(layout.treeTop >= layout.toolbarBottom - 1, `Toolbar overlaps tree content: ${JSON.stringify(layout)}`);
      assert.equal(layout.bodyOverflow, 'hidden');

      const center = await evaluate(`(() => { const r = document.getElementById('treeContainer').getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(220,r.height/2))}; })()`);
      assert(await evaluate(`!!document.elementFromPoint(${center.x}, ${center.y})?.closest('.tree-container')`), `Pointer is not over tree: ${JSON.stringify(center)}`);
      const beforeScroll = await evaluate('document.getElementById("treeContainer").scrollTop');
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y });
      await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY: 700 });
      await pause(450);
      let afterScroll = await evaluate('document.getElementById("treeContainer").scrollTop');
      if (afterScroll === beforeScroll) {
        await call('Input.synthesizeScrollGesture', { x: center.x, y: center.y, yDistance: -700, speed: 1200, gestureSourceType: 'mouse' });
        await pause(450);
        afterScroll = await evaluate('document.getElementById("treeContainer").scrollTop');
      }
      const scrollDiagnostics = await evaluate(`(() => { const tree = document.getElementById('treeContainer'); const hit = document.elementFromPoint(${center.x}, ${center.y}); return {treeTop:tree.scrollTop,treeHeight:tree.scrollHeight,treeClient:tree.clientHeight,pageTop:scrollY,hit:hit?.className,overflowY:getComputedStyle(tree).overflowY}; })()`);
      assert(afterScroll > beforeScroll + 100, `Wheel must scroll tree vertically: ${beforeScroll} -> ${afterScroll}; ${JSON.stringify(scrollDiagnostics)}`);

      const exported = await evaluate(`(async () => {
        state.planned.clear(); state.owned.clear(); state.waypoints.clear(); invalidateExactPlan(); calculatePlan();
        const tile = [...document.querySelectorAll('.unit-tile')].find(node => !node.classList.contains('unlocked'));
        tile.click();
        if (1440 === innerWidth) {
          state.planned.clear();
          const goal = state.units.find(unit => getRankOrder(unit.rank) === 3 && unit.section === 'researchable' && unit.rp > 0);
          toggleUnitMode(goal.data_unit_id, 'target');
          runExactPlan();
          while (els.planButton.disabled) await new Promise(resolve => setTimeout(resolve, 100));
          if (!state.planResult?.feasible) throw new Error('Exact plan must be feasible');
        }
        const button = document.getElementById('routeExportButton');
        const payload = window.WTRouteExport.buildPayload();
        const source = els.treeContainer.querySelector('.tree-canvas');
        const sourceWidth = source.scrollWidth;
        const sourceHeight = source.scrollHeight;
        const scroll = [els.treeContainer.scrollLeft, els.treeContainer.scrollTop];
        const canvas = await window.WTRouteExport.render();
        const budget = document.getElementById('floatingBudget');
        const budgetBox = budget.getBoundingClientRect();
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let darkPixels = 0;
        for (let i = 0; i < pixels.length; i += 80) if (pixels[i] < 100 && pixels[i+1] < 100 && pixels[i+2] < 100 && pixels[i+3]) darkPixels++;
        return {
          budgetVisible: getComputedStyle(budget).position === 'fixed' && budgetBox.top > 0 && budgetBox.bottom <= innerHeight && (budgetBox.bottom <= innerHeight - 18 || budgetBox.width >= innerWidth - 1) && budgetBox.left >= 0 && budgetBox.right <= innerWidth,
          budgetMatches: els.budgetRp.textContent === payload.totalRp && els.budgetSl.textContent === payload.totalSl && Number(els.budgetCount.textContent) === payload.pendingCount,
          scrollUnchanged: scroll[0] === els.treeContainer.scrollLeft && scroll[1] === els.treeContainer.scrollTop,
          cloneRemoved: !document.querySelector('.tree-screenshot'),
          sourceWidth, sourceHeight, darkPixels,
          buttonEnabled: !button.disabled,
          routeCount: payload.routes.length,
          pendingCount: payload.pendingCount,
          targetCount: payload.targetCount,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          preview: (() => { const part = document.createElement('canvas'); part.width=canvas.width; part.height=900; part.getContext('2d').drawImage(canvas,0,0); return part.toDataURL('image/png'); })(),
          png: canvas.toDataURL('image/png'),
        };
      })()`);
      const exportSummary = { ...exported, png: `${exported.png.length} bytes`, preview: 'PNG' };
      assert(exported.buttonEnabled && exported.routeCount > 0 && exported.pendingCount > 0 && exported.targetCount === 1, JSON.stringify(exportSummary));
      assert(exported.canvasWidth >= exported.sourceWidth && exported.canvasHeight >= exported.sourceHeight, JSON.stringify(exportSummary));
      assert(exported.budgetVisible && exported.budgetMatches && exported.scrollUnchanged && exported.cloneRemoved && exported.darkPixels > 500, JSON.stringify(exportSummary));
      fs.writeFileSync(path.join(artifacts, `route-export-${width}.png`), Buffer.from(exported.png.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(artifacts, `tree-export-preview-${width}.png`), Buffer.from(exported.preview.split(',')[1], 'base64'));
      const screenshot = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(artifacts, `full-canvas-${width}.png`), Buffer.from(screenshot.data, 'base64'));
      console.log(JSON.stringify({ width, layout, routeCount: exported.routeCount, exportSize: [exported.canvasWidth, exported.canvasHeight], pass: true }));
      if (width === 1440) {
        await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts });
        const filename = await evaluate("window.WTRouteExport.buildPayload().filename.replace('route-', 'tree-')");
        await evaluate('els.routeExportButton.click()');
        for (let i = 0; i < 200; i++) {
          if (await evaluate("!els.routeExportButton.disabled && els.statusText.textContent === '完整科技树截图已下载'")) break;
          await pause(100);
        }
        for (let i = 0; i < 100 && !fs.existsSync(path.join(artifacts, filename)); i++) await pause(100);
        const downloaded = fs.readFileSync(path.join(artifacts, filename));
        assert.equal(downloaded.subarray(1, 4).toString(), 'PNG');
        assert(downloaded.length > 100000, 'Full screenshot download must include tree pixels');
        console.log(JSON.stringify({ download: filename, bytes: downloaded.length, pass: true }));
      }
      const cleared = await evaluate(`(() => {
        els.clearButton.click();
        return [els.budgetRp.textContent, els.budgetSl.textContent, els.budgetCount.textContent, els.routeExportButton.disabled];
      })()`);
      assert.deepEqual(cleared, ['0', '0', '0', false], 'Clearing updates floating totals; an empty plan can still export the tree');
    }

    // A fresh renderer avoids Chromium retaining emulated pointer suppression across navigation.
    const { targetId: localTarget } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId: localTarget, flatten: true }));
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate('document.querySelectorAll(".unit-tile").length > 0')) break;
      await pause(100);
    }
    await checkMobileLongPress({ evaluate, call, artifacts, suffix: 'local-1440', country: 'china' });
    await checkBudgetPlanner({ evaluate, call, artifacts, suffix: 'local-1440' });
    const localApp = await evaluate(`(async () => {
      state.planned.clear(); state.owned.clear(); state.waypoints.clear(); invalidateExactPlan(); calculatePlan();
      const tile = [...document.querySelectorAll('.unit-tile')].find(node => !node.classList.contains('unlocked'));
      tile.click();
      const sourceWidth = els.treeContainer.querySelector('.tree-canvas').scrollWidth;
      const canvas = await window.WTRouteExport.render();
      return {
        summaryHidden: getComputedStyle(document.querySelector('.summary-panel')).display === 'none',
        treeScrollable: els.treeContainer.scrollHeight > els.treeContainer.clientHeight,
        exportEnabled: !els.routeExportButton.disabled,
        routeCount: window.WTRouteExport.buildPayload().routes.length,
        completeWidth: canvas.width >= sourceWidth,
      };
    })()`);
    assert.deepEqual(localApp, { summaryHidden: true, treeScrollable: true, exportEnabled: true, routeCount: 1, completeWidth: true });
    const localScreenshot = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifacts, 'local-full-canvas-1440.png'), Buffer.from(localScreenshot.data, 'base64'));
    console.log(JSON.stringify({ localApp, pass: true }));

    assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  } finally {
    browser.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
