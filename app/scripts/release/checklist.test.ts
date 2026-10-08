// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checklistItems, deviceTypes, readPlan, sectionOf } from './checklist-doc.ts';
import {
  MANUAL_ITEMS,
  entryProblem,
  readSignoff,
  signoffPath,
  signoffTemplate,
  type Entry,
  type Signoff,
} from './checklist-signoff.ts';
import {
  CHECKS,
  evaluate,
  markdownReport,
  textReport,
  unusedChecks,
  verdict,
  type Context,
  type Env,
  type Result,
} from './checklist.ts';
import { fakePe, newTestKey, writeSampleRelease } from './test-support.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opennote-checklist-'));
  dirs.push(dir);
  return dir;
}

const TYPES = ['Reference laptop', 'Pen tablet PC', 'Drawing tablet'];
const DAY = '2026-10-20';
const entry = (extra: Partial<Entry> = {}): Entry => ({ by: 'Eric', date: DAY, ...extra });
const pen = entry({
  devices: [
    { type: 'Pen tablet PC', name: 'Surface Laptop Studio 2' },
    { type: 'Drawing tablet', name: 'Wacom Intuos' },
  ],
});
const fullSignoff = (): Signoff => ({
  version: '1.0.0',
  items: {
    budgets: entry(),
    accessibility: entry(),
    pen,
    upgrade: entry(),
    format: entry(),
    updates: entry(),
    docs: entry(),
  },
});

describe('the checklist in the development plan', () => {
  const plan = readPlan(ROOT);
  const items = checklistItems(plan);

  it('is read from section 10', () => {
    expect(items.length).toBeGreaterThanOrEqual(11);
    expect(items[0]).toBe('npm run checks:all passes with no errors.');
  });

  it('has a check for every item, and no check for an item that is gone', () => {
    const unchecked = items.filter((item) => !CHECKS.some((check) => check.match.test(item)));
    expect(unchecked).toEqual([]);
    expect(unusedChecks(items)).toEqual([]);
  });

  it('gives each item one check, so no two checks answer the same item', () => {
    for (const item of items)
      expect(
        CHECKS.filter((check) => check.match.test(item)),
        item,
      ).toHaveLength(1);
  });

  it('lists the device types of the test matrix', () => {
    expect(deviceTypes(plan)).toEqual(expect.arrayContaining(['Reference laptop', 'Pen tablet PC', 'Drawing tablet']));
  });

  it('stops when a section is missing', () => {
    expect(() => sectionOf('## 1. Intro\n', '10. Release checklist')).toThrow('no section titled');
  });
});

describe('sign-off entries', () => {
  const problem = (value: Entry | undefined, item: (typeof MANUAL_ITEMS)[number] = 'budgets') =>
    entryProblem(item, value, DAY, TYPES);

  it('count with a name and a real date that is not in the future', () => {
    expect(problem(entry())).toBeUndefined();
    expect(problem(entry({ date: '2026-10-19' }))).toBeUndefined();
  });

  it('do not count when empty, undated, misdated, or from the future', () => {
    expect(problem(undefined)).toBe('No one has signed this off.');
    expect(problem(entry({ by: ' ' }))).toBe('No one has signed this off.');
    expect(problem(entry({ date: '' }))).toContain('YYYY-MM-DD');
    expect(problem(entry({ date: '2026-02-31' }))).toContain('YYYY-MM-DD');
    expect(problem(entry({ date: '20/10/2026' }))).toContain('YYYY-MM-DD');
    expect(problem(entry({ date: '2026-10-21' }))).toBe('The sign-off date 2026-10-21 is in the future.');
  });

  it('need two different devices from the matrix for pen testing', () => {
    expect(problem(pen, 'pen')).toBeUndefined();
    expect(problem(entry(), 'pen')).toBe('Pen testing needs at least two different devices.');
    const same = entry({ devices: [pen.devices![0], { ...pen.devices![0] }] });
    expect(problem(same, 'pen')).toBe('Pen testing needs at least two different devices.');
    const odd = entry({ devices: [pen.devices![0], { type: 'Toaster', name: 'Bread' }] });
    expect(problem(odd, 'pen')).toBe('"Toaster" is not a device type in the device test matrix.');
  });

  it('start blank in a template, which fails until a person fills it in', () => {
    const template = signoffTemplate('1.0.0');
    expect(Object.keys(template.items)).toEqual([...MANUAL_ITEMS]);
    for (const item of MANUAL_ITEMS) expect(problem(template.items[item], item), item).toBeDefined();
  });

  it('are read from docs/releases, and a missing file is an empty sign-off', () => {
    const root = folder();
    expect(readSignoff(root, '1.0.0')).toEqual({ version: '1.0.0', items: {} });
    mkdirSync(join(root, 'docs', 'releases'), { recursive: true });
    writeFileSync(join(root, signoffPath('1.0.0')), JSON.stringify(fullSignoff()));
    expect(readSignoff(root, '1.0.0').items.pen?.devices).toHaveLength(2);
  });
});

/** An environment with answers set by the test. */
function env(
  root: string,
  answers: { checks?: boolean; ci?: string; nightly?: string; issues?: Record<string, string> } = {},
): Env {
  const { checks = true, ci = '[{"conclusion":"success"}]', nightly = '[{"conclusion":"success"}]' } = answers;
  return {
    root,
    run: (command, args) => {
      if (command === 'git' && args[0] === 'rev-parse') return { ok: true, output: 'abcdef1234567\n' };
      if (command === 'git') return { ok: true, output: '' };
      return { ok: checks, output: checks ? '' : 'one\ntwo\n3 errors' };
    },
    gh: (args) => {
      if (args[0] === 'issue') return answers.issues?.[args[args.indexOf('--label') + 1]] ?? '[]';
      return args.includes('ci.yml') ? ci : nightly;
    },
    today: () => DAY,
  };
}

