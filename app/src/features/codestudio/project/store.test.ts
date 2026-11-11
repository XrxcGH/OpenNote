// The project store: per-file merge patches after typing pauses, undoable file changes, the limits, and
// minEditor. The page side is the memory page service, which merges patches as the core does (RFC 7396).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMergePatch } from '../../../platform/mergePatch';
import { CONTRACT_PAGE } from '../../../services/pages/contract';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { NewBlock } from '../../../services/pages/types';
import { CODE_PROJECT_TYPE, CODE_PROJECT_VERSION, PROJECT_LIMITS } from '../contracts';
import { projectFallback } from './fallback';
import { readProject, starterProject } from './model';
import { TYPING_DELAY_MS, createProjectStore } from './store';

const BLOCK = '01k6proj0000000000000000b1';

function twoFiles(): Record<string, unknown> {
  const project = starterProject('Two sum', 'print(1)\n');
  project.files.f02 = { path: 'data/input.txt', text: '2 7 11 15\n', order: 1 };
  return project as unknown as Record<string, unknown>;
}

/** A store whose patches are recorded, applied to `data` as the core would. */
function recorded(data: Record<string, unknown> = twoFiles(), readOnly = false) {
  const sent: { data: Record<string, unknown>; fallback: string }[] = [];
  const store = createProjectStore({
    data,
    readOnly,
    patch: (patch, fallback) => sent.push({ data: patch, fallback }),
  });
  return { store, sent };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('project store typing', () => {
  it('sends a patch of the one file 400 ms after typing stops', () => {
    const { store, sent } = recorded();
    store.editFile('f01', 'p');
    vi.advanceTimersByTime(TYPING_DELAY_MS - 1);
    store.editFile('f01', 'print(2)\n');
    vi.advanceTimersByTime(TYPING_DELAY_MS - 1);
    expect(sent).toHaveLength(0);
    expect(store.project().files.f01.text).toBe('print(2)\n');
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].data).toEqual({ files: { f01: { text: 'print(2)\n' } } });
    expect(sent[0].fallback).toBe(projectFallback(store.project()));
    expect(sent[0].fallback).toContain('print(2)');
  });
});

describe('project store merge patches', () => {
  it('merges one file into the page and leaves the other files untouched', async () => {
    const service = createMemoryPageService([{ page: CONTRACT_PAGE }]);
    const page = await service.open(CONTRACT_PAGE.id, { viewport: null });
    const data = twoFiles();
    const block: NewBlock = { id: BLOCK, type: CODE_PROJECT_TYPE, data, fallback: { markdown: 'Two sum' } };
    await page.send({ edits: [{ edit: 'insertBlock', block }] });
    const sends: Promise<unknown>[] = [];
    const store = createProjectStore({
      data,
      patch: (patch, fallback) =>
        sends.push(
          page.send({ edits: [{ edit: 'patchBlock', block: BLOCK, data: patch, fallback: { markdown: fallback } }] }),
        ),
    });
    store.editFile('f01', 'print(42)\n');
    store.flush();
    await Promise.all(sends);
    await page.close();
    const again = await service.open(CONTRACT_PAGE.id, { viewport: null });
    const stored = again.initial.blocks.find((candidate) => candidate.id === BLOCK)!;
    const before = readProject(data);
    const after = readProject(stored.data);
    expect(after.files.f01).toEqual({ ...before.files.f01, text: 'print(42)\n' });
    expect(after.files.f02).toEqual(before.files.f02);
    expect(after.name).toBe('Two sum');
    expect(stored.fallback?.markdown).toContain('print(42)');
    await again.close();
  });

  it('would lose the other files with an array model, which is why files are keyed by ID', () => {
    // The same one-file edit against files stored as an array: a merge patch replaces an array whole (RFC 7396).
    const asArray = {
      files: [
        { path: 'main.py', text: 'print(1)\n' },
        { path: 'data/input.txt', text: '2\n' },
      ],
    };
    const patched = applyMergePatch(asArray, { files: [{ path: 'main.py', text: 'print(42)\n' }] });
    expect(patched.files).toHaveLength(1);
  });
});

