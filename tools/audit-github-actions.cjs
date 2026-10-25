const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const shaPattern = /^[a-f0-9]{40}$/;
const repositoryPattern = /^actions\/[a-z0-9-]+$/;
const workflowPattern = /^\.github\/workflows\/[a-z0-9-]+\.ya?ml$/;

function validateActionsEntry(entry) {
  assert.equal(entry.coverage, 'github-actions-audit', 'GitHub Actions cannot skip auditing');
  assert(entry.files.includes('.github/dependabot.yml'), 'Register the Dependabot configuration');
  assert(entry.files.every(file => workflowPattern.test(file) || file === '.github/dependabot.yml'), 'Unsupported Action entry point');
  assert(Array.isArray(entry.actions) && entry.actions.length, 'Action pins are required');
  const keys = new Set();
  for (const action of entry.actions) {
    assert(repositoryPattern.test(action.repository), 'Only reviewed official actions repositories are supported');
    assert(/^v\d+\.\d+\.\d+$/.test(action.version), 'Record an exact stable Action version');
    assert(shaPattern.test(action.sha), 'Pin a full Action commit SHA');
    const key = `${action.repository}@${action.sha}`;
    assert(!keys.has(key), 'Duplicate Action pin'); keys.add(key);
  }
  return entry;
}

function parseYaml(text) {
  const YAML = require('yaml');
  const doc = YAML.parseDocument(text, { version: '1.2', uniqueKeys: true, merge: false });
  assert(!doc.errors.length && !doc.warnings.length, 'Invalid or ambiguous YAML');
  YAML.visit(doc, { Alias() { throw Error('YAML aliases are not supported in security policy'); } });
  const value = doc.toJS({ maxAliasCount: 0 });
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected a YAML mapping');
  return value;
}

function remoteRef(value, pins) {
  assert(typeof value === 'string' && /^actions\/[a-z0-9-]+@[a-f0-9]{40}$/.test(value), 'Require a literal full-SHA official Action reference');
  assert(pins.has(value), `Unregistered Action: ${value}`);
  return value;
}

function checkPermissions(permissions, deployment = false) {
  assert(permissions && typeof permissions === 'object' && !Array.isArray(permissions), 'Explicit least-privilege permissions are required');
  const expected = deployment ? { contents: 'read', pages: 'write', 'id-token': 'write' } : { contents: 'read' };
  assert.deepEqual(permissions, expected, 'Unexpected workflow token permissions');
}

function validateWorkflows(entry, readFile) {
  validateActionsEntry(entry);
  const pins = new Map(entry.actions.map(item => [`${item.repository}@${item.sha}`, item]));
  const used = new Set(), edges = new Map();
  for (const file of entry.files.filter(file => workflowPattern.test(file))) {
    const workflow = parseYaml(readFile(file));
    checkPermissions(workflow.permissions);
    const triggers = typeof workflow.on === 'string' ? [workflow.on] : Array.isArray(workflow.on) ? workflow.on : Object.keys(workflow.on || {});
    assert(triggers.length && triggers.every(name => ['push', 'pull_request', 'workflow_dispatch', 'workflow_call'].includes(name)), 'Unreviewed or privileged workflow trigger');
    assert(workflow.jobs && Object.keys(workflow.jobs).length, 'Workflow jobs are required');
    const local = []; edges.set(file, local);
    for (const [id, job] of Object.entries(workflow.jobs)) {
      assert(!job['continue-on-error'] && !job.secrets, 'Jobs cannot hide failures or inherit secrets');
      const deployment = file === '.github/workflows/deploy-pages.yml' && id === 'deploy';
      if (job.permissions || deployment) checkPermissions(job.permissions, deployment);
      if (deployment) {
        assert.deepEqual(triggers.sort(), ['push', 'workflow_dispatch'], 'Deployment must not run on pull requests');
        assert.deepEqual(workflow.on.push?.branches, ['main'], 'Deployment must be restricted to main');
        assert.equal(job.if, "github.ref == 'refs/heads/main'", 'Manual deployment must also be restricted to main');
        assert.equal(job.needs, 'browser', 'Deployment must wait for the audited browser workflow');
        assert.equal(workflow.jobs.browser?.uses, './.github/workflows/browser-checks.yml', 'Pages must use the audited browser workflow');
        assert(!workflow.jobs.browser.if, 'Pages audit dependency cannot be skipped');
        assert.equal(job.environment?.name, 'github-pages', 'Use the Pages deployment environment');
      }
      if (job.uses) {
        assert(typeof job.uses === 'string' && job.uses.startsWith('./') && entry.files.includes(job.uses.slice(2))
          && workflowPattern.test(job.uses.slice(2)), 'Only registered same-commit reusable workflows are supported');
        assert(!job.steps, 'Reusable workflow job cannot contain steps');
        local.push(job.uses.slice(2));
        continue;
      }
      assert(['ubuntu-latest', 'windows-latest'].includes(job['runs-on']), 'Only reviewed GitHub-hosted runners are supported');
      assert(!job.container && !job.services, 'Container dependencies require separate audit support');
      assert(Array.isArray(job.steps) && job.steps.length, 'Job steps are required');
      for (const step of job.steps) {
        assert(!step['continue-on-error'], 'Security failures must not be ignored');
        assert(!(step.run && step.uses), 'A step cannot run both a script and an Action');
        if (step.run) assert(typeof step.run === 'string' && !step.run.includes('${{'), 'Bind expressions through env instead of interpolating shell scripts');
        if (!step.uses) continue;
        const ref = remoteRef(step.uses, pins); used.add(ref);
        if (ref.startsWith('actions/checkout@')) {
          assert.equal(step.with?.['persist-credentials'], false, 'Checkout must not persist credentials');
          assert(!step.with?.['allow-unsafe-pr-checkout'], 'Unsafe PR checkout is forbidden');
        }
      }
    }
  }
  function visit(file, stack = new Set()) {
    assert(!stack.has(file), 'Cyclic reusable workflow dependency');
    for (const dependency of edges.get(file) || []) visit(dependency, new Set([...stack, file]));
  }
  for (const file of edges.keys()) visit(file);
  const browser = parseYaml(readFile('.github/workflows/browser-checks.yml'));
  const steps = browser.jobs?.browser?.steps;
  assert(Array.isArray(steps), 'Missing shared browser audit gate');
  const gate = steps.findIndex(step => step.run === 'npm run audit:actions');
  assert(gate >= 0 && gate < steps.findIndex(step => step.run === 'npm run test:browser')
    && steps[gate].env?.GH_TOKEN === '${{ github.token }}' && !steps[gate].if, 'Browser/Pages audit gate cannot be skipped');
  const dependabot = parseYaml(readFile('.github/dependabot.yml'));
  assert.equal(dependabot.version, 2, 'Expected Dependabot v2');
  const updates = dependabot.updates?.filter(item => item['package-ecosystem'] === 'github-actions');
  assert(updates?.length === 1 && updates[0].directory === '/' && updates[0].schedule?.interval === 'weekly'
    && !updates[0].ignore?.length && updates[0]['open-pull-requests-limit'] > 0, 'Enable weekly, unfiltered Action updates');
  return { pins, used };
}

