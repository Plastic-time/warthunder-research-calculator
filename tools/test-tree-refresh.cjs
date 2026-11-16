const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const elements = new Map();
  const context = vm.createContext({
    document: { getElementById: id => {
      if (!elements.has(id)) elements.set(id, {});
      return elements.get(id);
    }, addEventListener() {} },
    window: { WTI18n: { locale: 'en', t: text => text, number: String },
      matchMedia: () => ({ matches: false }), ResearchProgress: require('../public/research-progress'),
      PlanStorage: { read: () => ({ planned: ['saved-target'], progressRp: { 'saved-target': 100 } }) } },
    console,
  });
  const code = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8').replace(/\binit\(\);\s*$/, '');
  vm.runInContext(code + `
    refreshTreeSelectionButton = () => {};
    closeUnitContextMenu = () => {};
    discardBulkOwnedUndo = () => {};
    renderSummary = renderTree = () => {};
    calculatePlan = () => {};
    globalThis.fixture = { state, els, refreshCurrentTree, loadTree,
      setApi: fn => { api = fn; } };
  `, context);
  const fixture = context.fixture;
  const session = deferred(), update = deferred(), started = deferred();
  const requests = [];
  fixture.setApi(url => {
    requests.push(url);
    if (url === '/api/session') return session.promise;
    if (url.startsWith('/api/update/')) { started.resolve(); return update.promise; }
    return Promise.resolve({ data: [{ rank: url, researchable_vehicles: [] }] });
  });
  const select = async country => {
    fixture.els.countrySelect.value = country;
    fixture.els.typeSelect.value = 'ground';
    await fixture.loadTree();
    assert.equal(fixture.state.treeLoadError, false);
    assert.equal(fixture.state.tree[0].rank, `/api/tree/${country}/ground`);
  };
  return { ...fixture, session, update, started, requests, select };
}

test('a slow refresh cannot replace another country or its saved plan', async () => {
  const f = setup();
  await f.select('usa');
  const pending = f.refreshCurrentTree();
  f.session.resolve({ token: 'fixture' });
  await f.started.promise;
  await f.select('germany');
  const tree = f.state.tree;
  f.update.resolve({ data: [{ rank: 'old USA result' }] });
  await pending;
  assert.strictEqual(f.state.tree, tree);
  assert.equal(f.state.country, 'germany');
  assert.deepEqual([...f.state.planned], ['saved-target']);
  assert.equal(f.state.progressRp['saved-target'], 100);
  assert.equal(f.els.refreshDataButton.disabled, false);
});

test('switching while session loads cannot update the newly selected country', async () => {
  const f = setup();
  await f.select('usa');
  const pending = f.refreshCurrentTree();
  await f.select('germany');
  f.update.resolve({ data: [] });
  f.session.resolve({ token: 'fixture' });
  await pending;
  assert.equal(f.requests.some(url => url.startsWith('/api/update/')), false);
});

test('an old refresh error cannot replace the new tree status', async () => {
  const f = setup();
  await f.select('usa');
  const pending = f.refreshCurrentTree();
  f.session.resolve({ token: 'fixture' });
  await f.started.promise;
  await f.select('germany');
  const status = f.els.statusText.textContent;
  f.update.reject(new Error('old update failure'));
  await pending;
  assert.equal(f.els.statusText.textContent, status);
});

test('switching away and back still invalidates the old refresh', async () => {
  const f = setup();
  await f.select('usa');
  const pending = f.refreshCurrentTree();
  f.session.resolve({ token: 'fixture' });
  await f.started.promise;
  await f.select('germany');
  await f.select('usa');
  const tree = f.state.tree;
  f.update.resolve({ data: [{ rank: 'old USA result' }] });
  await pending;
  assert.strictEqual(f.state.tree, tree);
});

test('a current refresh still applies and releases its button', async () => {
  const f = setup();
  await f.select('usa');
  const pending = f.refreshCurrentTree();
  f.session.resolve({ token: 'fixture' });
  await f.started.promise;
  const data = [{ rank: 'updated', researchable_vehicles: [] }];
  f.update.resolve({ data });
  await pending;
  assert.strictEqual(f.state.tree, data);
  assert(f.requests.includes('/api/update/usa/ground'));
  assert.equal(f.els.refreshDataButton.disabled, false);
});

test('a current refresh failure remains visible and releases its button', async () => {
  const f = setup();
  await f.select('usa');
  const pending = f.refreshCurrentTree();
  f.session.reject(new Error('session unavailable'));
  await pending;
  assert.equal(f.els.statusText.textContent, 'session unavailable');
  assert.equal(f.els.refreshDataButton.disabled, false);
});