function context(root: string, overrides: Partial<Context> = {}, answers: Parameters<typeof env>[1] = {}): Context {
  return {
    env: env(root, answers),
    version: '1.0.0',
    tag: 'v1.0.0',
    signoff: fullSignoff(),
    deviceTypes: TYPES,
    keys: [],
    windowsStatus: () => 'Valid',
    ...overrides,
  };
}

/** A repository root with a changelog, and a folder of signed release files for the signing check. */
function repository(changelog = '## [1.0.0] - 2026-10-20\n\n- Everything.\n') {
  const root = folder();
  writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  const key = newTestKey();
  const signed = (file: string) => Buffer.concat([fakePe({ signed: true }), Buffer.from(file)]);
  const artifacts = folder();
  writeSampleRelease(artifacts, 'v1.0.0', key, { exe: signed });
  return { root, key, artifacts };
}

const items = checklistItems(readPlan(ROOT));
const byId = (results: Result[], id: string) => results.find((result) => result.id === id) as Result;

describe('evaluate', () => {
  it('passes every item when everything is checked and signed off', () => {
    const { root, key, artifacts } = repository();
    const results = evaluate(items, context(root, { artifacts, keys: [key.publicKey] }));
    expect(results.map((result) => `${result.id}: ${result.status}`)).toEqual(
      CHECKS.map((check) => `${check.id}: pass`),
    );
    expect(verdict(results, true)).toBe(true);
  });

  it('shows what is left when nothing has been signed off and nothing can be looked up', () => {
    const { root } = repository();
    const bare: Env = { ...env(root), gh: () => undefined };
    const results = evaluate(items, context(root, { env: bare, signoff: { version: '1.0.0', items: {} } }));
    const status = (id: string) => byId(results, id).status;
    expect(['tests', 'issues', 'signing'].map(status)).toEqual(['pending', 'pending', 'pending']);
    expect(['budgets', 'accessibility', 'pen', 'upgrade', 'format', 'updates', 'docs'].map(status)).toEqual(
      Array(7).fill('manual'),
    );
    expect(byId(results, 'budgets').detail).toContain('docs/releases/1.0.0.signoff.json');
    expect(verdict(results, false)).toBe(false);
  });

  it('fails CHECKS errors, and says what they were', () => {
    const { root } = repository();
    const result = byId(evaluate(items, context(root, {}, { checks: false })), 'checks');
    expect(result).toMatchObject({ status: 'fail', detail: 'one two 3 errors' });
  });

  it('fails when CI or the nightly run did not pass', () => {
    const { root } = repository();
    const noCi = byId(evaluate(items, context(root, {}, { ci: '[]' })), 'tests');
    expect(noCi).toMatchObject({ status: 'fail', detail: 'CI has no passing run for commit abcdef1.' });
    const badNightly = byId(evaluate(items, context(root, {}, { nightly: '[{"conclusion":"failure"}]' })), 'tests');
    expect(badNightly.detail).toBe('The latest nightly run on main did not pass.');
  });

  it('fails on an open issue labeled data-loss, crash, or security', () => {
    const { root } = repository();
    const issues = { crash: '[{"number":4},{"number":9}]', security: '[{"number":2}]' };
    const result = byId(evaluate(items, context(root, {}, { issues })), 'issues');
    expect(result).toMatchObject({ status: 'fail', detail: 'Open issues: 2 labeled crash, 1 labeled security.' });
  });

  it('fails when the exes are not signed, or signed for another version', () => {
    const { root, key, artifacts } = repository();
    const unsigned = folder();
    writeSampleRelease(unsigned, 'v1.0.0', key);
    const notSigned = byId(evaluate(items, context(root, { artifacts: unsigned, keys: [key.publicKey] })), 'signing');
    expect(notSigned.status).toBe('fail');
    expect(notSigned.detail).toContain('no Authenticode signature');
    const otherKey = byId(evaluate(items, context(root, { artifacts, keys: [newTestKey().publicKey] })), 'signing');
    expect(otherKey.detail).toContain('not signed with a key that this release trusts');
  });

  it('fails when the changelog has no entry for the version, even if the docs are signed off', () => {
    const { root } = repository('## [Unreleased]\n\n- Soon.\n');
    expect(byId(evaluate(items, context(root)), 'docs')).toMatchObject({
      status: 'fail',
      detail: 'CHANGELOG.md has no entry with notes for 1.0.0.',
    });
  });

  it('fails an item that has no check, so a new item in the plan cannot slip through', () => {
    const { root } = repository();
    const [result] = evaluate(['The moon is full.'], context(root));
    expect(result).toMatchObject({ id: 'unknown', status: 'fail' });
  });
});

describe('reports', () => {
  const results: Result[] = [
    { item: 'A thing passes.', id: 'a', status: 'pass', detail: 'Fine.' },
    { item: 'Another needs a person.', id: 'b', status: 'manual', detail: 'Sign it.' },
    { item: 'One cannot be told.', id: 'c', status: 'pending', detail: 'Needs gh.' },
  ];

  it('write a line for each item in text and a row for each in Markdown', () => {
    expect(textReport(results)).toContain('Needs sign-off Another needs a person.');
    const table = markdownReport(results, '1.0.0');
    expect(table).toContain('## Release checklist for 1.0.0');
    expect(table).toContain('| Not checked | One cannot be told. | Needs gh. |');
  });

  it('allows a pending item unless everything is required', () => {
    const passing = [results[0], results[2]];
    expect(verdict(passing, false)).toBe(true);
    expect(verdict(passing, true)).toBe(false);
    expect(verdict(results, false)).toBe(false);
  });
});
