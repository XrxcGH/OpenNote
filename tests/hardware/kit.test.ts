import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crashPlan, main, parseArgs } from './kit.ts';
import {
  GATES,
  TABLE_HEADER,
  addRow,
  cameraLatency,
  classifyVolume,
  crashVerdict,
  dayOf,
  driveLetter,
  editDistance,
  errorRate,
  formatRow,
  isSharePath,
  meetsExpectation,
  parseNumbers,
  percentile,
  slug,
  typingVerdict,
} from './lib.ts';
import type { HardwareRow } from './lib.ts';

const row: HardwareRow = {
  gate: 'Crash safety',
  date: '2026-10-07',
  machine: 'Laptop | 4 threads',
  target: 'usb-exfat: exFAT, usb',
  result: 'core: 100 kills, 0 failures',
  verdict: 'pass',
  file: 'tests/crash/results/2026-10-07-laptop-usb-exfat-*',
};

test('tells a USB stick, an internal disk, and a share apart', () => {
  assert.deepEqual(classifyVolume('E:\\', { FileSystemType: 'exFAT', DriveType: 'Removable', BusType: 'USB' }), {
    fileSystem: 'exFAT',
    kind: 'usb',
    label: '',
    bus: 'USB',
  });
  assert.equal(
    classifyVolume('C:\\', { FileSystemType: 'NTFS', DriveType: 'Fixed', BusType: 'NVMe' }).kind,
    'internal',
  );
  assert.equal(classifyVolume('\\\\nas\\notes', {}).kind, 'share');
  assert.equal(classifyVolume('Z:\\', { DriveType: 'Remote' }).kind, 'share');
  assert.equal(classifyVolume('D:\\', {}).kind, 'other');
  assert.equal(classifyVolume('F:\\', { FileSystemType: 'FAT32', DriveType: 2 }).kind, 'usb');
});

test('reads drive letters and share paths', () => {
  assert.equal(driveLetter('e:\\notes'), 'E');
  assert.equal(driveLetter('C:/x'), 'C');
  assert.equal(driveLetter('\\\\nas\\notes'), null);
  assert.equal(isSharePath('\\\\nas\\notes\\book'), true);
  assert.equal(isSharePath('\\\\nas'), false);
  assert.equal(isSharePath('C:\\notes'), false);
});

test('holds a drive to what the gate names', () => {
  const stick = classifyVolume('E:\\', { FileSystemType: 'exFAT', DriveType: 'Removable', BusType: 'USB' });
  assert.equal(meetsExpectation(stick, 'exfat'), true);
  assert.equal(meetsExpectation(stick, 'USB'), true);
  assert.equal(meetsExpectation(stick, 'fat32'), false);
  assert.equal(meetsExpectation(stick, 'share'), false);
  assert.equal(meetsExpectation(stick, ''), true);
});

test('picks percentiles the way the benchmarks do', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 9);
  assert.ok(Number.isNaN(percentile([], 0.5)));
});

test('counts the edits between two texts', () => {
  assert.equal(editDistance([...'kitten'], [...'sitting']), 3);
  assert.equal(editDistance([], [...'abc']), 3);
  assert.equal(editDistance([...'same'], [...'same']), 0);
});

test('rates the errors of a reading by characters and by words', () => {
  const truth = 'The quick brown fox';
  const characters = errorRate(truth, 'The quack brown fox', 'character');
  assert.equal(characters.errors, 1);
  assert.equal(characters.length, 19);
  assert.ok(Math.abs(characters.rate - 1 / 19) < 1e-9);
  const words = errorRate(truth, 'The quack brown fox', 'word');
  assert.deepEqual([words.errors, words.length, words.rate], [1, 4, 0.25]);
  assert.equal(errorRate(truth, '  The   quick\nbrown fox ', 'character').rate, 0);
  assert.equal(errorRate('', '', 'character').rate, 0);
  assert.equal(errorRate('', 'x', 'character').rate, 1);
});

test('turns counted camera frames into milliseconds', () => {
  const latency = cameraLatency([4, 5, 4, 5, 4, 5, 5, 4, 5, 5], 240);
  assert.equal(latency.samples, 10);
  assert.ok(Math.abs(latency.p50 - (5 * 1000) / 240) < 1e-9);
  assert.ok(Math.abs(latency.max - (5 * 1000) / 240) < 1e-9);
  assert.ok(latency.p95 <= GATES.penLatencyP95.max);
  assert.throws(() => cameraLatency([5, 6], 240), /at least 5/);
  assert.throws(() => cameraLatency([5, 6, 7, 8, 9], 0), /above zero/);
  assert.throws(() => cameraLatency([5, 6, 7, 8, -1], 240), /zero or more/);
});

test('reads a list of numbers', () => {
  assert.deepEqual(parseNumbers('5, 6 7;8\n9'), [5, 6, 7, 8, 9]);
  assert.deepEqual(parseNumbers(''), []);
});

test('holds each typing condition to the painted budget', () => {
  const pass = typingVerdict([
    { id: 'plain', painted: { p95: 9 } },
    { id: 'burst', painted: { p95: 16 } },
  ]);
  assert.equal(pass.pass, true);
  assert.deepEqual(pass.worst, { id: 'burst', p95: 16 });
  const fail = typingVerdict([
    { id: 'plain', painted: { p95: 9 } },
    { id: 'table', painted: { p95: 21.5 } },
  ]);
  assert.equal(fail.pass, false);
  assert.deepEqual(fail.failing, ['table']);
  assert.equal(typingVerdict([]).pass, false);
});

