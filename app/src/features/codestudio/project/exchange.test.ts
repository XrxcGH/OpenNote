// Export and import (DESIGN 3.7): the .zip round trip is lossless for files and tests, the archive follows the
// .ZIP format (APPNOTE 4.3), and import skips what a project cannot hold, with the reason.
import { describe, expect, it } from 'vitest';
import { crc32 } from '../../../core/ink/bytes';
import type { CodeProject } from '../contracts';
import { entriesOf, exportZip, fileDownload, importSummary, manifestOf, planImport } from './exchange';
import { readProject, starterProject } from './model';
import { createProjectStore } from './store';
import { readZip, writeZip, ZipError } from './zip';
import type { ZipEntry } from './zip';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sample(): CodeProject {
  return {
    ...starterProject('Two sum', ''),
    runtime: 'python-full',
    stdin: '4\n',
    args: ['--fast'],
    settings: { timeMs: 5000, memoryMb: 128, tabSize: 2 },
    main: 'f07',
    files: {
      f07: { path: 'main.py', text: 'from lib.util import two_sum\nprint(two_sum([2, 7], 9))\n', order: 0 },
      f02: { path: 'lib/util.py', text: 'def two_sum(nums, target):\n    return [0, 1]\n', order: 1 },
      f03: { path: 'README.md', text: '# My notes\n', order: 2 },
      f04: { path: 'data/naïve.txt', text: '\uFEFF?', order: 3 },
    },
    tests: {
      t01: {
        id: 't01',
        name: 'Example 1',
        kind: 'call',
        fn: 'two_sum',
        callArgs: '[[2,7,11,15],9]',
        expected: '[0,1]',
        compare: { mode: 'exact' },
        order: 0,
      },
      t02: {
        id: 't02',
        name: 'Prints',
        kind: 'io',
        stdin: '',
        expected: '[0, 1]\n',
        compare: { mode: 'trim' },
        order: 1,
      },
    },
  };
}

const empty = (): CodeProject => ({ ...starterProject('', ''), files: {}, main: '' });

/** The project an import gives, applied through a store as the page would. */
function imported(into: CodeProject, entries: Parameters<typeof planImport>[1]): CodeProject {
  const plan = planImport(into, entries);
  expect(plan.refusal).toBeNull();
  let data = into as unknown as Record<string, unknown>;
  const store = createProjectStore({ data, patch: () => undefined });
  if (plan.patch) expect(store.apply(plan.patch).ok).toBe(true);
  data = store.project() as unknown as Record<string, unknown>;
  return readProject(data);
}

describe('project zip', () => {
  it('exports then imports with the same files and tests', async () => {
    const project = sample();
    const entries = await readZip(exportZip(project), 1 << 20);
    const back = imported(empty(), entries);
    expect(back.files).toEqual(project.files);
    expect(back.tests).toEqual(project.tests);
    expect(back.main).toBe('f07');
    expect(back.name).toBe('Two sum');
    expect(back.settings).toEqual(project.settings);
    expect(back.stdin).toBe('4\n');
    expect(back.args).toEqual(['--fast']);
    expect(back.runtime).toBe('python-full');
  });

  it('holds each file at its path, opennote-project.json, opennote-tests.json, and no README over the own one', async () => {
    const entries = (await readZip(exportZip(sample()), 1 << 20)) as ZipEntry[];
    expect(entries.map((entry) => entry.path)).toEqual([
      'main.py',
      'lib/util.py',
      'README.md',
      'data/naïve.txt',
      'opennote-project.json',
      'opennote-tests.json',
    ]);
    expect(decoder.decode(entries[2].bytes)).toBe('# My notes\n');
    const manifest = JSON.parse(decoder.decode(entries[4].bytes));
    expect(manifest).toEqual(JSON.parse(JSON.stringify(manifestOf(sample()))));
    expect(manifest.main).toBe('main.py');
    const tests = JSON.parse(decoder.decode(entries[5].bytes));
    expect(tests.tests.map((test: { id: string }) => test.id)).toEqual(['t01', 't02']);
  });

  it('generates a README with the language and the main file when the project has none', async () => {
    const project = sample();
    delete project.files.f03;
    const entries = (await readZip(exportZip(project), 1 << 20)) as ZipEntry[];
    const readme = decoder.decode(entries.find((entry) => entry.path === 'README.md')!.bytes);
    expect(readme).toContain('# Two sum');
    expect(readme).toContain('Language: Python.');
    expect(readme).toContain('Main file: main.py.');
    // Importing it back leaves the generated README out.
    const back = imported(empty(), entries);
    expect(Object.values(back.files).map((file) => file.path)).not.toContain('README.md');
  });
});

