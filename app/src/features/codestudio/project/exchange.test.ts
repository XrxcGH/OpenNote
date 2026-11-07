// Export and import (DESIGN 3.7): the .zip round trip is lossless for files and tests, the archive follows the
// .ZIP format (APPNOTE 4.3), and import skips what a project cannot hold, with the reason.
import { describe, expect, it } from 'vitest';
import { crc32 } from '../../../core/ink/bytes';
import { t } from '../../../strings/t';
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

  it('restores the settings into the untouched starter that Insert gives, and the starter file gives way', async () => {
    const starter = starterProject(t('codeStudio.project.starterName'), t('codeStudio.project.starterMain'));
    const project = sample();
    const back = imported(starter, await readZip(exportZip(project), 1 << 20));
    expect(back.files).toEqual(project.files);
    expect(back.tests).toEqual(project.tests);
    expect(back.main).toBe('f07');
    expect(back.name).toBe('Two sum');
    expect(back.runtime).toBe('python-full');
    expect(back.settings).toEqual(project.settings);
    expect(back.stdin).toBe('4\n');
    expect(back.args).toEqual(['--fast']);
  });

  it('keeps the name and settings of a starter the user has changed, and replaces main.py by path', async () => {
    const starter = starterProject(t('codeStudio.project.starterName'), 'print(1)\n');
    const back = imported(starter, await readZip(exportZip(sample()), 1 << 20));
    expect(back.name).toBe('Untitled project');
    expect(back.runtime).toBe('python-quick');
    expect(back.files.f01.text).toBe(sample().files.f07.text);
  });

  it('takes only test cases of the stored shape, and lists the others as skipped', async () => {
    const good = sample().tests.t01;
    const hostile = [
      { ...good, id: 'ok', extra: 'not stored', compare: { mode: 'exact', junk: 1 } },
      { ...good, id: 'noOrder', order: undefined },
      { ...good, id: '__proto__', name: 'Prototype' },
      { ...good, id: 'badKind', kind: 'shell' },
      { ...good, id: 'bad id!' },
      { ...good, id: 'badArgs', args: [1] },
      'not a case',
    ];
    const entries = ((await readZip(exportZip(sample()), 1 << 20)) as ZipEntry[]).map((entry) =>
      entry.path === 'opennote-tests.json'
        ? { ...entry, bytes: encoder.encode(JSON.stringify({ format: 'opennote-code-project', tests: hostile })) }
        : entry,
    );
    const plan = planImport(empty(), entries);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(['test', 'test', 'test', 'test', 'test', 'test']);
    expect(plan.skipped[5].path).toBe('opennote-tests.json #7');
    const back = imported(empty(), entries);
    expect(Object.keys(back.tests)).toEqual(['ok']);
    expect(back.tests.ok).toEqual({ ...good, id: 'ok' });
    expect(Object.getPrototypeOf(back.tests)).toBe(Object.prototype);
    expect(importSummary(plan)).toContain('Prototype (not a test case OpenNote can read)');
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

/**
 * An archive with one stored entry and `count` central entries that all point at its local header. APPNOTE 4.3.12
 * gives each central entry a local offset, and nothing in the format stops them sharing one.
 */
function sharedHeaders(entryBytes: number, count: number): Uint8Array {
  const one = writeZip([{ path: 'a.txt', bytes: new Uint8Array(entryBytes).fill(97) }]);
  const localLength = 30 + 5 + entryBytes;
  const central = one.subarray(localLength, localLength + 46 + 5);
  const out = new Uint8Array(localLength + central.length * count + 22);
  out.set(one.subarray(0, localLength));
  for (let i = 0; i < count; i++) out.set(central, localLength + i * central.length);
  const end = new DataView(out.buffer, localLength + central.length * count);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, count, true);
  end.setUint16(10, count, true);
  end.setUint32(12, central.length * count, true);
  end.setUint32(16, localLength, true);
  return out;
}

/** A one-entry archive with `text` deflated (APPNOTE 4.4.5: method 8 and the packed size) and `declared` as its size. */
async function deflatedZip(text: string, declared = text.length): Promise<Uint8Array> {
  const deflated = new Uint8Array(
    await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
  );
  const stored = writeZip([{ path: 'x.py', bytes: encoder.encode(text) }]);
  const nameEnd = 30 + 4;
  const packedZip = new Uint8Array(stored.length - text.length + deflated.length);
  packedZip.set(stored.subarray(0, nameEnd));
  packedZip.set(deflated, nameEnd);
  packedZip.set(stored.subarray(nameEnd + text.length), nameEnd + deflated.length);
  const view = new DataView(packedZip.buffer);
  view.setUint16(8, 8, true);
  view.setUint32(18, deflated.length, true);
  view.setUint32(22, declared, true);
  const central = nameEnd + deflated.length;
  view.setUint16(central + 10, 8, true);
  view.setUint32(central + 20, deflated.length, true);
  view.setUint32(central + 24, declared, true);
  view.setUint32(packedZip.length - 22 + 16, central, true);
  return packedZip;
}

/**
 * The entries of the sample's export with opennote-project.json replaced by `manifest`. A .zip entry holds at most
 * 1 MiB, so the manifest stays within it unless `uncapped`, which tests the model's own bound behind that cap.
 */
async function withManifest(manifest: Record<string, unknown>, uncapped = false): Promise<ZipEntry[]> {
  const bytes = encoder.encode(JSON.stringify({ ...manifestOf(sample()), ...manifest }));
  if (!uncapped) expect(bytes.length).toBeLessThan(1024 * 1024);
  return ((await readZip(exportZip(sample()), 1 << 20)) as ZipEntry[]).map((entry) =>
    entry.path === 'opennote-project.json' ? { ...entry, bytes } : entry,
  );
}

describe('hostile archives', () => {
  it('refuses an entry that inflates past its declared size, instead of listing it as too big', async () => {
    // Declared 10 bytes, within the 100-byte cap, but the stream holds 1000.
    const lying = await deflatedZip('a'.repeat(1000), 10);
    await expect(readZip(lying, 100)).rejects.toEqual(new ZipError('corrupt'));
    await expect(readZip(lying, 1 << 20)).rejects.toEqual(new ZipError('corrupt'));
  });

  it('restores only known manifest fields, bounded, into a fresh project', async () => {
    const entries = await withManifest({
      name: 'n'.repeat(900 * 1024),
      language: 'evil',
      runtime: 'evil',
      stdin: 7,
      args: ['a', 1, 'b'],
      settings: { timeMs: 1e300, memoryMb: -5, tabSize: 2.6, junk: 'x'.repeat(1000), nested: { a: 1 } },
      extra: 'not stored',
    });
    const plan = planImport(empty(), entries);
    expect(plan.refusal).toBeNull();
    const patch = plan.patch!;
    expect(Object.keys(patch).sort()).toEqual(['args', 'files', 'main', 'name', 'settings', 'tests', 'v']);
    expect(patch.name).toBe('n'.repeat(256));
    expect(patch.args).toEqual(['a', 'b']);
    // Clamped to SETTINGS_RANGE (model.ts), and the tab size rounded to a whole number.
    expect(patch.settings).toEqual({ timeMs: 600_000, memoryMb: 16, tabSize: 3 });
    const files = JSON.stringify(patch.files).length + JSON.stringify(patch.tests).length;
    expect(JSON.stringify(patch).length - files).toBeLessThan(1024);
    const back = imported(empty(), entries);
    expect(back.language).toBe('python');
    expect(back.runtime).toBe('python-quick');
    expect(back.stdin).toBe('');
  });

  it('keeps a known language and runtime, and leaves out input past 1 MiB', async () => {
    const entries = await withManifest({ language: 'javascript', runtime: 'toolchain', stdin: 'é'.repeat(300_000) });
    const plan = planImport(empty(), entries);
    expect(plan.patch!.language).toBe('javascript');
    expect(plan.patch!.runtime).toBe('toolchain');
    // 300,000 characters are 600,000 UTF-8 bytes, within the limit.
    expect(plan.patch!.stdin).toHaveLength(300_000);
    // 524,289 characters are 1 MiB and 2 bytes.
    const over = planImport(empty(), await withManifest({ stdin: 'é'.repeat(524_289) }, true));
    expect(over.patch).not.toHaveProperty('stdin');
  });

  it('refuses central entries that share one local header at once, without copying them', async () => {
    const archive = sharedHeaders(1024 * 1024, 300);
    const start = performance.now();
    await expect(entriesOf([{ name: 'x.zip', bytes: archive }])).rejects.toEqual(new ZipError('corrupt'));
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('refuses more entries than a project and its three export files hold, before opening the rest', async () => {
    // 200 files and 3 export files fit; one more does not.
    const fits = Array.from({ length: 203 }, (_, i) => ({ path: `f${i}.txt`, bytes: new Uint8Array(0) }));
    expect(await entriesOf([{ name: 'ok.zip', bytes: writeZip(fits) }])).toHaveLength(203);
    const over = [...fits, { path: 'one-more.txt', bytes: new Uint8Array(0) }];
    const error = await entriesOf([{ name: 'x.zip', bytes: writeZip(over) }]).catch((caught: unknown) => caught);
    expect(error).toEqual(new ZipError('tooBig'));
  });

  it('refuses an archive that unpacks past 4 MiB of project and 3 MiB of export files', async () => {
    // Seven distinct 1 MiB entries are 7 MiB, the cap; an eighth passes it.
    const mib = (i: number) => ({ path: `m${i}.txt`, bytes: new Uint8Array(1024 * 1024).fill(97 + i) });
    const seven = Array.from({ length: 7 }, (_, i) => mib(i));
    expect(await entriesOf([{ name: 'ok.zip', bytes: writeZip(seven) }])).toHaveLength(7);
    const eight = writeZip([...seven, mib(7)]);
    await expect(entriesOf([{ name: 'x.zip', bytes: eight }])).rejects.toEqual(new ZipError('tooBig'));
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
    const packedZip = await deflatedZip(text);
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

  it('lists the first 10 skipped names in the sentence, and counts the rest', async () => {
    const bad = Array.from({ length: 25 }, (_, i) => ({ id: `bad${i}`, name: `Case ${i}` }));
    const entries = ((await readZip(exportZip(sample()), 1 << 20)) as ZipEntry[]).map((entry) =>
      entry.path === 'opennote-tests.json'
        ? { ...entry, bytes: encoder.encode(JSON.stringify({ format: 'opennote-code-project', tests: bad })) }
        : entry,
    );
    const plan = planImport(empty(), entries);
    expect(plan.skipped).toHaveLength(25);
    const summary = importSummary(plan);
    expect(summary).toContain('Skipped 25 files: Case 0 (not a test case OpenNote can read)');
    expect(summary).toContain('Case 9 (not a test case OpenNote can read), and 15 more.');
    expect(summary).not.toContain('Case 10 ');
  });

  it('gives one file for download under its own name', () => {

    const download = fileDownload(sample(), 'f02')!;
    expect(download.name).toBe('util.py');
    expect(decoder.decode(download.bytes)).toBe('def two_sum(nums, target):\n    return [0, 1]\n');
    expect(fileDownload(sample(), 'nope')).toBeNull();
  });
});
