/** Portable walkthrough v1. This module is safe to import in browsers and native docs tooling. */
export const walkthroughVersion = 1;

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digest = /^[a-f0-9]{64}$/;
const revision = /^[a-f0-9]{40,64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate data and expected source identities; throws an actionable task-qualified error. */
export function validateWalkthrough(bundle, expectedSources) {
  const task = bundle?.task?.id ?? '<unknown task>';
  const fail = message => { throw new Error(`Walkthrough ${task}: ${message}`); };
  const require = (condition, message) => { if (!condition) fail(message); };
  const text = (value, field) => require(typeof value === 'string' && value.trim().length > 0, `${field} must be nonempty text`);
  require(object(bundle), 'expected an object');
  require(bundle.version === walkthroughVersion, `unsupported version ${bundle.version}`);
  require(object(bundle.task), 'missing task');
  require(identifier.test(bundle.task.id), 'invalid task id');
  for (const field of ['scenario', 'title', 'chapter']) text(bundle.task[field], `task.${field}`);
  require(Number.isInteger(bundle.task.order), 'task.order must be an integer');
  require(object(bundle.sources) && Object.keys(bundle.sources).length > 0, 'missing sources');
  for (const [role, source] of Object.entries(bundle.sources)) {
    require(object(source), `invalid source ${role}`);
    for (const field of ['repository', 'url']) {
      require(typeof source[field] === 'string' && /^https?:\/\//.test(source[field]), `source ${role}.${field} must be an HTTP URL`);
    }
    require(revision.test(source.revision), `source ${role} needs a full revision`);
    require(digest.test(source.digest), `source ${role} needs a SHA-256 digest`);
    require(typeof source.dirty === 'boolean', `source ${role} needs dirty state`);
  }
  if (expectedSources !== undefined) {
    require(object(expectedSources) && Object.keys(expectedSources).length > 0, 'missing expected sources');
    require(Object.keys(bundle.sources).sort().join('\0') === Object.keys(expectedSources).sort().join('\0'), 'source roles changed; regenerate');
    for (const [role, expected] of Object.entries(expectedSources)) {
      const actual = bundle.sources[role];
      for (const field of ['repository', 'revision', 'digest', 'dirty']) {
        require(actual[field] === expected[field], `stale source ${role}.${field}; regenerate`);
      }
    }
  }
  const run = bundle.run;
  require(object(run) && run.status === 'completed', 'run is not completed');
  require(['web', 'native'].includes(run.adapter), 'invalid capture adapter');
  for (const field of ['renderer', 'theme']) text(run[field], `run.${field}`);
  require(object(run.viewport), 'missing viewport');
  for (const field of ['width', 'height']) require(Number.isInteger(run.viewport[field]) && run.viewport[field] > 0, `invalid viewport ${field}`);
  require(Number.isFinite(run.scale) && run.scale > 0, 'invalid scale');
  require(Array.isArray(run.required) && run.required.length > 0, 'missing required checkpoints');
  require(Array.isArray(bundle.steps) && bundle.steps.length > 0, 'missing screenshots');
  const ids = new Set();
  for (const step of bundle.steps) {
    require(object(step), 'invalid step');
    require(identifier.test(step.id) && !ids.has(step.id), `invalid or duplicate step ${step.id}`);
    ids.add(step.id);
    for (const field of ['caption', 'alt']) text(step[field], `${step.id}.${field}`);
    require(typeof step.image === 'string' && /^[a-zA-Z0-9_/-]+\.png$/.test(step.image) && !step.image.startsWith('/') && step.image.split('/').every(part => part && part !== '.' && part !== '..'), `invalid image path for ${step.id}`);
    require(digest.test(step.digest), `invalid image digest for ${step.id}`);
    for (const field of ['width', 'height']) require(Number.isInteger(step[field]) && step[field] > 0, `invalid image ${field} for ${step.id}`);
    require(step.callouts === undefined || Array.isArray(step.callouts), `invalid callouts for ${step.id}`);
    const numbers = new Set();
    for (const callout of step.callouts ?? []) {
      require(object(callout), `invalid callout for ${step.id}`);
      require(Number.isInteger(callout.number) && callout.number > 0 && !numbers.has(callout.number), `duplicate or invalid callout number for ${step.id}`);
      numbers.add(callout.number);
      text(callout.text, `${step.id} callout text`);
      const r = callout.rect;
      require(Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && r[0] >= 0 && r[1] >= 0 && r[2] > 0 && r[3] > 0 && r[0] + r[2] <= 1 && r[1] + r[3] <= 1, `invalid callout geometry for ${step.id}`);
    }
  }
  require(run.required.length === ids.size && run.required.every((id, i) => id === bundle.steps[i].id), 'required checkpoints differ from ordered captures');
  return bundle;
}

/** Check a collection as well as each bundle, preventing duplicate task routes. */
export function validateWalkthroughs(bundles) {
  const ids = new Set();
  for (const bundle of bundles) {
    validateWalkthrough(bundle);
    if (ids.has(bundle.task.id)) throw new Error(`Walkthrough ${bundle.task.id}: duplicate task identity`);
    ids.add(bundle.task.id);
  }
  return bundles;
}
