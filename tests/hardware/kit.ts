// The hardware measurement kit (docs/testing/hardware-kit.md). One command for each exit gate that needs a real
// device. The owner runs it on that device; it runs the tools that exist, asks for the numbers only a person can
// read (camera frames, what the recognizer wrote), and keeps the results:
//
//   node tests/hardware/kit.ts crash --dir E:\ --label usb-exfat [--expect exfat] [--kills 100]
//   node tests/hardware/kit.ts typing --label four-core
//   node tests/hardware/kit.ts pen-latency --label surface-pen --fps 240 --frames "5,6,5,7,6,5" [--software]
//   node tests/hardware/kit.ts phase12 --kind handwriting --style print --truth truth.txt --read read.txt --label sls2
//   node tests/hardware/kit.ts report
//
// Results go to tests/crash/results (crash) and docs/perf (the rest), and each run adds a row to
// docs/perf/hardware-gates.md. `--dry-run` shows what a command would do and writes nothing.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import {
  GATES,
  addRow,
  cameraLatency,
  classifyVolume,
  crashVerdict,
  dayOf,
  driveLetter,
  errorRate,
  isSharePath,
  meetsExpectation,
  parseNumbers,
  slug,
  typingVerdict,
} from './lib.ts';
import type { CrashSummary, HardwareRow, TypingCondition, Volume, VolumeFacts } from './lib.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const CRASH_RESULTS = join(ROOT, 'tests', 'crash', 'results');
const PERF_DOCS = join(ROOT, 'docs', 'perf');
const TABLE = join(PERF_DOCS, 'hardware-gates.md');

export interface Options {
  readonly command: string;
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
}

const FLAG_NAMES = new Set(['dry-run', 'keep', 'skip-measure', 'software', 'any-cores', 'help']);

export function parseArgs(args: readonly string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let command = '';
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      if (command === '') command = arg;
      else throw new Error(`Unexpected argument "${arg}".`);
      continue;
    }
    const name = arg.slice(2);
    if (FLAG_NAMES.has(name)) flags.add(name);
    else {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
      values.set(name, value);
      i += 1;
    }
  }
  return { command, values, flags };
}

const need = (options: Options, name: string): string => {
  const value = options.values.get(name);
  if (value === undefined || value.trim() === '') throw new Error(`--${name} is required.`);
  return value;
};

/** A description of this machine for the result files, unless `--machine` gives one. */
function machineName(options: Options): string {
  const given = options.values.get('machine');
  if (given) return given;
  const cpus = os.cpus();
  const memory = Math.round(os.totalmem() / 2 ** 30);
  return `${os.hostname()} (${cpus[0]?.model.trim() ?? 'unknown processor'}, ${cpus.length} threads, ${memory} GB, ${os.type()} ${os.release()})`;
}

interface Run {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

const show = (run: Run): string => [run.command, ...run.args].join(' ');

/** Runs a program with its output on the screen. Returns its exit code. */
function execute(run: Run): number {
  console.log(`\n> ${show(run)}`);
  const done = spawnSync(run.command, [...run.args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...run.env },
  });
  return done.status ?? 1;
}

function powershell(script: string): string {
  const done = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  if (done.status !== 0) throw new Error((done.stderr || done.stdout || 'PowerShell failed').trim());
  return done.stdout.trim();
}

