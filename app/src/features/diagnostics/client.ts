// What the interface needs from the host to show crash reports, the self-check, and the feedback file. It is the
// contract for the Tauri commands that wrap crates/crashreport and crates/diagnostics (see README.md). The web
// platform and the tests use the fake in fake.ts, so the screens can be built and tested before the commands exist.

import type {
  Bundle,
  BundleOptions,
  BundleReview,
  Consent,
  CrashReport,
  CrashSummary,
  PendingSend,
  PrivacyState,
  SelfCheck,
  Startup,
  UiFacts,
} from './types';

/**
 * Why the host refused. 'io' is a failure of the disk or the network, with no detail that could hold private text.
 * 'canceled' is a person closing the folder picker, and 'offline' is Work offline blocking a send.
 */
export type DiagnosticsErrorCode =
  'notOptedIn' | 'noAddress' | 'missing' | 'notReviewed' | 'io' | 'canceled' | 'offline';

export class DiagnosticsError extends Error {
  readonly code: DiagnosticsErrorCode;

  constructor(code: DiagnosticsErrorCode) {
    super(code);
    this.name = 'DiagnosticsError';
    this.code = code;
  }
}

export interface DiagnosticsClient {
  /** The stored consent decision. */
  consent(): Promise<Consent>;
  /** Stores the decision. The host then saves crash reports only while the decision allows it. */
  setConsent(consent: Consent): Promise<void>;
  /** A made-up report in the real format, for the consent screen. */
  exampleReport(): Promise<CrashReport>;
  /** The saved reports, newest first. */
  listReports(): Promise<CrashSummary[]>;
  /** Reads one report for review. Rejects with 'notOptedIn', 'noAddress', or 'missing'. Nothing is sent. */
  prepareReport(id: string): Promise<PendingSend>;
  /** Sends a report the person reviewed. Rejects with 'notReviewed' when the digest is not the one shown. */
  sendReport(id: string, digest: string): Promise<void>;
  deleteReport(id: string): Promise<void>;
  /** Deletes every saved report and returns how many there were. */
  deleteAllReports(): Promise<number>;
  /** Runs the self-check now. */
  runSelfCheck(): Promise<SelfCheck>;
  /**
   * Collects the feedback file and returns the text to review. The host keeps it until it is saved or replaced.
   * `facts` is what only the interface knows, such as the theme. The versions and counts come from the host.
   */
  buildFeedback(options: BundleOptions, facts?: UiFacts): Promise<{ bundle: Bundle; review: BundleReview }>;
  /**
   * Saves the last built file in a folder the person picks. Rejects with 'notReviewed' when the digest is not the
   * one of the text that was built, and with 'canceled' when the person closes the picker. Returns the file name
   * only, never the folder.
   */
  saveFeedback(digest: string): Promise<{ name: string }>;
  /** What start-up learned about the last sessions. The host read the session record once, before this call. */
  startup(): Promise<Startup>;
  /**
   * Starts this session in safe mode: the host turns off background work, embeds, and on-device models, and records
   * that the session is in safe mode. Takes effect for the rest of the session. Starting normally needs no call.
   */
  enterSafeMode(): Promise<void>;
  /** Closes OpenNote and opens it again, so safe mode ends. */
  restart(): Promise<void>;
  /** The privacy choices the Privacy panel shows. */
  privacy(): Promise<PrivacyState>;
  /** Turns Work offline on or off. While it is on, the host makes no network request. */
  setWorkOffline(offline: boolean): Promise<void>;
}