describe('project store file changes', () => {
  it('makes new file, rename, move, and delete one patch each, so one undo takes each back', async () => {
    const service = createMemoryPageService([{ page: CONTRACT_PAGE }]);
    const page = await service.open(CONTRACT_PAGE.id, { viewport: null });
    const data = twoFiles();
    await page.send({
      edits: [
        { edit: 'insertBlock', block: { id: BLOCK, type: CODE_PROJECT_TYPE, data, fallback: { markdown: 'x' } } },
      ],
    });
    let chain = Promise.resolve();
    const store = createProjectStore({
      data,
      patch: (patch) => {
        chain = chain.then(async () => {
          await page.send({ edits: [{ edit: 'patchBlock', block: BLOCK, data: patch }] });
        });
      },
    });
    const made = store.newFile('src/util.py', 'X = 1\n');
    expect(made).toEqual({ ok: true, value: 'f03' });
    expect(store.renameFile('f03', 'src/helpers.py').ok).toBe(true);
    expect(store.moveFile('f03', 'lib').ok).toBe(true);
    expect(store.project().files.f03.path).toBe('lib/helpers.py');
    expect(store.deleteFile('f02').ok).toBe(true);
    await chain;
    const files = async () => {
      const frame = await page.undo();
      return frame;
    };
    // Four steps, undone one at a time: delete, move, rename, new file.
    for (let i = 0; i < 4; i++) expect(await files()).not.toBeNull();
    await page.close();
    const again = await service.open(CONTRACT_PAGE.id, { viewport: null });
    const stored = readProject(again.initial.blocks.find((candidate) => candidate.id === BLOCK)!.data);
    expect(Object.keys(stored.files).sort()).toEqual(['f01', 'f02']);
    await again.close();
  });

  it('sends waiting text before a file change, as a step of its own', () => {
    const { store, sent } = recorded();
    store.editFile('f01', 'print(3)\n');
    store.newFile('b.py');
    expect(sent.map((one) => one.data)).toEqual([
      { files: { f01: { text: 'print(3)\n' } } },
      { files: { f03: { path: 'b.py', text: '', order: 2 } } },
    ]);
  });

  it('refuses bad paths, reserved export names, and the last file', () => {
    const { store, sent } = recorded();
    expect(store.newFile('../x.py')).toMatchObject({ ok: false, code: 'path.dotSegment' });
    expect(store.newFile('MAIN.PY')).toMatchObject({ ok: false, code: 'path.duplicate' });
    expect(store.renameFile('f02', 'CON.txt')).toMatchObject({ ok: false, code: 'path.reserved' });
    const reserved = store.newFile('opennote-project.json');
    expect(reserved).toMatchObject({ ok: false, code: 'reservedName' });
    expect(!reserved.ok && reserved.message).toContain('opennote-project.json');
    expect(store.renameFile('f09', 'a.py')).toMatchObject({ ok: false, code: 'noFile' });
    expect(store.deleteFile('f02').ok).toBe(true);
    expect(store.deleteFile('f01')).toMatchObject({ ok: false, code: 'lastFile' });
    expect(sent).toHaveLength(1);
  });

  it('moves the main file to the next one when the main file is deleted', () => {
    const { store, sent } = recorded();
    store.deleteFile('f01');
    expect(sent[0].data).toEqual({ files: { f01: null }, main: 'f02' });
    expect(store.project().main).toBe('f02');
  });
});

