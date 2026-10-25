const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { validateActionsEntry, parseYaml, validateWorkflows, githubJson, validateAdvisories, auditActions } = require('./audit-github-actions.cjs');
const root = path.resolve(__dirname, '..');
const entry = JSON.parse(fs.readFileSync(path.join(root, 'config/dependency-inventory.json'), 'utf8')).entries.find(e => e.kind === 'github-actions');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function fixture() {
  const inventory = structuredClone(entry), files = new Map(entry.files.map(file => [file, read(file)]));
  return { inventory, files, read: file => files.get(file), edit(file, change) {
    const value = parseYaml(files.get(file)); change(value); files.set(file, YAML.stringify(value));
  }, check() { return validateWorkflows(inventory, file => files.get(file)); } };
}
function mockApi(overrides = {}) {
  const calls = [];
  const api = async (endpoint, paginate) => {
    calls.push({ endpoint, paginate });
    if (overrides.api) return overrides.api(endpoint, paginate);
    if (endpoint.startsWith('advisories?')) return overrides.advisories || [[]];
    const commit = endpoint.match(/^repos\/(actions\/[^/]+)\/commits\/(v[\d.]+)$/);
    if (commit) {
      const pin = entry.actions.find(item => item.repository === commit[1] && item.version === commit[2]);
      assert(pin); return { sha: overrides.sha || pin.sha };
    }
    const content = endpoint.match(/^repos\/(actions\/[^/]+)\/contents\/action.yml\?ref=([a-f0-9]+)$/);
    assert(content);
    const pin = entry.actions.find(item => item.repository === content[1] && item.sha === content[2]);
    assert(pin);
    const source = pin.repository === 'actions/upload-pages-artifact'
      ? { runs: { using: 'composite', steps: [{ uses: overrides.nested || 'actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f' }] } }
      : { runs: { using: overrides.runtime || 'node24', main: 'dist/index.js' } };
    const text = YAML.stringify(source);
    return { type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64'), size: text.length };
  };
  return { api, calls };
}

test('six workflows have registered immutable Action refs and least-privilege permissions', () => {
  const result = validateWorkflows(entry, read);
  assert.equal(result.used.size, 7);
  assert.equal(result.pins.size, 8, 'Include the indirect Pages upload version');
});

test('Action coverage cannot be downgraded, duplicate pins and non-exact versions fail', () => {
  for (const mutate of [e => e.coverage = 'tracked-only', e => e.actions[0].sha = 'v7',
    e => e.actions[0].version = 'v7', e => e.actions[0].repository = 'unreviewed/action',
    e => e.actions.push(e.actions[0]), e => e.files = e.files.filter(f => !f.endsWith('dependabot.yml'))]) {
    const clone = structuredClone(entry); mutate(clone); assert.throws(() => validateActionsEntry(clone));
  }
});

test('strict YAML rejects duplicate keys, aliases, unknown tags and non-mappings', () => {
  for (const source of ['jobs: {}\njobs: {}', 'a: &a {x: 1}\nb: *a', 'a: !custom value', '- item', 'value', 'jobs: ['])
    assert.throws(() => parseYaml(source), source);
});

test('tags, unknown actions, dynamic refs, local actions and Docker references are blocked', () => {
  for (const ref of ['actions/checkout@v7', 'actions/new@' + 'a'.repeat(40), 'actions/checkout@${{ env.SHA }}', './action', 'docker://image:latest']) {
    const f = fixture(); f.edit('.github/workflows/security.yml', w => w.jobs.verify.steps[0].uses = ref);
    assert.throws(() => f.check());
  }
});

test('privileged triggers and token escalation cannot pass', () => {
  for (const change of [w => w.on = { pull_request_target: {} }, w => w.on = { workflow_run: {} },
    w => w.permissions = 'write-all', w => w.permissions.contents = 'write',
    w => w.jobs.verify.permissions = { contents: 'read', 'id-token': 'write' },
    w => w.jobs.verify['runs-on'] = 'self-hosted', w => w.jobs.verify.services = { db: {} }]) {
    const f = fixture(); f.edit('.github/workflows/security.yml', change); assert.throws(() => f.check());
  }
});

test('checkout token persistence, unsafe checkout, script interpolation and ignored errors are blocked', () => {
  for (const change of [w => delete w.jobs.verify.steps[0].with, w => w.jobs.verify.steps[0].with['allow-unsafe-pr-checkout'] = true,
    w => w.jobs.verify.steps.push({ run: 'echo "${{ github.event.pull_request.title }}"' }),
    w => w.jobs.verify.steps[0]['continue-on-error'] = true, w => w.jobs.verify['continue-on-error'] = true]) {
    const f = fixture(); f.edit('.github/workflows/security.yml', change); assert.throws(() => f.check());
  }
});

test('Pages write rights remain confined to the main-branch deployment job and environment', () => {
  for (const change of [w => w.permissions.pages = 'write', w => w.on.pull_request = {},
    w => w.on.push.branches = ['*'], w => delete w.jobs.deploy.if, w => delete w.jobs.deploy.needs, w => delete w.jobs.deploy.environment,
    w => w.jobs.deploy.permissions.contents = 'write', w => w.jobs.browser.uses = './.github/workflows/commit-privacy.yml']) {
    const f = fixture(); f.edit('.github/workflows/deploy-pages.yml', change); assert.throws(() => f.check());
  }
});

test('reusable workflows must be registered, same-commit, acyclic and cannot inherit secrets', () => {
  for (const change of [w => w.jobs.browser.uses = './.github/workflows/missing.yml',
    w => w.jobs.browser.uses = './.github/workflows/security.yml',
    w => w.jobs.browser.uses = 'other/project/.github/workflows/test.yml@main',
    w => w.jobs.browser.secrets = 'inherit']) {
    const f = fixture(); f.edit('.github/workflows/security.yml', change); assert.throws(() => f.check());
  }
});

test('Dependabot cannot silently disable or filter Action updates', () => {
  for (const change of [d => d.updates = [], d => d.updates[0].ignore = [{ 'dependency-name': '*' }],
    d => d.updates[0]['open-pull-requests-limit'] = 0, d => d.updates[0].directory = '/wrong']) {
    const f = fixture(); f.edit('.github/dependabot.yml', change); assert.throws(() => f.check());
  }
});

test('live audit traverses pinned composite dependencies and checks reviewed and malware feeds', async () => {
  const { api, calls } = mockApi();
  const results = await auditActions(entry, read, api);
  assert.equal(results.length, 8);
  assert.equal(calls.filter(call => call.endpoint.includes('type=reviewed')).length, 8);
  assert.equal(calls.filter(call => call.endpoint.includes('type=malware')).length, 8);
  assert(calls.filter(call => call.endpoint.startsWith('advisories?')).every(call => call.paginate));
});

test('moved tags, obsolete runtimes, mutable or missing transitive pins and stale inventory fail closed', async () => {
  for (const options of [{ sha: 'f'.repeat(40) }, { runtime: 'node20' }, { nested: 'actions/upload-artifact@v7' },
    { nested: 'actions/upload-artifact@' + 'f'.repeat(40) }]) await assert.rejects(auditActions(entry, read, mockApi(options).api));
  const e = structuredClone(entry); e.actions.push({ repository: 'actions/unused', version: 'v1.0.0', sha: 'f'.repeat(40) });
  await assert.rejects(auditActions(e, read, mockApi().api), /Unused/);
});

test('any active vulnerability blocks, including later pages; only valid withdrawn advisories are ignored', () => {
  const a = { ghsa_id: 'GHSA-aaaa-bbbb-cccc', withdrawn_at: null, vulnerabilities: [{ package: { ecosystem: 'actions', name: 'actions/checkout' } }] };
  validateAdvisories([[]], 'actions/checkout');
  assert.throws(() => validateAdvisories([[], [a]], 'actions/checkout'), /known Action vulnerability/);
  validateAdvisories([[{ ...a, withdrawn_at: '2026-01-01T00:00:00Z' }]], 'actions/checkout');
  for (const result of [[], {}, [null], [[{}]], [[{ ...a, withdrawn_at: true }]]])
    assert.throws(() => validateAdvisories(result, 'actions/checkout'));
});

test('GitHub HTTP errors, timeouts and invalid JSON never become a clean audit or leak CLI output', () => {
  for (const run of [() => { throw Error('SENSITIVE_CLI_OUTPUT'); }, () => 'not json'])
    assert.throws(() => githubJson('advisories?ecosystem=actions', true, run), error => /unavailable/.test(error.message) && !error.message.includes('SENSITIVE'));
  assert.throws(() => githubJson('https://other.invalid'));
  assert.deepEqual(githubJson('advisories?ecosystem=actions', true, (exe, args, options) => {
    assert.equal(exe, 'gh'); assert(args.includes('--paginate') && args.includes('--slurp'));
    assert.equal(options.shell, false); assert(options.timeout); return '[[]]';
  }), [[]]);
});

test('main and release checks keep the unified audit and narrowly scoped read-only API token', () => {
  for (const file of ['.github/workflows/security.yml', '.github/workflows/release.yml']) {
    const workflow = parseYaml(read(file));
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps || []);
    const audit = steps.find(step => step.run?.includes('npm run audit:dependencies'));
    assert(audit); assert.equal(audit.env.GH_TOKEN, '${{ github.token }}');
    assert(!workflow.env?.GH_TOKEN);
  }
});

test('Pages cannot bypass the shared browser Action audit gate', () => {
  for (const change of [w => w.jobs.browser.steps = w.jobs.browser.steps.filter(step => step.run !== 'npm run audit:actions'),
    w => w.jobs.browser.steps.find(step => step.run === 'npm run audit:actions').if = 'false']) {
    const f = fixture(); f.edit('.github/workflows/browser-checks.yml', change); assert.throws(() => f.check());
  }
});
