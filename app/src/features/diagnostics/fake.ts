// An in-memory DiagnosticsClient for the web platform, component tests, and Playwright. It keeps the rules of the
// Rust side. Nothing is prepared without a current yes and an address. A report is sent only with the digest of
// the text that was shown, and a feedback file is saved only with the digest of the text that was built.

import { DiagnosticsError } from './client';
import type { DiagnosticsClient } from './client';
import { UNASKED, savingAllowed } from './consent';
import type {
  Bundle,
  BundleOptions,
  BundleReview,
  Consent,
  CrashReport,
  CrashSummary,
  Redactions,
  SelfCheck,
  Startup,
} from './types';

const NO_REDACTIONS: Redactions = { paths: 0, quoted: 0, links: 0, emails: 0, ids: 0, tokens: 0, names: 0, private: 0 };

/** A made-up report in the real format, as `Report::example` builds it in Rust. */
export const EXAMPLE_REPORT: CrashReport = {
  format: 1,
  kind: 'exception',
  app_version: '1.0.0',
  os: 'Windows 10.0.26200 x86_64',
  time_unix: 1_790_000_000,
  message: null,
  location: null,
  exception_code: '0xc0000005',
  frames: [
    {
      module: 'opennote.exe',
      offset: '0x1a2b3c',
      debug_id: '3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71',
      function: 'opennote_core::store::Store::save_page',
    },
    { module: 'opennote.exe', offset: '0x2f40a8', debug_id: '3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71' },
    { module: 'ntdll.dll', offset: '0x9f2c0', debug_id: '8D1C7A5B3E9F4A6C8B2D0E1F3A4B5C6D2' },
  ],
  backtrace: [],
};

/** A start after a clean session: nothing to offer. */
export const NORMAL_START: Startup = {
  report: { previous: 'clean', crashesInARow: 0, offerSafeMode: false, previousWasSafe: false },
  safeMode: false,
  stats: { sessions: 0, clean: 0, crashed: 0 },
};

const MIB = 2 ** 20;
const GIB = 2 ** 30;

/** A self-check in which every one of the seven checks passes. */
export function passingSelfCheck(createdUnix = 1_790_000_000): SelfCheck {
  return {
    createdUnix,
    items: [
      {
        id: 'diskNotebook',
        status: 'pass',
        detail: { kind: 'freeSpace', freeBytes: 120 * GIB, warnBelow: 500 * MIB, failBelow: 50 * MIB },
      },
      {
        id: 'diskApp',
        status: 'pass',
        detail: { kind: 'freeSpace', freeBytes: 120 * GIB, warnBelow: 300 * MIB, failBelow: 50 * MIB },
      },
      { id: 'notebookWritable', status: 'pass', detail: { kind: 'writable', writable: true, reason: null } },
      { id: 'notebookStorage', status: 'pass', detail: { kind: 'storage', fileSystem: 'NTFS', notes: [] } },
      {
        id: 'notebookHealth',
        status: 'pass',
        detail: {
          kind: 'health',
          files: 42,
          problemCount: 0,
          byCode: [],
          problems: [],
          unsavedChanges: false,
          failed: null,
        },
      },
      {
        id: 'updates',
        status: 'pass',
        detail: {
          kind: 'updates',
          lastCheck: null,
          daysSinceCheck: 1,
          stagedVersion: null,
          pending: null,
          rolledBack: null,
          blockedVersions: [],
        },
      },
      { id: 'crashReports', status: 'pass', detail: { kind: 'reports', count: 0 } },
    ],
  };
}

export interface FakeState {
  consent: Consent;
  /** The address reports go to. Empty means none is set. */
  endpoint: string;
  reports: { summary: CrashSummary; report: CrashReport }[];
  selfCheck: SelfCheck;
  /** What start-up learned about the last sessions. enterSafeMode turns on its safeMode. */
  startup: Startup;
  /** Makes the next send fail, as a network error would. */
  failNextSend: boolean;
  /** Makes the next save fail, as a full disk would. */
  failNextSave: boolean;
  /** Work offline. While it is on, a send is refused. */
  workOffline: boolean;
  /** When a report was last sent, in seconds since 1970. */
  reportSentUnix: number | null;
  /** How many times OpenNote was asked to restart. */
  restarts: number;
  /** Makes the next feedback save report that the person closed the folder picker. */
  cancelNextSave: boolean;
}