test('judges a kill harness summary', () => {
  assert.deepEqual(crashVerdict({ iterations: 100, failures: [] }), { pass: true, text: '100 kills, 0 failures' });
  assert.deepEqual(crashVerdict({ iterations: 100, failures: ['page lost'] }), {
    pass: false,
    text: '100 kills, 1 failure',
  });
  assert.equal(crashVerdict({}).pass, false);
});

test('keeps results in one table, one row for each run, without repeating a run', () => {
  const first = addRow(null, row);
  assert.ok(first.startsWith('# Hardware gates'));
  assert.ok(first.includes(TABLE_HEADER));
  assert.ok(first.includes(formatRow(row)));
  assert.ok(formatRow(row).includes('Laptop / 4 threads'));
  const twice = addRow(first, row);
  assert.equal(twice, first);
  const second = addRow(first, { ...row, gate: 'Typing', verdict: 'fail' });
  assert.equal(
    second.split('\n').filter((line) => line.startsWith('| Crash') || line.startsWith('| Typing')).length,
    2,
  );
  assert.ok(second.endsWith('|\n'));
});

test('names result files from a date and a label', () => {
  assert.equal(dayOf(new Date(2026, 9, 7)), '2026-10-07');
  assert.equal(slug('USB stick (exFAT)'), 'usb-stick-exfat');
  assert.equal(slug('***'), 'run');
});

test('reads the command line', () => {
  const options = parseArgs(['crash', '--dir', 'E:\\', '--label', 'usb', '--dry-run', '--kills', '5']);
  assert.equal(options.command, 'crash');
  assert.equal(options.values.get('dir'), 'E:\\');
  assert.equal(options.flags.has('dry-run'), true);
  assert.throws(() => parseArgs(['crash', '--dir']), /needs a value/);
  assert.throws(() => parseArgs(['crash', 'extra']), /Unexpected/);
});

test('plans the crash gate with the notebook on the drive under test and the data off it', () => {
  const options = parseArgs(['crash', '--dir', 'E:\\', '--label', 'USB exFAT', '--kills', '7', '--seed', '9']);
  const plan = crashPlan(options, 'E:\\opennote-hardware-kit-1', '2026-10-07');
  assert.equal(plan.runs.length, 3);
  const [measure, core, fs] = plan.runs;
  assert.deepEqual(measure.args.slice(0, 3), ['crashtest', 'measure', 'all']);
  assert.ok(measure.args.includes('usb-exfat'));
  for (const [run, workload] of [
    [core, 'core'],
    [fs, 'fs'],
  ] as const) {
    assert.equal(run.args[run.args.indexOf('--workload') + 1], workload);
    assert.equal(run.args[run.args.indexOf('--iterations') + 1], '7');
    assert.equal(run.args[run.args.indexOf('--seed') + 1], '9');
    assert.ok(run.args[run.args.indexOf('--notebook') + 1].startsWith('E:\\'));
    assert.ok(!run.args[run.args.indexOf('--data') + 1].startsWith('E:\\'));
  }
  assert.ok(plan.files.core.replace(/\\/g, '/').includes('tests/crash/results/2026-10-07-'));
  assert.ok(plan.files.core.endsWith('-kill-core-7.json'));
  const skipped = crashPlan(parseArgs(['crash', '--label', 'x', '--skip-measure']), 'E:\\s', '2026-10-07');
  assert.equal(skipped.runs.length, 2);
});

test('adds the core file system tests on a FAT or exFAT drive and on a share', () => {
  const options = parseArgs(['crash', '--label', 'x']);
  const stick = classifyVolume('E:\\', { FileSystemType: 'exFAT', DriveType: 'Removable', BusType: 'USB' });
  const onStick = crashPlan(options, 'E:\\s', '2026-10-07', stick).runs.at(-1);
  assert.deepEqual(onStick?.args.slice(0, 2), ['test', '-p']);
  assert.deepEqual(Object.keys(onStick?.env ?? {}), ['OPENNOTE_TEST_FAT_DIR']);
  const share = classifyVolume('\\\\nas\\notes', {});
  const onShare = crashPlan(options, '\\\\nas\\notes\\s', '2026-10-07', share).runs.at(-1);
  assert.deepEqual(Object.keys(onShare?.env ?? {}), ['OPENNOTE_TEST_SHARE_DIR']);
  const ntfs = classifyVolume('C:\\', { FileSystemType: 'NTFS', DriveType: 'Fixed', BusType: 'NVMe' });
  assert.equal(crashPlan(options, 'C:\\s', '2026-10-07', ntfs).runs.length, 3);
});

test('shows a dry run without writing anything', () => {
  const log = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  try {
    assert.equal(main(['crash', '--dir', 'C:\\Users', '--label', 'internal', '--dry-run']), 0);
    assert.equal(main(['typing', '--label', 'x', '--dry-run', '--any-cores']), 0);
    assert.equal(main(['pen-latency', '--label', 'x', '--fps', '240', '--frames', '5,6,5,6,5', '--dry-run']), 0);
  } finally {
    console.log = log;
  }
  assert.ok(lines.some((line) => line.includes('crashtest')));
  assert.ok(lines.some((line) => line.includes('perf:typing')));
  assert.ok(lines.some((line) => line.includes('95th percentile')));
});

test('refuses what it cannot run', () => {
  const error = console.error;
  console.error = () => undefined;
  try {
    assert.equal(main(['nothing']), 2);
    assert.equal(main(['crash', '--label', 'x']), 2);
    assert.equal(main(['pen-latency', '--label', 'x', '--fps', '240', '--frames', '1,2']), 2);
    assert.equal(main(['phase12', '--kind', 'dictation', '--truth', 'a', '--read', 'b', '--label', 'x']), 2);
  } finally {
    console.error = error;
  }
});