function githubJson(endpoint, paginate = false, run = execFileSync) {
  assert(typeof endpoint === 'string' && (endpoint.startsWith('repos/actions/') || endpoint.startsWith('advisories?'))
    && !endpoint.includes('..') && !/[\r\n]/.test(endpoint), 'Unexpected GitHub audit endpoint');
  const args = ['api', endpoint, '--hostname', 'github.com'];
  if (paginate) args.push('--paginate', '--slurp');
  try {
    return JSON.parse(run('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
      shell: false, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    // Do not echo CLI output, headers, tokens or environment values on failures.
    throw Error('GitHub Action audit unavailable or invalid response: ' + endpoint.split('?')[0]);
  }
}

function validateAdvisories(pages, repository) {
  assert(Array.isArray(pages) && pages.length && pages.every(Array.isArray), 'Missing or malformed GitHub advisory pages');
  for (const advisory of pages.flat()) {
    assert(advisory && /^GHSA-[a-z0-9-]+$/.test(advisory.ghsa_id) && Array.isArray(advisory.vulnerabilities), 'Malformed Action advisory');
    assert(advisory.vulnerabilities.some(item => item.package?.ecosystem === 'actions' && item.package.name === repository), 'Unexpected advisory package');
    assert(typeof advisory.withdrawn_at === 'string' && Number.isFinite(Date.parse(advisory.withdrawn_at)),
      `${repository}: known Action vulnerability ${advisory.ghsa_id}`);
  }
}

async function auditActions(entry, readFile, api = githubJson) {
  const { pins, used } = validateWorkflows(entry, readFile);
  const checked = new Set(), active = new Set(), results = [];
  async function visit(ref) {
    assert(!active.has(ref), 'Cyclic composite Action dependency');
    if (checked.has(ref)) return;
    const action = pins.get(ref);
    assert(action, `Unregistered transitive Action: ${ref}`);
    active.add(ref);
    const commit = await api(`repos/${action.repository}/commits/${action.version}`);
    assert.equal(commit.sha, action.sha, `${action.repository}: release tag moved or pin/version mismatch`);
    const source = await api(`repos/${action.repository}/contents/action.yml?ref=${action.sha}`);
    assert(source.type === 'file' && source.encoding === 'base64' && typeof source.content === 'string' && source.size <= 256 * 1024, 'Missing or oversized Action metadata');
    const bytes = Buffer.from(source.content, 'base64');
    assert(bytes.length <= 256 * 1024, 'Oversized Action metadata');
    const metadata = parseYaml(bytes.toString('utf8'));
    assert(['node24', 'composite'].includes(metadata.runs?.using), 'Unsupported or obsolete Action runtime');
    if (metadata.runs.using === 'composite') {
      assert(Array.isArray(metadata.runs.steps) && metadata.runs.steps.length, 'Missing composite steps');
      for (const step of metadata.runs.steps) if (step.uses) await visit(remoteRef(step.uses, pins));
    }
    for (const type of ['reviewed', 'malware']) {
      const endpoint = `advisories?ecosystem=actions&type=${type}&affects=${encodeURIComponent(action.repository + '@' + action.version.slice(1))}&per_page=100`;
      validateAdvisories(await api(endpoint, true), action.repository);
    }
    checked.add(ref); active.delete(ref);
    results.push({ ...action, runtime: metadata.runs.using, knownVulnerabilities: 0 });
  }
  for (const ref of used) await visit(ref);
  assert.equal(checked.size, pins.size, 'Unused Action inventory pin; remove stale entries');
  console.log(JSON.stringify({ actionsAuditPassed: true, checkedAt: new Date().toISOString(), results }));
  return results;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  try {
    const entry = JSON.parse(fs.readFileSync(path.join(root, 'config/dependency-inventory.json'), 'utf8')).entries.find(item => item.kind === 'github-actions');
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');
    const args = process.argv.slice(2);
    assert(args.length === 1 && ['--check', '--audit'].includes(args[0]), 'Use --check or --audit');
    if (args[0] === '--check') { validateWorkflows(entry, read); console.log('Action workflow policy passed.'); }
    else auditActions(entry, read).catch(error => { console.error(error.message); process.exitCode = 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { validateActionsEntry, parseYaml, remoteRef, checkPermissions, validateWorkflows, githubJson, validateAdvisories, auditActions };