export interface FakeDiagnostics {
  client: DiagnosticsClient;
  state: FakeState;
  /** Every call, by name, for tests. */
  calls: string[];
  /** The feedback files saved, as the text that was written. */
  saved: string[];
  /** The reports sent, as the text that was sent. */
  sent: string[];
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const json = (report: CrashReport) => `${JSON.stringify(report, null, 2)}\n`;

/** A saved report with an id and a time, for tests. */
export function fakeReport(id: string, timeUnix: number): FakeState['reports'][number] {
  const report: CrashReport = { ...EXAMPLE_REPORT, time_unix: timeUnix };
  const summary: CrashSummary = {
    id,
    time_unix: timeUnix,
    kind: report.kind,
    app_version: report.app_version,
    size_bytes: json(report).length,
  };
  return { summary, report };
}

/** The parts of a feedback file for these options, in the order the Rust side puts them. */
function bundleSections(state: FakeState, options: BundleOptions): Bundle['sections'] {
  const note = options.description.trim();
  const sections: Bundle['sections'] = [];
  const add = (id: Bundle['sections'][number]['id'], title: string, body: string, items: number) =>
    sections.push({ id, title, body, items, redactions: NO_REDACTIONS });
  if (note) add('description', 'What you wrote', note, note.length);
  add('system', 'System', 'OpenNote: 1.0.0\n', 1);
  add('selfCheck', 'Self-check', 'Overall: pass\n', state.selfCheck.items.length);
  if (options.includeLogs) add('logs', 'Recent log lines', 'No log files were found.', 0);
  if (options.includeCrashReports) {
    const newest = state.reports.slice(0, 3);
    const body = newest.map((r) => `-- ${r.summary.id}\n${json(r.report)}`).join('\n');
    add('crashReports', 'Crash reports', body || 'There are no saved crash reports.', newest.length);
  }
  return sections;
}

/** The text of a feedback file, and its fingerprint. */
async function reviewOf(sections: Bundle['sections']): Promise<BundleReview> {
  const text = `OpenNote feedback bundle\n${sections.map((s) => `\n=== ${s.title} ===\n${s.body}\n`).join('')}`;
  return { text, digest: await sha256(text), suggestedFileName: 'OpenNote-feedback-2026-09-21-14-13-20.txt' };
}

/** The consent and report calls. */
function reportCalls(state: FakeState, calls: string[], sent: string[]): Partial<DiagnosticsClient> {
  const find = (id: string) => state.reports.find((r) => r.summary.id === id);
  return {
    async consent() {
      calls.push('consent');
      return state.consent;
    },
    async setConsent(consent) {
      calls.push('setConsent');
      state.consent = consent;
    },
    async exampleReport() {
      calls.push('exampleReport');
      return EXAMPLE_REPORT;
    },
    async listReports() {
      calls.push('listReports');
      return state.reports.map((r) => r.summary).sort((a, b) => b.time_unix - a.time_unix);
    },
    async prepareReport(id) {
      calls.push('prepareReport');
      if (!savingAllowed(state.consent)) throw new DiagnosticsError('notOptedIn');
      if (!state.endpoint.trim()) throw new DiagnosticsError('noAddress');
      const found = find(id);
      if (!found) throw new DiagnosticsError('missing');
      const payload = json(found.report);
      return { id, endpoint: state.endpoint, payload, digest: await sha256(payload) };
    },
    async sendReport(id, digest) {
      calls.push('sendReport');
      const found = find(id);
      if (!found) throw new DiagnosticsError('missing');
      const payload = json(found.report);
      if (digest !== (await sha256(payload))) throw new DiagnosticsError('notReviewed');
      if (state.workOffline) throw new DiagnosticsError('offline');
      if (state.failNextSend) {
        state.failNextSend = false;
        throw new DiagnosticsError('io');
      }
      sent.push(payload);
      state.reportSentUnix = 1_790_000_100;
    },
    async deleteReport(id) {
      calls.push('deleteReport');
      if (!find(id)) throw new DiagnosticsError('missing');
      state.reports = state.reports.filter((r) => r.summary.id !== id);
    },
    async deleteAllReports() {
      calls.push('deleteAllReports');
      const count = state.reports.length;
      state.reports = [];
      return count;
    },
  };
}

/** The self-check and feedback calls. */
function feedbackCalls(state: FakeState, calls: string[], saved: string[]): Partial<DiagnosticsClient> {
  let built: BundleReview | null = null;
  return {
    async runSelfCheck() {
      calls.push('runSelfCheck');
      return state.selfCheck;
    },
    async buildFeedback(options) {
      calls.push('buildFeedback');
      const sections = bundleSections(state, options);
      built = await reviewOf(sections);
      return { bundle: { createdUnix: 1_790_000_000, sections, redactions: NO_REDACTIONS }, review: built };
    },
    async saveFeedback(digest) {
      calls.push('saveFeedback');
      if (!built || digest !== built.digest) throw new DiagnosticsError('notReviewed');
      if (state.cancelNextSave) {
        state.cancelNextSave = false;
        throw new DiagnosticsError('canceled');
      }
      if (state.failNextSave) {
        state.failNextSave = false;
        throw new DiagnosticsError('io');
      }
      saved.push(built.text);
      return { name: built.suggestedFileName };
    },
  };
}

/** The start-up and safe mode calls. */
function startCalls(state: FakeState, calls: string[]): Partial<DiagnosticsClient> {
  return {
    async startup() {
      calls.push('startup');
      return state.startup;
    },
    async enterSafeMode() {
      calls.push('enterSafeMode');
      state.startup = { ...state.startup, safeMode: true };
    },
    async restart() {
      calls.push('restart');
      state.restarts += 1;
    },
    async privacy() {
      calls.push('privacy');
      return { workOffline: state.workOffline, reportEndpoint: state.endpoint, reportSentUnix: state.reportSentUnix };
    },
    async setWorkOffline(offline) {
      calls.push('setWorkOffline');
      state.workOffline = offline;
    },
  };
}

export function createFakeDiagnostics(initial: Partial<FakeState> = {}): FakeDiagnostics {
  const state: FakeState = {
    consent: UNASKED,
    endpoint: '',
    reports: [],
    selfCheck: passingSelfCheck(),
    startup: NORMAL_START,
    failNextSend: false,
    failNextSave: false,
    workOffline: false,
    reportSentUnix: null,
    restarts: 0,
    cancelNextSave: false,
    ...initial,
  };
  const calls: string[] = [];
  const saved: string[] = [];
  const sent: string[] = [];
  const client = {
    ...reportCalls(state, calls, sent),
    ...feedbackCalls(state, calls, saved),
    ...startCalls(state, calls),
  } as DiagnosticsClient;
  return { client, state, calls, saved, sent };
}
