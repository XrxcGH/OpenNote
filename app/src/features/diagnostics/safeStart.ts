// Safe start after crashes: the offer at start-up, the notice while safe mode is on, and the line that counts recent
// sessions. The Rust side (crates/diagnostics, sessions) keeps the record and decides when to offer: after two
// crashes in a row. These functions only turn its report into the dialog's state and sentences. The screens are
// described in README.md. They are pure, so the dialog can keep its state in a reducer or in the app's store.

import { t } from '../../strings/t';
import type { SessionStats, StartReport } from './types';

/** What safe mode turns off, in the order the dialog and the notice list them. */
export const SAFE_MODE_OFF = ['backgroundWork', 'embeds', 'onDeviceModels'] as const;
export type SafeModeFeature = (typeof SAFE_MODE_OFF)[number];

/** Crashes in a row after which the offer is made. The same number as `SAFE_START_AFTER` in Rust. */
export const SAFE_START_AFTER = 2;

/**
 * Whether to offer safe mode before the notebook opens. 'offerAgain' is the offer after a crash that happened in
 * safe mode, when safe mode did not help and the dialog says so.
 */
export function safeStartPrompt(report: StartReport): 'none' | 'offer' | 'offerAgain' {
  if (!report.offerSafeMode) return 'none';
  return report.previousWasSafe ? 'offerAgain' : 'offer';
}

/** The offer's state while the dialog is open. */
export interface SafeStartFlow {
  readonly reason: 'offer' | 'offerAgain';
  readonly crashesInARow: number;
  /** Whether the person has chosen. The dialog then closes. */
  readonly closed: boolean;
  /** The choice, or null while the dialog is open. */
  readonly result: 'safe' | 'normal' | null;
}

/** The dialog's first state, or null when no offer is due. */
export function openSafeStart(report: StartReport): SafeStartFlow | null {
  const reason = safeStartPrompt(report);
  if (reason === 'none') return null;
  return { reason, crashesInARow: report.crashesInARow, closed: false, result: null };
}

export type SafeStartEvent =
  | { type: 'startSafe' }
  | { type: 'startNormal' }
  /** Escape or closing the dialog. It is "Start normally": nothing is turned off unless the person asks. */
  | { type: 'dismiss' };

/** One step of the dialog. A choice is final: later events change nothing. */
export function reduceSafeStart(flow: SafeStartFlow, event: SafeStartEvent): SafeStartFlow {
  if (flow.closed) return flow;
  const result = event.type === 'startSafe' ? 'safe' : 'normal';
  return { ...flow, closed: true, result };
}

/** What the person hears when they choose. */
export function safeStartAnnouncement(result: 'safe' | 'normal'): string {
  return t(result === 'safe' ? 'diagnostics.safeStart.announceSafe' : 'diagnostics.safeStart.announceNormal');
}

/** The names of the things safe mode turns off, as full phrases. */
export function safeModeOffList(): string[] {
  return SAFE_MODE_OFF.map((feature) => t(`diagnostics.safeStart.off.${feature}`));
}

export interface SafeStartText {
  title: string;
  /** Two short paragraphs. */
  intro: string[];
  offHeading: string;
  off: string[];
  kept: string;
  startSafe: string;
  startNormal: string;
}

/** The dialog's words. */
export function safeStartText(flow: SafeStartFlow): SafeStartText {
  const again = flow.reason === 'offerAgain';
  return {
    title: t(again ? 'diagnostics.safeStart.titleAgain' : 'diagnostics.safeStart.title'),
    intro: again
      ? [t('diagnostics.safeStart.introAgain'), t('diagnostics.safeStart.introAgainAdvice')]
      : [t('diagnostics.safeStart.intro', { count: flow.crashesInARow }), t('diagnostics.safeStart.introSafe')],
    offHeading: t('diagnostics.safeStart.offHeading'),
    off: safeModeOffList(),
    kept: t('diagnostics.safeStart.kept'),
    startSafe: t('diagnostics.safeStart.startSafe'),
    startNormal: t('diagnostics.safeStart.startNormal'),
  };
}

export interface SafeModeNotice {
  title: string;
  body: string;
  offHeading: string;
  off: string[];
  restart: string;
  restartButton: string;
}

/**
 * The notice that stays on screen while the session is in safe mode: what is off and how to turn it back on. It is
 * null in a normal session. The notice is text, not only a color, an icon, or a badge, so a screen reader finds it.
 */
export function safeModeNotice(safeMode: boolean): SafeModeNotice | null {
  if (!safeMode) return null;
  return {
    title: t('diagnostics.safeStart.notice.title'),
    body: t('diagnostics.safeStart.notice.body'),
    offHeading: t('diagnostics.safeStart.notice.offHeading'),
    off: safeModeOffList(),
    restart: t('diagnostics.safeStart.notice.restart'),
    restartButton: t('diagnostics.safeStart.notice.restartButton'),
  };
}

/** "9 of the last 10 sessions ended without a crash." for the self-check and the Privacy panel. */
export function sessionStatsLine(stats: SessionStats): string {
  if (stats.sessions === 0) return t('diagnostics.safeStart.stats.none');
  if (stats.sessions === 1)
    return t(stats.clean === 1 ? 'diagnostics.safeStart.stats.oneClean' : 'diagnostics.safeStart.stats.oneCrashed');
  return t('diagnostics.safeStart.stats.line', { clean: stats.clean, sessions: stats.sessions });
}