describe('project store limits', () => {
  it('refuses a file over 1 MiB, a project over 4 MiB, a 201st file, and a 501st test, with the reason', () => {
    const { store } = recorded();
    const big = store.editFile('f01', 'x'.repeat(PROJECT_LIMITS.fileBytes + 1));
    expect(big).toMatchObject({ ok: false, code: 'fileTooBig' });
    expect(!big.ok && big.message).toBe('main.py is larger than 1 MiB. Split it into smaller files.');
    expect(store.editFile('f01', 'é'.repeat(PROJECT_LIMITS.fileBytes / 2)).ok).toBe(true);

    const full = twoFiles();
    // Four files one byte under 1 MiB and an empty fifth: 4 MiB less 4 bytes in all.
    const almost = 'x'.repeat(PROJECT_LIMITS.fileBytes - 1);
    full.files = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`f0${i + 1}`, { path: `m${i}.py`, text: i < 4 ? almost : '', order: i }]),
    );
    const heavy = recorded(full).store;
    expect(heavy.editFile('f05', 'abcd').ok).toBe(true);
    expect(heavy.editFile('f05', 'abcde')).toMatchObject({ ok: false, code: 'projectTooBig' });
    expect(heavy.newFile('one-more.py', 'abcde')).toMatchObject({ ok: false, code: 'projectTooBig' });

    const many = twoFiles();
    many.files = Object.fromEntries(
      Array.from({ length: PROJECT_LIMITS.files }, (_, i) => [`f${i + 1}`, { path: `m${i}.py`, text: '', order: i }]),
    );
    const crowded = recorded(many).store;
    const over = crowded.newFile('last.py');
    expect(over).toMatchObject({ ok: false, code: 'tooManyFiles' });
    expect(!over.ok && over.message).toBe('A project holds at most 200 files. Delete a file first.');

    const tested = twoFiles();
    tested.tests = Object.fromEntries(
      Array.from({ length: PROJECT_LIMITS.tests }, (_, i) => [
        `t${i}`,
        { id: `t${i}`, name: `${i}`, kind: 'io', expected: '', compare: { mode: 'exact' }, order: i },
      ]),
    );
    const busy = recorded(tested).store;
    const test = {
      id: 'x',
      name: 'x',
      kind: 'io' as const,
      expected: '',
      compare: { mode: 'exact' as const },
      order: 0,
    };
    expect(busy.setTest('t500', test)).toMatchObject({ ok: false, code: 'tooManyTests' });
    expect(busy.setTest('t1', test).ok).toBe(true);
  });

  it('replaces a test whole, removing the fields the new one lacks', () => {
    const data = twoFiles();
    data.tests = {
      t01: {
        id: 't01',
        name: 'a',
        kind: 'call',
        fn: 'f',
        callArgs: '[1]',
        expected: '1',
        compare: { mode: 'number', tolerance: 0.1 },
        order: 0,
      },
    };
    const { store, sent } = recorded(data);
    store.setTest('t01', { id: 't01', name: 'b', kind: 'io', expected: '2', compare: { mode: 'exact' }, order: 0 });
    const after = applyMergePatch(data, sent[0].data) as { tests: Record<string, unknown> };
    expect(after.tests.t01).toEqual({
      id: 't01',
      name: 'b',
      kind: 'io',
      expected: '2',
      compare: { mode: 'exact' },
      order: 0,
    });
  });
});

describe('project store read-only and updates', () => {
  it('is read-only on a read-only page and for a project from a newer app, and never patches', () => {
    const page = recorded(twoFiles(), true);
    expect(page.store.editFile('f01', 'x')).toMatchObject({ ok: false, code: 'readOnly' });
    const newer = recorded({ ...twoFiles(), minEditor: CODE_PROJECT_VERSION + 1 });
    expect(newer.store.editable).toBe(false);
    expect(newer.store.editFile('f01', 'x')).toMatchObject({ ok: false, code: 'readOnly' });
    expect(newer.store.newFile('b.py')).toMatchObject({ ok: false, code: 'readOnly' });
    expect(newer.store.deleteFile('f02')).toMatchObject({ ok: false, code: 'readOnly' });
    expect(newer.store.moveFile('f02', 'x')).toMatchObject({ ok: false, code: 'readOnly' });
    vi.runAllTimers();
    expect([...page.sent, ...newer.sent]).toHaveLength(0);
    const same = recorded({ ...twoFiles(), minEditor: CODE_PROJECT_VERSION, v: CODE_PROJECT_VERSION + 3 });
    expect(same.store.editable).toBe(true);
  });

  it('keeps typing not yet sent on top of newer page data, and drops it for a deleted file', () => {
    const { store, sent } = recorded();
    store.editFile('f01', 'mine\n');
    store.update({ ...twoFiles(), name: 'Renamed elsewhere' });
    expect(store.project().name).toBe('Renamed elsewhere');
    expect(store.project().files.f01.text).toBe('mine\n');
    const gone = twoFiles();
    delete (gone.files as Record<string, unknown>).f01;
    store.update(gone);
    vi.runAllTimers();
    expect(sent).toHaveLength(0);
  });
});
