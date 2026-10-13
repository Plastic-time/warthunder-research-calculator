const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const express = require('express');

async function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'logs', 'scroll-axes-check');
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
      const timer = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 60000);
      pending.set(id, { resolve, reject, timer });
      browser.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  }

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await call('Page.enable');
    await call('Runtime.enable');


    for (const width of [1920, 1440, 900, 390]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const route of ['/pages/', '/']) {
        await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + route });
        for (let i = 0; i < 100; i++) {
          if (await evaluate('document.querySelectorAll(".unit-tile").length > 0')) break;
          await pause(100);
        }
        await evaluate('WTTreeScroll.sync()');
        if (process.argv.includes('--arrows')) {
          await require('./check-tree-arrows.cjs').checkTreeArrows(evaluate);
        }
        const geometry = await evaluate(`(() => {
          const h = document.getElementById('treeScrollBar'), v = document.getElementById('treeVerticalScrollBar');
          const hr = h.getBoundingClientRect(), vr = v.getBoundingClientRect();
          const x = document.getElementById('treeScrollRange'), y = document.getElementById('treeVerticalScrollRange');
          const xr = x.getBoundingClientRect(), yr = y.getBoundingClientRect();
          return {
            h: {left:hr.left,top:hr.top,width:hr.width,height:hr.height,right:hr.right,bottom:hr.bottom},
            v: {left:vr.left,top:vr.top,width:vr.width,height:vr.height,right:vr.right,bottom:vr.bottom},
            x: {left:xr.left,top:xr.top,width:xr.width,height:xr.height},
            y: {left:yr.left,top:yr.top,width:yr.width,height:yr.height},
            visible: !h.hidden && !v.hidden,
            sameColor: getComputedStyle(h).backgroundColor === getComputedStyle(v).backgroundColor,
            noNative: getComputedStyle(els.treeContainer).scrollbarWidth === 'none',
            horizontalEnabled: !x.disabled,
            maxX: Number(x.max), maxY: Number(y.max)
          };
        })()`);
        assert(geometry.visible && geometry.sameColor && geometry.noNative);
        assert.equal(geometry.h.height, geometry.v.width, 'Axis housings must have identical thickness');
        assert.equal(geometry.x.height, geometry.y.width, 'Rotated controls must have identical track thickness');
        assert(geometry.v.right <= width && geometry.h.bottom <= 900 && geometry.v.top > 0);
        assert(Math.abs(geometry.v.bottom - geometry.h.top) <= 1, 'Axes must join without overlap');
        assert(Math.abs(geometry.h.right - geometry.v.left) <= 1, 'Axes must meet at the same corner');
        assert(await evaluate(`(() => {
          const planner = document.getElementById('floatingPlanner').getBoundingClientRect();
          const bar = document.getElementById('treeVerticalScrollBar').getBoundingClientRect();
          return planner.right <= bar.left || planner.left >= bar.right;
        })()`), 'Floating planner must not cover the vertical scrollbar');

        async function drag(start, end) {
          await call('Input.dispatchMouseEvent', { type:'mouseMoved', ...start });
          await call('Input.dispatchMouseEvent', { type:'mousePressed', ...start, button:'left', clickCount:1 });
          await call('Input.dispatchMouseEvent', { type:'mouseMoved', ...end, button:'left', buttons:1 });
          await call('Input.dispatchMouseEvent', { type:'mouseReleased', ...end, button:'left', clickCount:1 });
          await pause(150);
        }
        const y = geometry.y;
        await drag({x:y.left+y.width/2,y:y.top+24}, {x:y.left+y.width/2,y:y.top+y.height*0.65});
        let current = await evaluate('({y:els.treeContainer.scrollTop,x:els.treeContainer.scrollLeft,range:Number(document.getElementById("treeVerticalScrollRange").value)})');
        assert(current.y > geometry.maxY * 0.5 && Math.abs(current.y-current.range) <= 1, 'Vertical drag must move tree and sync');
        const verticalPosition = current.y;
        if (geometry.horizontalEnabled) {
          const x = geometry.x;
          await drag({x:x.left+24,y:x.top+x.height/2}, {x:x.left+x.width*0.75,y:x.top+x.height/2});
          current = await evaluate('({y:els.treeContainer.scrollTop,x:els.treeContainer.scrollLeft,range:Number(document.getElementById("treeScrollRange").value)})');
          assert(current.x > geometry.maxX*0.5 && Math.abs(current.range-current.x) <= 1, 'Horizontal drag must move tree and sync');
          assert(Math.abs(current.y-verticalPosition) <= 1, 'Horizontal drag must not change vertical scroll');
        }
        const point = {x:Math.min(200,width/2),y:geometry.v.top+150};
        await call('Input.dispatchMouseEvent', {type:'mouseMoved',...point});
        await call('Input.dispatchMouseEvent', {type:'mouseWheel',...point,deltaX:0,deltaY:-400});
        await pause(450);
        assert(await evaluate('els.treeContainer.scrollTop') < verticalPosition-100, 'Wheel must still work over the tree');
        await evaluate('document.getElementById("treeVerticalScrollRange").focus()');
        await call('Input.dispatchKeyEvent', {type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});
        await call('Input.dispatchKeyEvent', {type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});
        await pause(150);
        assert(await evaluate('Math.abs(els.treeContainer.scrollTop - (els.treeContainer.scrollHeight-els.treeContainer.clientHeight)) <= 1'), 'End must reach final rank');
        await evaluate('document.activeElement.blur()');
        const suffix = (route === '/' ? 'local' : 'pages') + '-' + width;
        let shot = await call('Page.captureScreenshot', {format:'png'});
        fs.writeFileSync(path.join(artifacts, suffix+'-bottom.png'), Buffer.from(shot.data,'base64'));
        await evaluate('els.treeContainer.scrollLeft=0;els.treeContainer.scrollTop=0;WTTreeScroll.sync()');
        await pause(150);
        shot = await call('Page.captureScreenshot', {format:'png'});
        fs.writeFileSync(path.join(artifacts, suffix+'-top.png'), Buffer.from(shot.data,'base64'));

        if (width === 900) {
          await evaluate("els.countrySelect.value='israel';els.typeSelect.value='aviation';loadTree()");
          await pause(1000);
          assert(await evaluate('Number(document.getElementById("treeVerticalScrollRange").max) === els.treeContainer.scrollHeight-els.treeContainer.clientHeight'), 'Changing trees must update vertical range');
          await evaluate('els.searchInput.value="no-vehicle-matches-this";els.searchInput.dispatchEvent(new Event("input"))');
          await pause(400); // search input is debounced by 180 ms
          assert(await evaluate('document.getElementById("treeScrollBar").hidden && document.getElementById("treeVerticalScrollBar").hidden'), 'No stale scrollbar after empty search');
          await evaluate('els.searchInput.value="";els.searchInput.dispatchEvent(new Event("input"))');
          await pause(100);
          assert(await evaluate('!document.getElementById("treeVerticalScrollBar").hidden'), 'Vertical scrollbar returns with tree');
        }
        if (process.argv.includes('--updates') && [900, 390].includes(width)) {
          await require('./check-vehicle-updates.cjs').checkVehicleUpdates({ evaluate, call, artifacts, suffix });
        }
        if (process.argv.includes('--folders')) {
          await require('./check-vehicle-folders.cjs').checkVehicleFolders({ evaluate, call, artifacts, suffix });
        }
        if (process.argv.includes('--planned-count') && [900,390].includes(width)) {
          await require('./check-planned-folder-count.cjs').checkPlannedFolderCount({ evaluate, call, artifacts, suffix });
        }
        if (process.argv.includes('--alignment')) {
          await require('./check-tree-alignment.cjs').checkTreeAlignment({ evaluate, call, artifacts, suffix });
        }
        if (process.argv.includes('--modification-symbols') && [900,390].includes(width)) {
          await require('./check-modification-symbols.cjs').checkModificationSymbols({ evaluate, call, artifacts, suffix });
        }
        console.log(JSON.stringify({route,width,thickness:geometry.h.height,trackThickness:geometry.x.height,dragAndWheel:true,pass:true}));
      }
    }
    assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  } finally {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    browser.kill();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
