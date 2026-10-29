// The saved crash reports: the list, and the steps from reading one to sending it. A report leaves the computer
// only through these steps: prepare it, show all of its text, and send it with the digest of the text that was
// shown. The Rust side refuses a digest of anything else (crates/crashreport/src/send.rs), and this reducer never
// offers a send from a state where the text was not shown. Nothing here sends by itself, and nothing is sent
// without the person pressing Send on a report they have in front of them.

import { t } from '../../strings/t';
import { formatDate, formatTime } from '../../strings/format';
import type { CrashSummary, PendingSend } from './types';

/** Why a report cannot be prepared for sending. */
export type Refusal = 'notOptedIn' | 'noAddress' | 'missing';

export type ReviewState =
  | { readonly step: 'closed' }
  | { readonly step: 'loading'; readonly id: string }
  /** The text is on screen. Send is available. */
  | { readonly step: 'reviewing'; readonly pending: PendingSend }
  | { readonly step: 'blocked'; readonly id: string; readonly reason: Refusal }
  | { readonly step: 'sending'; readonly pending: PendingSend }
  | { readonly step: 'sent'; readonly id: string }
  /** The send failed. The report is still saved, and the text is still on screen to send again. */
  | { readonly step: 'failed'; readonly pending: PendingSend };

export type ReviewEvent =
  | { type: 'open'; id: string }
  | { type: 'prepared'; pending: PendingSend }
  | { type: 'refused'; reason: Refusal }
  | { type: 'send' }
  | { type: 'sent' }
  | { type: 'failed' }
  | { type: 'close' };

export const CLOSED: ReviewState = { step: 'closed' };

/** The id of the report a state is about. */
export function reportId(state: ReviewState): string | null {
  switch (state.step) {
    case 'closed':
      return null;
    case 'loading':
    case 'blocked':
    case 'sent':
      return state.id;
    case 'reviewing':
    case 'sending':
    case 'failed':
      return state.pending.id;
  }
}

/** The next state. An event that does not fit the current state changes nothing. */
export function reduceReview(state: ReviewState, event: ReviewEvent): ReviewState {
  switch (event.type) {
    case 'open':
      return state.step === 'sending' ? state : { step: 'loading', id: event.id };
    case 'prepared':
      return state.step === 'loading' && state.id === event.pending.id
        ? { step: 'reviewing', pending: event.pending }
        : state;
    case 'refused':
      return state.step === 'loading' ? { step: 'blocked', id: state.id, reason: event.reason } : state;
    case 'send':
      return state.step === 'reviewing' || state.step === 'failed'
        ? { step: 'sending', pending: state.pending }
        : state;
    case 'sent':
      return state.step === 'sending' ? { step: 'sent', id: state.pending.id } : state;
    case 'failed':
      return state.step === 'sending' ? { step: 'failed', pending: state.pending } : state;
    case 'close':
      // A send in progress cannot be closed away, so the person never loses track of whether it went out.
      return state.step === 'sending' ? state : CLOSED;
  }
}

/** Whether the Send button is available: the text is on screen and nothing is being sent. */
export function canSend(state: ReviewState): boolean {
  return state.step === 'reviewing' || state.step === 'failed';
}

/**
 * What to pass to the host's send command after a 'send' event: the report and the digest of the text that was
 * shown. `null` unless a send is under way.
 */
export function sendRequest(state: ReviewState): { id: string; digest: string } | null {
  return state.step === 'sending' ? { id: state.pending.id, digest: state.pending.digest } : null;
}

/** The text to show for a refusal. */
export function refusalMessage(reason: Refusal): string {
  switch (reason) {
    case 'notOptedIn':
      return t('diagnostics.crashReports.notOptedIn');
    case 'noAddress':
      return t('diagnostics.crashReports.noAddress');
    case 'missing':
      return t('diagnostics.crashReports.empty');
  }
}

export interface CrashRow {
  id: string;
  /** "Crash on Oct 2, 2026 at 2:05 PM, version 1.0.0-beta.2". */
  label: string;
  /** The size of the file, for a screen reader's description and the row's second line. */
  sizeBytes: number;
}

/** The list rows, newest first as the host returns them. */
export function crashRows(reports: readonly CrashSummary[]): CrashRow[] {
  return reports.map((report) => {
    const iso = new Date(report.time_unix * 1000).toISOString();
    return {
      id: report.id,
      label: t('diagnostics.crashReports.item', {
        kind: report.kind,
        date: formatDate(iso),
        time: formatTime(iso),
        version: report.app_version,
      }),
      sizeBytes: report.size_bytes,
    };
  });
}

/** The line above the list: how many reports are saved, or that none are. */
export function crashListSummary(count: number): string {
  return count === 0 ? t('diagnostics.crashReports.empty') : t('diagnostics.crashReports.saved', { count });
}
