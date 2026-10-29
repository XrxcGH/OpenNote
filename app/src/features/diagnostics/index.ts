// Crash reports, the self-check, the beta feedback file, safe start, and Work offline: the models, the screens
// (loaded on first use), and the start-up that wires them (see README.md). register.ts adds the commands, the
// Settings sections, and the title bar notices.

export { DiagnosticsError } from './client';
export { installDiagnostics, offerSafeStart } from './install';
export { isOffline, isSafeMode, privacyStore, safeModeStore, useOffline, useSafeMode } from './runtime';
export type { DiagnosticsClient, DiagnosticsErrorCode } from './client';
export {
  UNASKED,
  WORDING_VERSION,
  accepted,
  declined,
  openConsent,
  prompt,
  reduceConsent,
  savingAllowed,
} from './consent';
export type { ConsentEvent, ConsentFlow } from './consent';
export {
  CLOSED,
  canSend,
  crashListSummary,
  crashRows,
  reduceReview,
  refusalMessage,
  reportId,
  sendRequest,
} from './crashReview';
export type { CrashRow, Refusal, ReviewEvent, ReviewState } from './crashReview';
export { createFakeDiagnostics, EXAMPLE_REPORT, NORMAL_START, fakeReport, passingSelfCheck } from './fake';
export type { FakeDiagnostics, FakeState } from './fake';
export {
  DEFAULT_OPTIONS,
  canSave,
  openFeedback,
  reduceFeedback,
  removedLine,
  removedTotal,
  saveRequest,
  sectionRows,
} from './feedback';
export type { FeedbackEvent, FeedbackState, SectionRow } from './feedback';
export {
  SAFE_MODE_OFF,
  SAFE_START_AFTER,
  openSafeStart,
  reduceSafeStart,
  safeModeNotice,
  safeModeOffList,
  safeStartAnnouncement,
  safeStartPrompt,
  safeStartText,
  sessionStatsLine,
} from './safeStart';
export type { SafeModeFeature, SafeModeNotice, SafeStartEvent, SafeStartFlow, SafeStartText } from './safeStart';
export { SHOWN_PROBLEMS, STALE_CHECK_DAYS, formatBytes, selfCheckRow, selfCheckView } from './selfCheck';
export type { SelfCheckRow, SelfCheckView } from './selfCheck';
export type * from './types';
