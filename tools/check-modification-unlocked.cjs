const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const express = require('express');

async function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'logs', 'modification-unlocked-check');
  fs.mkdirSync(artifacts, { recursive: true });
  const catalog = require('../public/database/modifications/catalog.json');
  const rawVehicle = id => require(path.join(root, 'public', catalog.chunks[catalog.vehicles[id]].path)).v[id];
  const wolf = rawVehicle('us_m1128_wolfpack');
  const j16 = rawVehicle('j_16');
  const expectedCounts = [1, 2, 3, 4].map(tier => wolf.m.filter(mod => mod[2] === tier).length);
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--in-process-gpu', '--disable-gpu-compositing',
    `--user-data-dir=${path.join(artifacts, `profile-${Date.now()}`)}`,
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  let sequence = 0;
  let buffer = '';
  const pending = new Map();
  const errors = [];
  browser.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
  });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await call('Page.enable');
    await call('Runtime.enable');
    const snapshot = () => evaluate(`(() => {
      const tiles = [...document.querySelectorAll('#modificationTree .modification-tile')];
      return {
        count: tiles.length,
        disabled: tiles.filter(tile => tile.disabled).length,
        unlocked: tiles.filter(tile => tile.classList.contains('unlocked') && tile.textContent.includes('已解锁')).length,
        selected: tiles.filter(tile => tile.classList.contains('target')).length,
        counts: [...document.querySelectorAll('.modification-tier small')].map(node => Number(node.textContent.split('/')[0])),
        budget: ['modificationRp', 'modificationSl'].map(id => document.getElementById(id).textContent),
        status: document.getElementById('modificationStatus').textContent,
        zeroText: tiles.some(tile => tile.textContent.includes('0 RP · 0 SL')),
      };
    })()`);
    const action = name => evaluate(`document.querySelector('[data-modification-action="${name}"]').click()`);
    const open = id => evaluate(`document.getElementById('modificationDialog').close();ModificationWorkbench.open('${id}')`);
    for (const mode of ['local', 'pages']) {
      for (const width of [1440, 390]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/${mode === 'pages' ? 'pages/' : ''}` });
        for (let attempt = 0; attempt < 200; attempt++) {
          if (await evaluate('!!window.ModificationWorkbench && document.querySelectorAll(".unit-tile").length > 0')) break;
          await pause(100);
        }
        await evaluate(`els.countrySelect.value = 'china'; els.typeSelect.value = 'aviation'; loadTree()`);
        const checkVehicleLabels = async () => {
          for (const [id, category, label] of [
            ['j_7d', 'premium-golden-eagles', '\u91d1\u9e70\u8f7d\u5177'],
            ['su_30mkk', 'premium-pack', '\u793c\u5305\u8f7d\u5177'],
          ]) {
            assert.equal(await evaluate(`document.querySelector('[data-unit-id="${id}"] .roster-${category}')?.textContent`), label);
          }
          assert(!(await evaluate('!!document.getElementById("rosterAudit")')), 'Do not restore the removed audit panel');
        };
        await checkVehicleLabels();
        if (mode === 'local' && width === 1440) {
          await evaluate(`document.querySelector('[data-unit-id="su_30mkk"]').scrollIntoView({block:'center',inline:'center'})`);
          await pause(300);
          const labelShot = await call('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(artifacts, 'local-restored-vehicle-labels.png'), Buffer.from(labelShot.data, 'base64'));
        }
        await evaluate(`localStorage.setItem('wt-research:modifications:us_m1128_wolfpack', ${JSON.stringify(JSON.stringify({ selected: wolf.m.map(mod => mod[0]), researched: wolf.m.map(mod => mod[0]) }))})`);
        await open('us_m1128_wolfpack');
        assert(await evaluate('document.getElementById("modificationDialog").open'));
        const expected = await snapshot();
        assert.equal(expected.count, wolf.m.length);
        assert.equal(expected.disabled, wolf.m.length);
        assert.equal(expected.unlocked, wolf.m.length);
        assert.equal(expected.selected, 0);
        assert.deepEqual(expected.counts, expectedCounts);
        assert.deepEqual(expected.budget, ['0', '0']);
        assert.equal(expected.status, '\u5168\u90e8\u914d\u4ef6\u5df2\u89e3\u9501');
        assert.equal(expected.zeroText, false);
        await evaluate(`(() => {
          const tile = document.querySelector('#modificationTree .modification-tile');
          tile.click();
          tile.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        })()`);
        assert.deepEqual(await snapshot(), expected, 'Free modules cannot be toggled');
        for (const name of ['all', 'calculate', 'clear']) {
          await action(name);
          assert.deepEqual(await snapshot(), expected, `${name} must preserve automatic unlocks`);
        }
        await evaluate('document.fonts.ready');
        for (let attempt = 0; attempt < 80; attempt++) {
          if (await evaluate('[...document.querySelectorAll("#modificationTree img")].every(img => img.complete)')) break;
          await pause(100);
        }
        const layout = await evaluate(`(() => {
          const d = document.getElementById('modificationDialog').getBoundingClientRect();
          const viewport = document.getElementById('modificationViewport');
          const tiles = [...document.querySelectorAll('#modificationTree .modification-tile')];
          return {
            contained: d.left >= 0 && d.top >= 0 && d.right <= innerWidth && d.bottom <= innerHeight,
            readable: tiles.every(tile => getComputedStyle(tile).opacity === '1'),
            textFits: tiles.every(tile => { const a = tile.getBoundingClientRect(), b = tile.querySelector('.modification-tile-copy').getBoundingClientRect(); return b.right <= a.right && b.bottom <= a.bottom && b.top >= a.top; }),
            images: tiles.filter(tile => tile.querySelector('img').naturalWidth > 0).length,
            horizontalScroll: viewport.scrollWidth > viewport.clientWidth,
          };
        })()`);
        assert(layout.contained && layout.readable && layout.textFits, JSON.stringify(layout));
        assert.equal(layout.images, wolf.m.length, 'Module icons must load');
        if (width === 390) assert(layout.horizontalScroll);
        const shot = await call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(artifacts, `${mode}-${width}.png`), Buffer.from(shot.data, 'base64'));

        await open('j_16');
        await action('clear');
        const target = j16.m.find(mod => mod[0] === 'cn_pl12a');
        await evaluate(`document.querySelector('[data-mod-id="cn_pl12a"]').click()`);
        let paid = await snapshot();
        assert.equal(paid.disabled, 0);
        assert.equal(paid.selected, 1);
        assert.deepEqual(paid.budget, [target[7].toLocaleString('en-US'), target[8].toLocaleString('en-US')]);
        await action('calculate');
        assert.deepEqual((await snapshot()).budget, ['110,000', '168,000']);
        await evaluate(`document.querySelector('[data-mod-id="cn_pl12a"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
        paid = await snapshot();
        assert.equal(paid.selected, 0);
        assert.deepEqual(paid.budget, ['0', '0']);
        assert(await evaluate('document.querySelector("[data-mod-id=cn_pl12a]").classList.contains("researched")'));
        // The single clear button also removes researched marks.
        await action('clear');
        assert(!(await evaluate('document.querySelector("[data-mod-id=cn_pl12a]").classList.contains("researched")')));
        await open('us_m1128_wolfpack');
        assert.deepEqual(await snapshot(), expected, 'Unlocks survive vehicle switching and storage restore');
        await evaluate('document.getElementById("modificationDialog").close()');
        await checkVehicleLabels();
        console.log(JSON.stringify({ mode, width, unlocked: wolf.m.length, counts: expectedCounts, paidBudgetUnchanged: true, vehicleLabelsPreserved: true, pass: true }));
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    browser.kill();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