describe('zip format', () => {
  it('writes the .ZIP format: signatures, stored entries, UTF-8 names, CRC-32, and the end record', () => {
    // Hand-worked from APPNOTE 4.3.7 and 4.3.16 for one entry "a.txt" holding "hi".
    const bytes = writeZip([{ path: 'a.txt', bytes: encoder.encode('hi') }]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0x0800);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint16(12, true)).toBe(0x21);
    expect(view.getUint32(14, true)).toBe(crc32(encoder.encode('hi')));
    expect(view.getUint32(18, true)).toBe(2);
    expect(decoder.decode(bytes.subarray(30, 35))).toBe('a.txt');
    // Local header 30 + 5 + 2, central header 46 + 5, end record 22.
    expect(bytes.length).toBe(37 + 51 + 22);
    expect(view.getUint32(37, true)).toBe(0x02014b50);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(1);
    expect(view.getUint32(end + 12, true)).toBe(51);
    expect(view.getUint32(end + 16, true)).toBe(37);
  });

  it('gives the same bytes for the same project', () => {
    expect(exportZip(sample())).toEqual(exportZip(sample()));
  });

  it('reads deflated entries, and skips an entry larger than allowed without inflating it', async () => {
    const text = 'print("hello")\n'.repeat(50);
    const deflated = new Uint8Array(
      await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
    );
    const stored = writeZip([{ path: 'x.py', bytes: encoder.encode(text) }]);
    // The same archive with the entry deflated: method 8 and the packed size, as APPNOTE 4.4.5 describes.
    const nameEnd = 30 + 4;
    const packedZip = new Uint8Array(stored.length - text.length + deflated.length);
    packedZip.set(stored.subarray(0, nameEnd));
    packedZip.set(deflated, nameEnd);
    packedZip.set(stored.subarray(nameEnd + text.length), nameEnd + deflated.length);
    const view = new DataView(packedZip.buffer);
    view.setUint16(8, 8, true);
    view.setUint32(18, deflated.length, true);
    const central = nameEnd + deflated.length;
    view.setUint16(central + 10, 8, true);
    view.setUint32(central + 20, deflated.length, true);
    view.setUint32(packedZip.length - 22 + 16, central, true);
    const [entry] = (await readZip(packedZip, 1 << 20)) as ZipEntry[];
    expect(decoder.decode(entry.bytes)).toBe(text);
    expect(await readZip(packedZip, 100)).toEqual([{ path: 'x.py', tooBig: true }]);
  });

  it('refuses bytes that are not an archive', async () => {
    await expect(readZip(encoder.encode('not a zip at all, just text'), 1 << 20)).rejects.toBeInstanceOf(ZipError);
  });
});

describe('project import', () => {
  it('adds text files, replaces a file at the same path, and lists binary and bad paths as skipped', async () => {
    const project = sample();
    const zip = writeZip([
      { path: 'proj/MAIN.py', bytes: encoder.encode('print("new")\n') },
      { path: 'proj/extra/notes.txt', bytes: encoder.encode('hello\n') },
      { path: 'proj/img.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]) },
      { path: 'proj/CON.py', bytes: encoder.encode('x\n') },
    ]);
    const entries = await entriesOf([
      { name: 'proj.zip', bytes: zip },
      { name: 'loose.py', bytes: encoder.encode('print(0)\n') },
    ]);
    const plan = planImport(project, entries);
    expect(plan.added).toEqual(['extra/notes.txt', 'loose.py']);
    expect(plan.replaced).toEqual(['MAIN.py']);
    expect(plan.skipped).toEqual([
      { path: 'img.png', reason: 'binary' },
      { path: 'CON.py', reason: 'path' },
    ]);
    expect(importSummary(plan)).toBe(
      'Imported 3 files. Skipped 2 files: img.png (not UTF-8 text), CON.py (path not allowed).',
    );
    const back = imported(project, entries);
    expect(back.files.f07.text).toBe('print("new")\n');
    expect(back.files.f07.path).toBe('main.py');
    expect(Object.keys(back.files)).toHaveLength(6);
  });

  it('refuses a whole import that would pass 200 files, and lists a file over 1 MiB as skipped', async () => {
    const project = sample();
    const many = Array.from({ length: 197 }, (_, i) => ({ name: `m${i}.py`, bytes: encoder.encode('') }));
    const plan = planImport(project, await entriesOf(many));
    expect(plan.patch).toBeNull();
    expect(plan.refusal?.code).toBe('tooManyFiles');
    expect(importSummary(plan)).toBe('A project holds at most 200 files. Delete a file first.');
    const big = await entriesOf([{ name: 'big.txt', bytes: new Uint8Array(1024 * 1024 + 1).fill(65) }]);
    expect(planImport(project, big).skipped).toEqual([{ path: 'big.txt', reason: 'tooBig' }]);
  });

  it('gives one file for download under its own name', () => {
    const download = fileDownload(sample(), 'f02')!;
    expect(download.name).toBe('util.py');
    expect(decoder.decode(download.bytes)).toBe('def two_sum(nums, target):\n    return [0, 1]\n');
    expect(fileDownload(sample(), 'nope')).toBeNull();
  });
});
