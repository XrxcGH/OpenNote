// The data the Rust side sends for crash reports, the self-check, and the feedback file. The shapes are the JSON
// that crates/crashreport and crates/diagnostics write, with camelCase names where the Rust types say so. A
// contract test (contract.test.ts) reads fixtures that the Rust tests check, so a change on either side that
// breaks the other fails a test.

/** What the person chose on the consent screen. A value this version does not know is read as 'unasked'. */
export type Decision = 'unasked' | 'declined' | 'accepted';

export interface Consent {
  decision: Decision;
  /** The consent wording the decision was made under, or 0 before a decision. */
  wordingVersion: number;
  /** When they decided, in seconds since 1970 (UTC). */
  decidedUnix: number | null;
}

/** Why the consent screen should show: never asked, or asked under older wording. */
export type ConsentPrompt = 'none' | 'first' | 'reworded';

export type ReportKind = 'panic' | 'exception';

/** One saved crash report in the list. */
export interface CrashSummary {
  id: string;
  time_unix: number;
  kind: ReportKind;
  app_version: string;
  size_bytes: number;
}

/** One place in the code, as a module and an offset into it. */
export interface CrashFrame {
  module: string;
  offset: string;
  debug_id?: string;
  function?: string;
}

/** A crash report as saved, shown, and sent. It holds no note content, paths, or names. */
export interface CrashReport {
  format: number;
  kind: ReportKind;
  app_version: string;
  os: string;
  time_unix: number;
  message: string | null;
  location: string | null;
  exception_code: string | null;
  frames: CrashFrame[];
  backtrace: string[];
}

/** A report ready for the person to read: the exact text that would be sent, and its fingerprint. */
export interface PendingSend {
  id: string;
  /** Where it would go. */
  endpoint: string;
  /** Exactly what would be sent. Show all of it. */
  payload: string;
  /** Pass this back to send, to show that this text was the text reviewed. */
  digest: string;
}

/** How a check came out. 'skipped' means there was nothing to look at. */
export type Status = 'skipped' | 'pass' | 'warn' | 'fail';

export type CheckId =
  'diskNotebook' | 'diskApp' | 'notebookWritable' | 'notebookStorage' | 'notebookHealth' | 'updates' | 'crashReports';

export type SyncName = 'oneDrive' | 'dropbox' | 'googleDrive' | 'iCloud' | 'other';

export type StorageNote = 'networkShare' | 'noMetadataLog' | { syncFolder: SyncName };

export interface Problem {
  code: string;
  /** The file, relative to the notebook. Empty in the copy that is shared. */
  file: string;
}

export interface CodeCount {
  code: string;
  count: number;
}

export interface PendingUpdate {
  version: string;
  from: string;
  attempts: number;
}

export interface RolledBack {
  from: string;
  to: string;
  at: string;
}

/** The numbers behind a check. */
export type Detail =
  | { kind: 'notApplicable' }
  | { kind: 'freeSpace'; freeBytes: number; warnBelow: number; failBelow: number }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'writable'; writable: boolean; reason: string | null }
  | { kind: 'storage'; fileSystem: string; notes: StorageNote[] }
  | {
      kind: 'health';
      files: number;
      problemCount: number;
      byCode: CodeCount[];
      problems: Problem[];
      unsavedChanges: boolean;
      failed: string | null;
    }
  | {
      kind: 'updates';
      lastCheck: string | null;
      daysSinceCheck: number | null;
      stagedVersion: string | null;
      pending: PendingUpdate | null;
      rolledBack: RolledBack | null;
      blockedVersions: string[];
    }
  | { kind: 'reports'; count: number };

export interface CheckItem {
  id: CheckId;
  status: Status;
  detail: Detail;
}

export interface SelfCheck {
  /** When the check ran, in seconds since 1970 (UTC). */
  createdUnix: number;
  items: CheckItem[];
}

/** What a scrub removed, by kind. */
export interface Redactions {
  paths: number;
  quoted: number;
  links: number;
  emails: number;
  ids: number;
  tokens: number;
  names: number;
  private: number;
}

export type SectionId = 'description' | 'system' | 'selfCheck' | 'logs' | 'crashReports';

export interface BundleSection {
  id: SectionId;
  title: string;
  body: string;
  redactions: Redactions;
  /** How many items the body holds: characters, lines, checks, or reports. */
  items: number;
}

export interface Bundle {
  createdUnix: number;
  sections: BundleSection[];
  redactions: Redactions;
}

/** What goes in the feedback file. */
export interface BundleOptions {
  description: string;
  includeLogs: boolean;
  includeCrashReports: boolean;
  logBudgetBytes?: number;
}

/** The feedback file as the person reviews it: the exact text and its fingerprint. */
export interface BundleReview {
  text: string;
  digest: string;
  suggestedFileName: string;
}

/** How the session before this one ended. */
export type PreviousEnd = 'first' | 'clean' | 'crashed';

/** What start-up learned from the session record (crates/diagnostics, sessions). */
export interface StartReport {
  previous: PreviousEnd;
  /** Sessions in a row that ended in a crash, counting the one just found, if any. */
  crashesInARow: number;
  /** Whether to offer "Start in safe mode" before the notebook opens. */
  offerSafeMode: boolean;
  /** Whether the crashed session had been started in safe mode. */
  previousWasSafe: boolean;
}

/** How the recent sessions ended, the newest 50 at most. */
export interface SessionStats {
  sessions: number;
  clean: number;
  crashed: number;
}

/** The start-up state the screens need: the report, whether this session is in safe mode, and the counts. */
export interface Startup {
  report: StartReport;
  safeMode: boolean;
  stats: SessionStats;
}

/** The privacy choices the host keeps (Settings, then Privacy). */
export interface PrivacyState {
  workOffline: boolean;
  /** Where a saved crash report may be sent. Empty means nowhere, so a report can only stay on this computer. */
  reportEndpoint: string;
  /** When a crash report was last sent, in seconds since 1970, or null. */
  reportSentUnix: number | null;
}

/** What only the interface knows about itself, for the feedback file's system summary. */
export interface UiFacts {
  locale: string | null;
  displayScalePercent: number | null;
  textSizePercent: number | null;
  theme: string | null;
  density: string | null;
  enabledFlags: string[];
}
