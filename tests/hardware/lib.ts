// The pure parts of the hardware measurement kit (docs/testing/hardware-kit.md): the gates, the arithmetic, how a
// drive is told apart, and the table of results. Nothing here runs a program or touches a file, so a test covers it.

/** Where each gate comes from. A gate marked `proposed` waits for the owner to confirm the number. */
export const GATES = {
  /** Plan section 13.6: no kill may damage or lose a page. */
  crashFailures: { max: 0, source: 'docs/DEVELOPMENT.md, kill harness' },
  /** tests/perf/typing/typing.spec.ts: the painted time of a key at the 95th percentile, in ms. */
  typingPaintedP95: { max: 16, source: 'tests/perf/typing/typing.spec.ts' },
  /** ADR 0004 and tests/ui/perf/ink.perf.spec.ts: pen to screen at the 95th percentile, in ms. */
  penLatencyP95: { max: 25, source: 'docs/adr/0004-ink-latency.md' },
  /** Phase 12 accuracy targets. The plan names none, so these are proposals. */
  handwritingPrintCer: { max: 0.1, source: 'proposed' },
  handwritingCursiveCer: { max: 0.2, source: 'proposed' },
  ocrCer: { max: 0.03, source: 'proposed' },
} as const;

export type DriveKind = 'internal' | 'usb' | 'share' | 'other';

export interface Volume {
  readonly fileSystem: string;
  readonly kind: DriveKind;
  readonly label: string;
  /** The Windows bus of the disk (`USB`, `NVMe`, `SATA`), when known. */
  readonly bus: string;
}

/** What `Get-Volume` and `Get-Disk` say, as the kit reads them. Missing fields are fine. */
export interface VolumeFacts {
  readonly FileSystemType?: unknown;
  readonly DriveType?: unknown;
  readonly BusType?: unknown;
  readonly FileSystemLabel?: unknown;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

/** A path on a network share (`\\host\share`), which has no drive letter. */
export function isSharePath(path: string): boolean {
  return /^(\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(path);
}

/** The drive letter a path starts with, in upper case, or null. */
export function driveLetter(path: string): string | null {
  const match = /^([A-Za-z]):[\\/]?/.exec(path);
  return match ? match[1].toUpperCase() : null;
}

/** Tells a USB stick, an internal disk, and a share apart from what Windows reports. */
export function classifyVolume(path: string, facts: VolumeFacts = {}): Volume {
  const fileSystem = text(facts.FileSystemType) || 'unknown';
  const bus = text(facts.BusType);
  const driveType = text(facts.DriveType).toLowerCase();
  let kind: DriveKind = 'other';
  if (isSharePath(path) || driveType === 'remote' || driveType === '4') kind = 'share';
  else if (/^usb$/i.test(bus) || driveType === 'removable' || driveType === '2') kind = 'usb';
  else if (bus !== '' || driveType === 'fixed' || driveType === '3') kind = 'internal';
  return { fileSystem, kind, label: text(facts.FileSystemLabel), bus };
}

/** What `--expect` names: a file system, or a kind of drive. */
export function meetsExpectation(volume: Volume, expected: string): boolean {
  const want = expected.trim().toLowerCase();
  if (want === '') return true;
  return volume.fileSystem.toLowerCase() === want || volume.kind === want;
}

/** The value at fraction `p` (0 to 1) of the sorted values, as the benchmarks pick it. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
}

/** The fewest single-character edits (insert, delete, change) between two sequences. */
export function editDistance(a: readonly string[], b: readonly string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost));
    }
    previous = row;
  }
  return previous[b.length];
}

export interface ErrorRate {
  readonly unit: 'character' | 'word';
  readonly errors: number;
  readonly length: number;
  readonly rate: number;
}

