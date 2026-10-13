const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const express = require('express');

// Drive real browser input over Chrome's local debugging pipe, with no test dependency.
async function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'logs', 'wheel-check');
  fs.mkdirSync(artifacts, { recursive: true });
  const app = express();
  app.use('/pages', express.static(path.join(root, 'docs')));
  app.use(require('../main'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(artifacts, `profile-${Date.now()}`)}`,
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  let sequence = 0;
  let buffer = '';
  const pending = new Map();
  const pageErrors = [];
  browser.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails);
      buffer = buffer.slice(end + 1);
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
      }
    }
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    async function evaluate(expression) {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    await call('Page.enable');
    await call('Runtime.enable');
    for (const width of [1440, 900, 390]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const route of ['/pages/', '/']) {
        await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}${route}` });
        let ready = false;
        for (let i = 0; i < 100; i++) {
          ready = await evaluate('document.querySelectorAll(".unit-tile").length > 0');
          if (ready) break;
          await pause(100);
        }
        assert(ready, `Tree failed to load: ${route}`);
        assert.equal(await evaluate('document.querySelectorAll(".planner-mode-field, [data-selection-mode]").length'), 0, 'Top click-mode controls must stay removed');
        if (route === '/pages/') {
          assert(await evaluate('document.querySelectorAll(".roster-badge").length > 0'), 'Classification badges missing');
          assert(await evaluate('!document.getElementById("rosterAudit")'), 'Roster comparison must stay hidden');
          await evaluate('window.scrollTo(0,0)');
          await pause(150);
          const bar = await evaluate(`(() => {
            const input = document.getElementById('treeScrollRange');
            const rect = input.getBoundingClientRect();
            const tree = document.getElementById('treeContainer');
            const canvas = tree.querySelector('.tree-canvas');
            return {x:rect.left+24,y:rect.top+rect.height/2,right:rect.right-24,visible:!document.getElementById('treeScrollBar').hidden,bottom:rect.bottom,treeClient:tree.clientWidth,treeScroll:tree.scrollWidth,canvasWidth:canvas?.getBoundingClientRect().width,nativeScrollbarWidth:getComputedStyle(tree).scrollbarWidth,status:document.getElementById('statusText').textContent};
          })()`);
          assert(bar.visible && bar.bottom <= 900, `Persistent scrollbar must be visible without scrolling down: ${JSON.stringify(bar)}`);
          assert.equal(bar.nativeScrollbarWidth, 'none', 'The tree native scrollbar must stay hidden when the persistent scrollbar is present');
          await call('Input.dispatchMouseEvent', {type:'mousePressed',x:bar.x,y:bar.y,button:'left',clickCount:1});
          await call('Input.dispatchMouseEvent', {type:'mouseMoved',x:bar.right,y:bar.y,button:'left',buttons:1});
          await call('Input.dispatchMouseEvent', {type:'mouseReleased',x:bar.right,y:bar.y,button:'left',clickCount:1});
          await pause(100);
          // On wide screens the tree may overflow by only a few dozen pixels, so compare against the available range.
          assert(await evaluate('(() => { const range = els.treeContainer.scrollWidth - els.treeContainer.clientWidth; return range > 0 && els.treeContainer.scrollLeft >= Math.min(100, range - 1) && scrollY === 0; })()'), 'Dragging persistent scrollbar must move tree, not page');
          await evaluate('els.treeContainer.scrollLeft = 0');
          await pause(100);
          assert.equal(await evaluate('Number(document.getElementById("treeScrollRange").value)'), 0, 'Scrollbar must follow tree movement');
          console.log(JSON.stringify({label:`fixed-scrollbar-${width}`,pass:true}));
          const auditShot = await call('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(artifacts, `roster-${width}.png`), Buffer.from(auditShot.data, 'base64'));
        }
        assert.equal(await evaluate('getComputedStyle(document.body).backgroundImage'), 'none', 'Page background image must stay removed');
        const fontCheck = await evaluate(`(async () => {
          const symbols = [8928,9239,9241,9248,9600,9602,9603,9604,9605,9668,9674,9675,9676,9677,9680,9684,9687,9688,9697,9698,9701,61529].map(code => String.fromCodePoint(code));
          const faces = await document.fonts.load('48px WTSymbols', symbols.join(''));
          const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 100;
          const ctx = canvas.getContext('2d', {willReadFrequently:true});
          const raster = (symbol, family) => {
            ctx.clearRect(0, 0, 160, 100); ctx.font = '48px ' + family; ctx.fillText(symbol, 8, 65);
            return [...ctx.getImageData(0, 0, 160, 100).data];
          };
          return {
            loaded: faces.some(face => face.status === 'loaded'),
            titleUsesFont: getComputedStyle(document.querySelector('.unit-title')).fontFamily.includes('WTSymbols'),
            rendered: symbols.filter(symbol => raster(symbol, 'WTSymbols').some(value => value !== 0)).length,
            distinct: symbols.filter(symbol => raster(symbol, 'WTSymbols').join(',') !== raster(symbol, 'sans-serif').join(',')).length,
          };
        })()`);
        assert.deepEqual(fontCheck, {loaded:true,titleUsesFont:true,rendered:22,distinct:22});
        console.log(JSON.stringify({label:`symbols-${route}-${width}`, ...fontCheck, pass:true}));
        if (route === '/pages/') {
          const smoke = await evaluate(`(async () => {
            const report = [];
            for (const entry of state.snapshot.files) {
              const parts = entry.path.split('/');
              const country = parts[1];
              const type = parts[2].slice(country.length + 1, -5);
              const result = await api('/api/tree/' + country + '/' + type);
              const count = result.data.flatMap(rank => [...rank.researchable_vehicles, ...rank.premium_vehicles].flat()).flatMap(item => item.items || [item]).length;
              if (count !== entry.units) throw new Error('Wrong count: ' + entry.path);
              report.push(count);
            }
            state.planned.clear();
            document.querySelector('[data-unit-id="us_m3_stuart"]').click();
            const selected = {rp: els.totalRp.textContent, sl: els.totalSp.textContent};
            els.dependencyModeSelect.value = 'selected';
            els.dependencyModeSelect.dispatchEvent(new Event('change'));
            const dependent = {rp: els.totalRp.textContent, sl: els.totalSp.textContent};
            const firstRank = state.tree[0];
            const quantity = getRankUnlockQuantity(firstRank);
            const candidates = state.units.filter(unit => unit.rank === firstRank.rank && unit.section === 'researchable' && !state.initialUnlocked.has(unit.data_unit_id));
            for (const unit of candidates) {
              if (getSelectedVehicleCount(firstRank.rank) >= quantity) break;
              if (!state.planned.has(unit.data_unit_id)) document.querySelector('[data-unit-id="' + unit.data_unit_id + '"]').click();
            }
            const gate = document.querySelector('.rank-unlock-line');
            const gateComplete = quantity === 6 && gate.classList.contains('is-complete') && gate.textContent.includes('6 / 6');
            const rankRailClean = !document.querySelector('.rank-unlock-count') && document.querySelectorAll('.rank-unlock-line').length > 0;
            els.clearButton.click();
            const initialLabels = [...document.querySelectorAll('.pill.unlocked')].map(node => node.textContent);
            return {trees:report.length, units:report.reduce((a,b)=>a+b,0), selected, dependent, gateComplete, rankRailClean, initialLabels};
          })()`);
          assert.equal(smoke.trees, 50);
          assert.equal(smoke.units, 3235);
          assert.deepEqual(smoke.selected, {rp:'2,900',sl:'700'});
          assert.deepEqual(smoke.dependent, smoke.selected);
          assert.equal(smoke.gateComplete, true, 'Restore rank unlock count and completed gate');
          assert.equal(smoke.rankRailClean, true, 'Only the bottom rank unlock progress should remain visible');
          assert(smoke.initialLabels.length > 0 && smoke.initialLabels.every(label => label === '初始载具'), 'Rank I default vehicle labels must describe their initial status');
          console.log(JSON.stringify({label:`pages-data-${width}`, ...smoke, pass:true}));
          const guide = await evaluate(`(() => {
            els.guideButton.click();
            const dialog = els.usageGuideDialog;
            const rect = dialog.getBoundingClientRect();
            const text = dialog.textContent;
            const result = {
              open: dialog.open,
              fitsViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
              noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth + 1,
              steps: dialog.querySelectorAll('.usage-guide-steps li').length,
              coversRightClick: text.includes('右键') && text.includes('已拥有') && text.includes('途经点'),
              coversPlanner: text.includes('自动补位时避开折叠载具') && text.includes('等级补足'),
              coversWarning: text.includes('测试提醒') && text.includes('游戏内手动核对'),
            };
            dialog.querySelector('[data-guide-close]').click();
            result.closed = !dialog.open;
            return result;
          })()`);
          assert.deepEqual(guide, {open:true,fitsViewport:true,noHorizontalOverflow:true,steps:6,coversRightClick:true,coversPlanner:true,coversWarning:true,closed:true});
          console.log(JSON.stringify({label:`usage-guide-${width}`, ...guide, pass:true}));
          await evaluate('els.guideButton.click()');
          const guideShot = await call('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(artifacts, `usage-guide-${width}.png`), Buffer.from(guideShot.data, 'base64'));
          await evaluate('closeUsageGuide()');
          const contextMenu = await evaluate(`(async () => {
            els.countrySelect.value = 'usa'; els.typeSelect.value = 'ground'; await loadTree();
            state.planned.clear(); state.owned.clear(); state.waypoints.clear(); calculatePlan();
            const open = (id, x, y) => document.querySelector('[data-unit-id="' + id + '"]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:x, clientY:y, button:2}));
            open('us_m3_stuart', innerWidth - 2, innerHeight - 2);
            const menu = els.unitContextMenu;
            const firstRect = menu.getBoundingClientRect();
            const labels = [...menu.querySelectorAll('[data-context-label]')].map(node => node.textContent);
            const fits = firstRect.left >= 0 && firstRect.top >= 0 && firstRect.right <= document.documentElement.clientWidth && firstRect.bottom <= innerHeight;
            menu.querySelector('[data-context-action="owned"]').click();
            const ownedApplied = state.owned.has('us_m3_stuart') && !state.planned.has('us_m3_stuart') && menu.hidden;
            open('us_m3_stuart', 12, 12);
            const ownedButton = menu.querySelector('[data-context-action="owned"]');
            const activeShown = ownedButton.classList.contains('is-active') && ownedButton.getAttribute('aria-checked') === 'true' && ownedButton.textContent.includes('取消拥有标记');
            ownedButton.click();
            const ownedRemoved = !state.owned.has('us_m3_stuart');
            document.querySelector('[data-unit-id="us_m3_stuart"]').click();
            const leftClickTargets = state.planned.has('us_m3_stuart') && !state.owned.has('us_m3_stuart') && !state.waypoints.has('us_m3_stuart');
            document.querySelector('[data-unit-id="us_m3_stuart"]').click();
            open('us_m2a4', 80, 80);
            const initialDisabled = [...menu.querySelectorAll('[data-context-action]')].every(button => button.disabled) && els.unitContextHint.textContent.includes('无需设置');
            closeUnitContextMenu();
            open('us_m3_stuart', Math.min(innerWidth - 20, 300), 240);
            return {labels, fits, ownedApplied, activeShown, ownedRemoved, leftClickTargets, initialDisabled, visible:!menu.hidden, title:els.unitContextTitle.textContent};
          })()`);
          console.log(JSON.stringify({label:`unit-context-menu-${width}`, ...contextMenu}));
          assert.deepEqual(contextMenu.labels, ['设为目标','标记为已拥有','设为途经点']);
          assert(contextMenu.fits && contextMenu.ownedApplied && contextMenu.activeShown && contextMenu.ownedRemoved && contextMenu.leftClickTargets && contextMenu.initialDisabled && contextMenu.visible && ['M3 轻型坦克','M3 Stuart'].includes(contextMenu.title));
          console.log(JSON.stringify({label:`unit-context-menu-${width}-pass`, pass:true}));
          const contextMenuShot = await call('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(artifacts, `unit-context-menu-${width}.png`), Buffer.from(contextMenuShot.data, 'base64'));
          const exactPlan = await evaluate(`(async () => {
            els.countrySelect.value = 'usa'; els.typeSelect.value = 'ground'; await loadTree();
            state.planned.clear(); state.owned.clear(); state.waypoints.clear(); invalidateExactPlan(); calculatePlan();
            document.querySelector('[data-unit-id="us_m18_hellcat"]').click();
            window.scrollTo(0, Math.floor(document.documentElement.scrollHeight / 2));
            await new Promise(resolve => setTimeout(resolve, 50));
            const middleVisible = document.querySelector('.floating-planner').classList.contains('is-visible');
            window.scrollTo(0, document.documentElement.scrollHeight);
            await new Promise(resolve => setTimeout(resolve, 50));
            const floatRect = document.querySelector('.floating-planner').getBoundingClientRect();
            const treeRect = els.treeContainer.getBoundingClientRect();
            const copyRect = document.querySelector('.floating-planner-copy').getBoundingClientRect();
            const floatingVisible = floatRect.top >= 0 && floatRect.bottom <= innerHeight && getComputedStyle(document.querySelector('.floating-planner')).position === 'fixed';
            const dockedOutsideTree = floatRect.left >= treeRect.right - 1;
            const copyFitsViewport = copyRect.left >= 0 && copyRect.right <= innerWidth;
            const warningVisible = document.querySelector('.floating-planner').textContent.includes('测试功能') && document.querySelector('.floating-planner').textContent.includes('自行手动核对');
            els.planButton.click();
            for (let i = 0; i < 100 && els.planButton.disabled; i++) await new Promise(resolve => setTimeout(resolve, 30));
            const result = state.planResult;
            const status = els.plannerStatus.textContent;
            const countsValid = result.rankCounts.every(rank => rank.selected >= rank.required);
            const labels = [...document.querySelectorAll('.pill.filler-label')].map(node => node.textContent);
            return {
              rp: els.totalRp.textContent,
              sl: els.totalSp.textContent,
              feasible: result.feasible,
              complete: result.searchComplete,
              countsValid,
              targetIncluded: result.selectedIds.includes('us_m18_hellcat'),
              fillers: result.fillerIds.length,
              labels,
              status,
              floatingVisible,
              middleVisible,
              dockedOutsideTree,
              copyFitsViewport,
              warningVisible,
              countText: els.floatingPlanCount.textContent,
              geometry: {floatLeft:floatRect.left,floatRight:floatRect.right,treeRight:treeRect.right,viewport:innerWidth},
            };
          })()`);
          assert.deepEqual({rp:exactPlan.rp,sl:exactPlan.sl,feasible:exactPlan.feasible,complete:exactPlan.complete,countsValid:exactPlan.countsValid,targetIncluded:exactPlan.targetIncluded}, {
            rp:'115,000',sl:'284,800',feasible:true,complete:true,countsValid:true,targetIncluded:true,
          });
          assert(exactPlan.fillers > 0 && exactPlan.labels.length === exactPlan.fillers && exactPlan.labels.every(label => label === '等级补足'));
          assert(exactPlan.status.includes('已找到最低 RP 路线'));
          console.log(JSON.stringify({label:`local-exact-plan-geometry-${width}`, middleVisible:exactPlan.middleVisible, floatingVisible:exactPlan.floatingVisible, dockedOutsideTree:exactPlan.dockedOutsideTree, copyFitsViewport:exactPlan.copyFitsViewport, warningVisible:exactPlan.warningVisible, countText:exactPlan.countText, geometry:exactPlan.geometry}));
          assert(exactPlan.middleVisible && exactPlan.floatingVisible && exactPlan.dockedOutsideTree && exactPlan.copyFitsViewport && exactPlan.warningVisible && exactPlan.countText === '目标 1 · 途经点 0');
          console.log(JSON.stringify({label:`local-exact-plan-${width}`, ...exactPlan, pass:true}));
          const plannerShot = await call('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(artifacts, `local-exact-plan-${width}.png`), Buffer.from(plannerShot.data, 'base64'));
          const language = await evaluate(`(async () => {
            els.countrySelect.value = 'britain'; els.typeSelect.value = 'aviation'; await loadTree();
            setLanguage('zh');
            const groupTitle = () => [...document.querySelectorAll('.group-header > span')].find(node => node.textContent.includes('布伦海姆') || node.textContent.includes('Blenheim'));
            const zhTitle = groupTitle();
            const zh = {
              text: zhTitle?.textContent,
              complete: zhTitle && zhTitle.scrollWidth <= zhTitle.clientWidth + 1 && zhTitle.scrollHeight <= zhTitle.clientHeight + 1,
              active: els.languageSelect.value === 'zh',
            };
            setLanguage('en');
            const enTitle = groupTitle();
            const en = {
              text: enTitle?.textContent,
              complete: enTitle && enTitle.scrollWidth <= enTitle.clientWidth + 1 && enTitle.scrollHeight <= enTitle.clientHeight + 1,
              active: els.languageSelect.value === 'en',
            };
            els.searchInput.value = '布伦海姆'; els.searchInput.dispatchEvent(new Event('input'));
            const chineseSearchInEnglish = groupTitle()?.textContent === 'Blenheim/Beaufort';
            setLanguage('zh');
            els.searchInput.value = 'Blenheim/Beaufort'; els.searchInput.dispatchEvent(new Event('input'));
            const englishSearchInChinese = groupTitle()?.textContent === '布伦海姆/波佛特';
            const labelsFit = [...document.querySelectorAll('.unit-title, .group-header > span')].every(node =>
              node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1
            );
            const languages = [...els.languageSelect.options].map(option => option.value);
            els.searchInput.value = ''; els.searchInput.dispatchEvent(new Event('input'));
            return {zh, en, chineseSearchInEnglish, englishSearchInChinese, labelsFit, languages};
          })()`);
          assert.deepEqual(language.zh, {text:'布伦海姆/波佛特',complete:true,active:true});
          assert.deepEqual(language.en, {text:'Blenheim/Beaufort',complete:true,active:true});
          assert.equal(language.chineseSearchInEnglish, true, 'Chinese search must work in English display mode');
          assert.equal(language.englishSearchInChinese, true, 'English search must work in Chinese display mode');
          assert.equal(language.labelsFit, true, 'Vehicle and folder names must not be clipped');
          assert.deepEqual(language.languages, ['zh', 'en', 'ru', 'de', 'fr', 'ja', 'es']);
          console.log(JSON.stringify({label:`vehicle-language-${width}`, ...language, pass:true}));
          const languageShot = await call('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(artifacts, `vehicle-language-${width}.png`), Buffer.from(languageShot.data, 'base64'));
        }
        await pause(600);
        await evaluate('window.scrollTo(0, document.querySelector(".tree-container").getBoundingClientRect().top + scrollY)');
        await pause(150);
        const point = await evaluate(`(() => {
          const box = document.querySelector('.tree-container').getBoundingClientRect();
          return {x: Math.round(Math.max(0, box.left) + Math.min(box.width, innerWidth - Math.max(0, box.left)) / 2), y: 250};
        })()`);
        assert(await evaluate(`!!document.elementFromPoint(${point.x}, ${point.y}).closest('.tree-container')`), 'Pointer must be over tree');
        const position = () => evaluate('({ y: scrollY, x: document.querySelector(".tree-container").scrollLeft })');
        async function wheel(dx, dy) {
          await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
          await call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: dx, deltaY: dy });
          await pause(400);
        }
        // Reproduce the old regression in the same page before checking the fix.
        const oldStart = await position();
        if (width === 1440 && route === '/pages/') {
          await evaluate('document.querySelector(".tree-container").style.overscrollBehavior = "contain"');
          await pause(700);
          await wheel(0, 350);
          assert.equal((await position()).y, oldStart.y, 'Old CSS should reproduce blocked page scrolling');
        }
        const oldEnd = await position();
        await evaluate('document.querySelector(".tree-container").style.removeProperty("overscroll-behavior")');
        await call('Page.reload');
        await pause(1500);
        await evaluate('window.scrollTo(0, document.querySelector(".tree-container").getBoundingClientRect().top + scrollY)');
        await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });
        await pause(700);
        const reloadedStart = await position();
        await wheel(0, 350);
        const down = await position();
        if (down.y <= reloadedStart.y + 100) {
          console.log(await evaluate(`JSON.stringify([...document.querySelectorAll('.tree-container,.tree-canvas,.workspace')].map(e=>({class:e.className,client:e.clientHeight,scroll:e.scrollHeight,top:e.scrollTop,overflow:getComputedStyle(e).overflow,overscroll:getComputedStyle(e).overscrollBehavior})))`));
          console.log(await evaluate(`JSON.stringify({height:document.documentElement.scrollHeight, status:document.getElementById('statusText').textContent, target:document.elementFromPoint(${point.x},${point.y})?.outerHTML.slice(0,500), tiles:document.querySelectorAll('.unit-tile').length})`));
        }
        assert(down.y > reloadedStart.y + 100, `Wheel down must move page: ${JSON.stringify({reloadedStart, down, route, width})}`);
        await wheel(0, -250);
        const up = await position();
        assert(up.y < down.y - 100, 'Wheel up must move page');
        await wheel(300, 0);
        const horizontal = await position();
        assert(horizontal.x > up.x + 100, 'Horizontal wheel must move tree');
        assert(Math.abs(horizontal.y - up.y) < 2, 'Horizontal wheel must not move page vertically');
        const screenshot = await call('Page.captureScreenshot', { format: 'png' });
        const label = `${route === '/' ? 'local' : 'pages'}-${width}`;
        fs.writeFileSync(path.join(artifacts, `${label}.png`), Buffer.from(screenshot.data, 'base64'));
        console.log(JSON.stringify({ label, blockedBefore: oldEnd.y - oldStart.y, down: down.y - oldEnd.y, up: up.y - down.y, horizontal: horizontal.x - up.x, pass: true }));
        if (route === '/pages/') {
          const extra = await evaluate(`(async () => {
            els.countrySelect.value = 'germany'; els.typeSelect.value = 'ground'; await loadTree();
            state.planned.clear();
            document.querySelector('[data-unit-id="germ_garford_putilov"]').click();
            const unknown = !els.totalRp.textContent.includes('未知') && !els.totalSp.textContent.includes('未知') && document.getElementById('totalRpLabel').textContent === '已知 RP' && document.getElementById('totalSpLabel').textContent === '已知 SL';
            const notFree = !state.initialUnlocked.has('germ_garford_putilov');
            window.scrollTo(0, 0);
            const noOverflow = [...document.querySelectorAll('.metric')].every(el => el.scrollWidth <= el.clientWidth + 1);
            els.clearButton.click();
            const hiddenBadge = document.querySelector('[data-unit-id="germ_garford_putilov"] [data-roster-hidden-help]');
            hiddenBadge.click();
            const hiddenDialog = document.getElementById('rosterHiddenDialog');
            const hiddenHelp = {
              label: hiddenBadge.textContent,
              open: hiddenDialog.open,
              unit: hiddenDialog.querySelector('[data-roster-hidden-name]').textContent,
              explainsHidden: hiddenDialog.textContent.includes('不是向所有账号公开展示的常规科技树载具'),
              explainsCalculation: hiddenDialog.textContent.includes('RP / SL 计算不会因此改变'),
              didNotSelect: !state.planned.has('germ_garford_putilov'),
            };
            els.countrySelect.value = 'usa'; els.typeSelect.value = 'aviation'; await loadTree();
            const airBr = state.unitMap.get('f2a-1').br;
            return {unknown, notFree, noOverflow, airBr, hiddenHelp};
          })()`);
          assert.deepEqual(extra, {unknown:true,notFree:true,noOverflow:true,airBr:'2.0',hiddenHelp:{
            label:'持有后可见',open:true,unit:'▀加福德',explainsHidden:true,explainsCalculation:true,didNotSelect:true,
          }});
          console.log(JSON.stringify({label:`pages-cases-${width}`, ...extra, pass:true}));
          const hiddenHelpImage = await call('Page.captureScreenshot', {format:'png'});
          fs.writeFileSync(path.join(artifacts, `hidden-help-${width}.png`), Buffer.from(hiddenHelpImage.data, 'base64'));
          await evaluate('document.getElementById("rosterHiddenDialog").close()');
          const acquisition = await evaluate(`(async () => {
            els.countrySelect.value = 'china'; els.typeSelect.value = 'aviation'; await loadTree();
            const text = id => document.querySelector('[data-unit-id="' + id + '"] .roster-badge')?.textContent;
            return {j7d:text('j_7d'), su30:text('su_30mkk')};
          })()`);
          assert.deepEqual(acquisition, {j7d:'金鹰载具',su30:'礼包载具'});
          console.log(JSON.stringify({label:`acquisition-${width}`, ...acquisition, pass:true}));
          const modifications = await evaluate(`(async () => {
            state.planned.clear();
            els.searchInput.value = 'j_16'; els.searchInput.dispatchEvent(new Event('input'));
            const launch = document.querySelector('[data-modifications-id="j_16"]');
            launch.click();
            for (let i = 0; i < 50 && !document.getElementById('modificationDialog').open; i++) await new Promise(resolve => setTimeout(resolve, 50));
            const dialog = document.getElementById('modificationDialog');
            dialog.querySelector('[data-modification-action="clear-owned"]').click();
            dialog.querySelector('[data-modification-action="clear"]').click();
            const target = dialog.querySelector('[data-mod-id="cn_pl12a"]');
            target.click();
            const manual = {
              rp: document.getElementById('modificationRp').textContent,
              sl: document.getElementById('modificationSl').textContent,
              status: document.getElementById('modificationStatus').textContent,
              tiers: [...dialog.querySelectorAll('.modification-tier')].map(node => node.textContent.replace(/\\s+/g, ' ').trim()),
            };
            dialog.querySelector('[data-modification-action="calculate"]').click();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            for (let i = 0; i < 50 && ![...dialog.querySelectorAll('.modification-tile img')].every(img => img.complete); i++) await new Promise(resolve => setTimeout(resolve, 50));
            const viewport = document.getElementById('modificationViewport');
            const freshTarget = dialog.querySelector('[data-mod-id="cn_pl12a"]');
            const footer = dialog.querySelector('.modification-footer').getBoundingClientRect();
            const tiers = [...dialog.querySelectorAll('.modification-tier')].map(node => node.textContent.replace(/\\s+/g, ' ').trim());
            return {
              open: dialog.open,
              tiles: dialog.querySelectorAll('.modification-tile').length,
              categories: dialog.querySelectorAll('.modification-category').length,
              rp: document.getElementById('modificationRp').textContent,
              sl: document.getElementById('modificationSl').textContent,
              status: document.getElementById('modificationStatus').textContent,
              dependencies: dialog.querySelectorAll('.modification-tile.dependency').length,
              fillers: dialog.querySelectorAll('.modification-tile.filler').length,
              activeLinks: dialog.querySelectorAll('.modification-link.active').length,
              tiers,
              flatTile: parseFloat(getComputedStyle(freshTarget).borderRadius) <= 2,
              darkPanel: getComputedStyle(viewport).backgroundColor === 'rgb(29, 34, 36)',
              horizontalAtSmallWidth: ${width} > 720 || viewport.scrollWidth > viewport.clientWidth,
              footerVisible: footer.bottom <= ${900} && footer.top >= 0,
              didNotSelectVehicle: !state.planned.has('j_16'),
              iconsLoaded: [...dialog.querySelectorAll('.modification-tile img')].every(img => img.complete && img.naturalWidth > 0),
              manual,
            };
          })()`);
          assert.equal(modifications.open, true);
          assert.equal(modifications.tiles, 25);
          assert.equal(modifications.categories, 3);
          assert.deepEqual(modifications.manual, {
            rp: '17,000', sl: '26,000', status: '手动选择 1 · 当前预算仅统计所选配件',
            tiers: ['I0/1', 'II0/3', 'III0/3', 'IV1'],
          });
          assert.equal(modifications.rp, '110,000');
          assert.equal(modifications.sl, '168,000');
          assert(modifications.status.includes('自动加入 8'));
          assert(modifications.dependencies >= 3 && modifications.fillers >= 4 && modifications.activeLinks >= 2);
          assert(modifications.tiers[0].includes('2/1') && modifications.tiers[1].includes('3/3') && modifications.tiers[2].includes('3/3'));
          console.log(JSON.stringify({label:`j16-modifications-${width}`, ...modifications}));
          assert(modifications.flatTile && modifications.darkPanel && modifications.horizontalAtSmallWidth && modifications.footerVisible && modifications.didNotSelectVehicle && modifications.iconsLoaded);
          console.log(JSON.stringify({label:`j16-modifications-${width}-pass`, pass:true}));
          const modificationImage = await call('Page.captureScreenshot', {format:'png'});
          fs.writeFileSync(path.join(artifacts, `j16-modifications-${width}.png`), Buffer.from(modificationImage.data, 'base64'));
          await evaluate('document.getElementById("modificationDialog").close()');
          const modificationCoverage = await evaluate(`(async () => {
            const samples = [
              ['usa', 'ground', 'us_m2a4'],
              ['usa', 'helicopters', 'ah_1g'],
              ['usa', 'ships', 'us_destroyer_clemson_litchfield'],
              ['usa', 'boats', 'us_pt6'],
            ];
            const results = [];
            for (const [country, type, id] of samples) {
              els.searchInput.value = '';
              els.searchInput.dispatchEvent(new Event('input'));
              els.countrySelect.value = country;
              els.typeSelect.value = type;
              await loadTree();
              const button = document.querySelector('[data-modifications-id="' + id + '"]');
              if (!button) throw new Error('Missing modification button: ' + id);
              button.click();
              const dialog = document.getElementById('modificationDialog');
              for (let i = 0; i < 60 && (!dialog.open || !dialog.querySelector('.modification-tile')); i++) await new Promise(resolve => setTimeout(resolve, 50));
              results.push({
                id,
                open: dialog.open,
                title: document.getElementById('modificationTitle').textContent,
                tiles: dialog.querySelectorAll('.modification-tile').length,
                categories: dialog.querySelectorAll('.modification-category').length,
                rp: document.getElementById('modificationRp').textContent,
                sl: document.getElementById('modificationSl').textContent,
              });
              dialog.close();
            }
            return results;
          })()`);
          assert.equal(modificationCoverage.length, 4);
          assert(modificationCoverage.every(item => item.open && item.tiles > 0 && item.categories > 0 && item.title && item.rp === '0' && item.sl === '0'));
          assert.equal(new Set(modificationCoverage.map(item => item.title)).size, 4, 'Each sample must load its own vehicle data');
          console.log(JSON.stringify({label:`all-type-modifications-${width}`, samples:modificationCoverage, pass:true}));
          const rafale = await evaluate(`(async () => {
            els.countrySelect.value = 'israel'; els.typeSelect.value = 'aviation'; await loadTree();
            setLanguage('en');
            els.clearButton.click();
            els.searchInput.value = 'rafale'; els.searchInput.dispatchEvent(new Event('input'));
            document.querySelector('[data-unit-id="rafale_eg_greece"]').click();
            await document.fonts.ready;
            const title = document.querySelector('.unit-title');
            const list = document.querySelector('.list-title');
            title.scrollIntoView({block:'center', inline:'center'});
            return {title:title.textContent, tileFont:getComputedStyle(title).fontFamily.includes('WTSymbols'), listFont:getComputedStyle(list).fontFamily.includes('WTSymbols')};
          })()`);
          assert.equal(rafale.title, '\u2584Rafale EG');
          assert(rafale.tileFont && rafale.listFont);
          await pause(500);
          const rafaleImage = await call('Page.captureScreenshot', {format:'png'});
          fs.writeFileSync(path.join(artifacts, `rafale-symbol-${width}.png`), Buffer.from(rafaleImage.data, 'base64'));
          console.log(JSON.stringify({label:`rafale-symbol-${width}`, ...rafale, pass:true}));
        }
      }
    }
    assert.deepEqual(pageErrors, [], 'No browser JavaScript exceptions');
  } finally {
    await send('Browser.close').catch(() => browser.kill());
    if (browser.exitCode === null) await Promise.race([once(browser, 'exit'), pause(3000)]);
    if (browser.exitCode === null) browser.kill();
    for (const entry of pending.values()) clearTimeout(entry.timer);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