/** What Windows says about the drive under a path. */
function probeVolume(path: string): Volume {
  if (isSharePath(path)) return classifyVolume(path, { DriveType: 'Remote', FileSystemType: 'network share' });
  const letter = driveLetter(path);
  if (process.platform !== 'win32' || letter === null) return classifyVolume(path);
  try {
    const json = powershell(
      `$v = Get-Volume -DriveLetter ${letter}; $b = ''; try { $b = (Get-Partition -DriveLetter ${letter} | Get-Disk).BusType } catch {}; ` +
        `[pscustomobject]@{ FileSystemType = "$($v.FileSystemType)"; DriveType = "$($v.DriveType)"; FileSystemLabel = "$($v.FileSystemLabel)"; BusType = "$b" } | ConvertTo-Json`,
    );
    return classifyVolume(path, JSON.parse(json) as VolumeFacts);
  } catch {
    // A mapped network drive has no volume of this kind. Ask for its file system alone.
    const info = spawnSync('fsutil', ['fsinfo', 'volumeinfo', `${letter}:`], { encoding: 'utf8' }).stdout ?? '';
    const name = /File System Name\s*:\s*(\S+)/i.exec(info)?.[1];
    return classifyVolume(path, name ? { FileSystemType: name } : {});
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function record(row: HardwareRow): void {
  const before = existsSync(TABLE) ? readFileSync(TABLE, 'utf8') : null;
  mkdirSync(PERF_DOCS, { recursive: true });
  writeFileSync(TABLE, addRow(before, row));
  console.log(`\nAdded a row to ${TABLE}`);
}

const relative = (path: string): string => path.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '').replace(/\\/g, '/');

// ---------------------------------------------------------------------------------------------------------------

/** The crash gate on one drive: the measurements, then the kill harness on both workloads. */
export function crashPlan(
  options: Options,
  scratch: string,
  day: string,
  volume: Volume = classifyVolume(scratch),
): { runs: Run[]; files: Record<string, string> } {
  const label = slug(need(options, 'label'));
  const kills = options.values.get('kills') ?? '100';
  const seed = options.values.get('seed') ?? day.replace(/-/g, '');
  const machine = slug(os.hostname());
  const stem = join(CRASH_RESULTS, `${day}-${machine}-${label}`);
  const files = {
    measure: `${stem}-measure.json`,
    core: `${stem}-kill-core-${kills}.json`,
    fs: `${stem}-kill-fs-${kills}.json`,
    volume: `${stem}-volume.json`,
  };
  // The journal and the device data live on the system drive, so only the notebook is on the drive under test.
  const data = join(os.tmpdir(), `opennote-kit-data-${label}`);
  const runs: Run[] = [];
  if (!options.flags.has('skip-measure')) {
    runs.push({
      command: 'cargo',
      args: [
        'crashtest',
        'measure',
        'all',
        '--dir',
        join(scratch, 'measure'),
        '--label',
        label,
        '--machine',
        `"${machineName(options)}"`,
        '--out',
        files.measure,
      ],
    });
  }
  for (const workload of ['core', 'fs'] as const) {
    runs.push({
      command: 'cargo',
      args: [
        'crashtest',
        'run',
        '--workload',
        workload,
        '--notebook',
        join(scratch, `notebook-${workload}`),
        '--data',
        join(data, workload),
        '--iterations',
        kills,
        '--seed',
        seed,
        '--out',
        files[workload],
      ],
    });
  }
  // The core's own file system tests have a case for FAT and exFAT drives and one for network shares. They skip
  // unless a folder on such a drive is named.
  const fat = /^(fat|fat32|exfat)$/i.test(volume.fileSystem);
  if (fat || volume.kind === 'share') {
    const name = volume.kind === 'share' ? 'OPENNOTE_TEST_SHARE_DIR' : 'OPENNOTE_TEST_FAT_DIR';
    runs.push({
      command: 'cargo',
      args: ['test', '-p', 'opennote-core', '--all-features', '--test', 'fs_windows', '--', '--nocapture'],
      env: { [name]: join(scratch, 'fs-tests') },
    });
  }
  return { runs, files };
}

function crash(options: Options): number {
  const target = need(options, 'dir');
  const label = need(options, 'label');
  const volume = probeVolume(target);
  console.log(
    `Drive under test: ${volume.fileSystem}, ${volume.kind}${volume.bus ? ` (${volume.bus})` : ''}${volume.label ? `, "${volume.label}"` : ''}`,
  );
  const expected = options.values.get('expect');
  if (expected && !meetsExpectation(volume, expected)) {
    console.error(
      `This drive is ${volume.fileSystem} (${volume.kind}), not ${expected}. Pick the drive the gate names, or drop --expect.`,
    );
    return 2;
  }
  const day = dayOf(new Date());
  const scratch = join(target, `opennote-hardware-kit-${Date.now()}`);
  const plan = crashPlan(options, scratch, day, volume);
  if (options.flags.has('dry-run')) {
    console.log(`Scratch folder: ${scratch}`);
    for (const run of plan.runs) console.log(`> ${show(run)}`);
    console.log(`Would write ${Object.values(plan.files).map(relative).join(', ')}`);
    return 0;
  }
  mkdirSync(scratch, { recursive: true });
  writeJson(plan.files.volume, {
    when: new Date().toISOString(),
    path: target,
    label,
    machine: machineName(options),
    volume,
  });
  let code = 0;
  try {
    for (const run of plan.runs) {
      for (const flag of ['--notebook', '--dir', '--data']) {
        const at = run.args.indexOf(flag);
        if (at >= 0) mkdirSync(run.args[at + 1], { recursive: true });
      }
      for (const folder of Object.values(run.env ?? {})) mkdirSync(folder, { recursive: true });
      // The harness exits with 1 when a check fails. The result file says which.
      const status = execute(run);
      if (status !== 0 && status !== 1) code = status;
    }
  } finally {
    if (!options.flags.has('keep')) rmSync(scratch, { recursive: true, force: true });
  }
  const parts: string[] = [];
  let pass = code === 0;
  for (const workload of ['core', 'fs'] as const) {
    if (!existsSync(plan.files[workload])) {
      parts.push(`${workload}: no result`);
      pass = false;
      continue;
    }
    const verdict = crashVerdict(JSON.parse(readFileSync(plan.files[workload], 'utf8')) as CrashSummary);
    parts.push(`${workload}: ${verdict.text}`);
    pass &&= verdict.pass;
  }
  if (code !== 0) parts.push(`a program exited with ${code}`);
  record({
    gate: 'Crash safety',
    date: day,
    machine: machineName(options),
    target: `${label}: ${volume.fileSystem}, ${volume.kind}`,
    result: parts.join('; '),
    verdict: pass ? 'pass' : 'fail',
    file: relative(plan.files.core).replace(/-kill-core-.*/, '-*'),
  });
  return pass ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------

function typing(options: Options): number {
  const label = need(options, 'label');
  const threads = os.availableParallelism();
  console.log(`This machine has ${threads} threads.`);
  if (threads > 8 && !options.flags.has('any-cores')) {
    console.error(
      'The typing gate is for the 4-core machine. This one is much faster, so its numbers would say little.\nRun it on that machine, or add --any-cores to measure here anyway.',
    );
    return 2;
  }
  const run: Run = { command: 'npm', args: ['run', 'perf:typing'], env: { OPENNOTE_TYPING_GATE: '1' } };
  if (options.flags.has('dry-run')) {
    console.log(`> OPENNOTE_TYPING_GATE=1 ${show(run)}`);
    return 0;
  }
  const status = execute(run);
  const source = join(ROOT, 'tests', 'perf', 'typing', 'results', 'typing.json');
  if (!existsSync(source)) {
    console.error('The typing run wrote no results.');
    return status || 1;
  }
  const data = JSON.parse(readFileSync(source, 'utf8')) as { conditions: TypingCondition[] };
  const verdict = typingVerdict(data.conditions);
  const day = dayOf(new Date());
  const file = join(PERF_DOCS, `hardware-typing-${day}-${slug(label)}.json`);
  writeJson(file, { machine: machineName(options), threads, label, gate: GATES.typingPaintedP95, ...data });
  record({
    gate: 'Typing',
    date: day,
    machine: machineName(options),
    target: `${label}, ${threads} threads`,
    result: verdict.worst
      ? `worst painted p95 ${verdict.worst.p95.toFixed(1)} ms (${verdict.worst.id}), gate ${GATES.typingPaintedP95.max} ms`
      : 'no conditions',
    verdict: verdict.pass && status === 0 ? 'pass' : 'fail',
    file: relative(file),
  });
  return verdict.pass && status === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------

function penLatency(options: Options): number {
  const label = need(options, 'label');
  const fps = Number(need(options, 'fps'));
  const frames = parseNumbers(need(options, 'frames'));
  const latency = cameraLatency(frames, fps);
  console.log(
    `Camera: ${latency.samples} strokes at ${fps} frames a second. Median ${latency.p50.toFixed(1)} ms, 95th percentile ${latency.p95.toFixed(1)} ms, worst ${latency.max.toFixed(1)} ms.`,
  );
  if (options.flags.has('dry-run')) return 0;
  const day = dayOf(new Date());
  const file = join(PERF_DOCS, `hardware-pen-${day}-${slug(label)}.json`);
  let software: unknown = null;
  if (options.flags.has('software')) {
    const out = join(os.tmpdir(), `opennote-ink-perf-${Date.now()}.json`);
    const status = execute({
      command: 'npx',
      args: ['playwright', 'test', 'ink.perf', '--config', 'tests/ui/playwright.config.ts', '--project=perf'],
      env: { OPENNOTE_INK_PERF_OUT: out },
    });
    if (existsSync(out)) software = JSON.parse(readFileSync(out, 'utf8'));
    else console.error(`The in-app ink test wrote no numbers (exit ${status}).`);
  }
  const pass = latency.p95 <= GATES.penLatencyP95.max;
  writeJson(file, {
    machine: machineName(options),
    label,
    device: options.values.get('device') ?? label,
    gate: GATES.penLatencyP95,
    camera: { ...latency, frames },
    software,
  });
  record({
    gate: 'Pen latency',
    date: day,
    machine: machineName(options),
    target: options.values.get('device') ?? label,
    result: `camera p95 ${latency.p95.toFixed(1)} ms, median ${latency.p50.toFixed(1)} ms, gate ${GATES.penLatencyP95.max} ms`,
    verdict: pass ? 'pass' : 'fail',
    file: relative(file),
  });
  return pass ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------

function phase12(options: Options): number {
  const kind = need(options, 'kind');
  if (kind !== 'handwriting' && kind !== 'ocr') throw new Error('--kind is handwriting or ocr.');
  const style = options.values.get('style') ?? 'print';
  if (style !== 'print' && style !== 'cursive') throw new Error('--style is print or cursive.');
  const label = need(options, 'label');
  const truth = readFileSync(need(options, 'truth'), 'utf8');
  const read = readFileSync(need(options, 'read'), 'utf8');
  const characters = errorRate(truth, read, 'character');
  const words = errorRate(truth, read, 'word');
  const gate =
    kind === 'ocr' ? GATES.ocrCer : style === 'cursive' ? GATES.handwritingCursiveCer : GATES.handwritingPrintCer;
  const max = options.values.has('max') ? Number(options.values.get('max')) : gate.max;
  console.log(
    `${characters.errors} of ${characters.length} characters wrong (${(characters.rate * 100).toFixed(1)}%), ${words.errors} of ${words.length} words wrong (${(words.rate * 100).toFixed(1)}%). Target ${(max * 100).toFixed(1)}% of characters.`,
  );
  if (options.flags.has('dry-run')) return 0;
  const day = dayOf(new Date());
  const file = join(PERF_DOCS, `hardware-phase12-${kind}-${day}-${slug(label)}.json`);
  const pass = characters.rate <= max;
  writeJson(file, {
    machine: machineName(options),
    label,
    kind,
    style,
    target: { max, source: gate.source },
    characters,
    words,
  });
  record({
    gate: `Phase 12 ${kind === 'ocr' ? 'text in pictures' : `handwriting (${style})`}`,
    date: day,
    machine: machineName(options),
    target: label,
    result: `${(characters.rate * 100).toFixed(1)}% of characters wrong, target ${(max * 100).toFixed(1)}%${gate.source === 'proposed' && !options.values.has('max') ? ' (proposed)' : ''}`,
    verdict: pass ? 'pass' : 'fail',
    file: relative(file),
  });
  return pass ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------

const USAGE = `usage: node tests/hardware/kit.ts <command> [options]

  crash        --dir <folder on the drive> --label <name> [--expect usb|exfat|fat32|ntfs|share] [--kills 100] [--seed n] [--keep]
  typing       --label <name> [--any-cores]
  pen-latency  --label <name> --fps <camera frames a second> --frames "<frames counted for each stroke>" [--device <text>] [--software]
  phase12      --kind handwriting|ocr --truth <file> --read <file> --label <name> [--style print|cursive] [--max <rate>]
  report       prints docs/perf/hardware-gates.md

Add --dry-run to see what a command would do, and --machine "<text>" to name the machine.`;

export function main(args: readonly string[]): number {
  let options: Options;
  try {
    options = parseArgs(args);
    if (options.flags.has('help') || options.command === '') {
      console.log(USAGE);
      return options.command === '' && !options.flags.has('help') ? 2 : 0;
    }
    switch (options.command) {
      case 'crash':
        return crash(options);
      case 'typing':
        return typing(options);
      case 'pen-latency':
        return penLatency(options);
      case 'phase12':
        return phase12(options);
      case 'report':
        console.log(existsSync(TABLE) ? readFileSync(TABLE, 'utf8') : 'No hardware runs are recorded yet.');
        return 0;
      default:
        console.error(`Unknown command "${options.command}".\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) process.exitCode = main(process.argv.slice(2));