/** Text compared the way a person reads it: one form of Unicode, runs of white space as one space, no case change. */
export function tidy(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** The share of the true text that the reading got wrong: edits over the length of the truth. */
export function errorRate(truth: string, read: string, unit: 'character' | 'word'): ErrorRate {
  const split = (value: string): string[] =>
    unit === 'word' ? tidy(value).split(' ').filter(Boolean) : [...tidy(value)];
  const want = split(truth);
  const got = split(read);
  const errors = editDistance(want, got);
  return {
    unit,
    errors,
    length: want.length,
    rate: want.length === 0 ? (got.length === 0 ? 0 : 1) : errors / want.length,
  };
}

export interface CameraLatency {
  readonly samples: number;
  readonly fps: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/** Latency from frames counted on a high-speed video: the frames between the pen moving and the ink showing. */
export function cameraLatency(frames: readonly number[], fps: number): CameraLatency {
  if (!(fps > 0)) throw new Error('The frame rate of the camera must be above zero.');
  if (frames.length < 5) throw new Error('Count at least 5 strokes, so the 95th percentile means something.');
  if (frames.some((frame) => !Number.isFinite(frame) || frame < 0))
    throw new Error('Every frame count must be zero or more.');
  const ms = frames.map((frame) => (frame * 1000) / fps);
  return {
    samples: ms.length,
    fps,
    p50: percentile(ms, 0.5),
    p95: percentile(ms, 0.95),
    max: Math.max(...ms),
  };
}

/** Reads "5, 6 7;5" as numbers. */
export function parseNumbers(list: string): number[] {
  return list
    .split(/[\s,;]+/)
    .filter((part) => part !== '')
    .map(Number);
}

export interface TypingCondition {
  readonly id: string;
  readonly painted: { readonly p95: number };
}

export interface TypingVerdict {
  readonly pass: boolean;
  readonly worst: { readonly id: string; readonly p95: number } | null;
  readonly failing: readonly string[];
}

/** Holds each typing condition to the painted budget. */
export function typingVerdict(conditions: readonly TypingCondition[]): TypingVerdict {
  const failing = conditions.filter((c) => c.painted.p95 > GATES.typingPaintedP95.max).map((c) => c.id);
  const worst = conditions.reduce<{ id: string; p95: number } | null>(
    (best, c) => (best === null || c.painted.p95 > best.p95 ? { id: c.id, p95: c.painted.p95 } : best),
    null,
  );
  return { pass: conditions.length > 0 && failing.length === 0, worst, failing };
}

export interface HardwareRow {
  readonly gate: string;
  readonly date: string;
  readonly machine: string;
  readonly target: string;
  readonly result: string;
  readonly verdict: 'pass' | 'fail' | 'not judged';
  readonly file: string;
}

export const TABLE_HEADER =
  '| Gate | Date | Machine | Drive or device | Result | Verdict | File |\n|---|---|---|---|---|---|---|';

const cell = (value: string): string => value.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

export function formatRow(row: HardwareRow): string {
  const cells = [row.gate, row.date, row.machine, row.target, row.result, row.verdict, row.file];
  return `| ${cells.map(cell).join(' | ')} |`;
}

const INTRO = `# Hardware gates

The owner runs the hardware measurement kit (\`tests/hardware/kit.ts\`, described in [the kit guide](../testing/hardware-kit.md)) on real devices. Each run adds one row here and keeps its numbers in a file. A run on a machine that is not the reference laptop counts for that machine only.

`;

/** The page with this row added at the end of the table. The page is made when it does not exist yet. */
export function addRow(page: string | null, row: HardwareRow): string {
  const line = formatRow(row);
  const base = page && page.includes(TABLE_HEADER) ? page.trimEnd() : `${INTRO}${TABLE_HEADER}`;
  if (base.split('\n').includes(line)) return `${base}\n`;
  return `${base}\n${line}\n`;
}

/** The date of a run as `YYYY-MM-DD`, in local time, which is how the result files are named. */
export function dayOf(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** A file-name part from a label: lower case, letters and digits, single hyphens. */
export function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'run'
  );
}

export interface CrashSummary {
  readonly iterations?: number;
  readonly failures?: readonly unknown[];
  readonly fail_points_reached?: number;
  readonly hostile_holds?: number;
}

export function crashVerdict(summary: CrashSummary): { pass: boolean; text: string } {
  const failures = summary.failures?.length ?? 0;
  const text = `${summary.iterations ?? 0} kills, ${failures} ${failures === 1 ? 'failure' : 'failures'}`;
  return { pass: (summary.iterations ?? 0) > 0 && failures <= GATES.crashFailures.max, text };
}
