// The beta feedback file: what the person can choose, how the review reads, and the steps from the form to the
// saved file. The file is built on this computer by crates/diagnostics. The person reads all of it, and the host
// saves it only when given the digest of the text that was shown. Nothing here sends anything. The person attaches
// the saved file to a report or an email themselves.

import { t } from '../../strings/t';
import type { Bundle, BundleOptions, BundleReview, Redactions, SectionId } from './types';

export const DEFAULT_OPTIONS: BundleOptions = {
  description: '',
  includeLogs: true,
  // Crash reports are included only when the person chooses.
  includeCrashReports: false,
};

/** The form: the person's own words, and what else goes in. */
export type FeedbackState =
  | { readonly step: 'edit'; readonly options: BundleOptions }
  | { readonly step: 'building'; readonly options: BundleOptions }
  /** The whole text is on screen. Save is available. */
  | { readonly step: 'review'; readonly options: BundleOptions; readonly review: BundleReview; readonly bundle: Bundle }
  | { readonly step: 'saving'; readonly options: BundleOptions; readonly review: BundleReview; readonly bundle: Bundle }
  | { readonly step: 'saved'; readonly name: string }
  | { readonly step: 'failed'; readonly options: BundleOptions; readonly review: BundleReview; readonly bundle: Bundle }
  | { readonly step: 'closed' };

export type FeedbackEvent =
  | { type: 'change'; options: Partial<BundleOptions> }
  | { type: 'review' }
  | { type: 'built'; review: BundleReview; bundle: Bundle }
  | { type: 'buildFailed' }
  | { type: 'back' }
  | { type: 'save' }
  | { type: 'saved'; name: string }
  | { type: 'saveFailed' }
  /** The person closed the folder picker. The text stays on screen, and nothing was saved. */
  | { type: 'saveCanceled' }
  | { type: 'close' };

export function openFeedback(options: Partial<BundleOptions> = {}): FeedbackState {
  return { step: 'edit', options: { ...DEFAULT_OPTIONS, ...options } };
}

/** The next state. An event that does not fit the current state changes nothing. */
export function reduceFeedback(state: FeedbackState, event: FeedbackEvent): FeedbackState {
  switch (event.type) {
    case 'change':
      return state.step === 'edit' ? { step: 'edit', options: { ...state.options, ...event.options } } : state;
    case 'review':
      return state.step === 'edit' ? { step: 'building', options: state.options } : state;
    case 'built':
      return state.step === 'building'
        ? { step: 'review', options: state.options, review: event.review, bundle: event.bundle }
        : state;
    case 'buildFailed':
      return state.step === 'building' ? { step: 'edit', options: state.options } : state;
    case 'back':
      return state.step === 'review' || state.step === 'failed' ? { step: 'edit', options: state.options } : state;
    case 'save':
      return state.step === 'review' || state.step === 'failed'
        ? { step: 'saving', options: state.options, review: state.review, bundle: state.bundle }
        : state;
    case 'saved':
      return state.step === 'saving' ? { step: 'saved', name: event.name } : state;
    case 'saveFailed':
      return state.step === 'saving'
        ? { step: 'failed', options: state.options, review: state.review, bundle: state.bundle }
        : state;
    case 'saveCanceled':
      return state.step === 'saving'
        ? { step: 'review', options: state.options, review: state.review, bundle: state.bundle }
        : state;
    case 'close':
      // A save in progress cannot be closed away.
      return state.step === 'saving' ? state : { step: 'closed' };
  }
}

/** Whether Save is available: all the text is on screen and nothing is being saved. */
export function canSave(state: FeedbackState): boolean {
  return state.step === 'review' || state.step === 'failed';
}

/** What to pass to the host's save command after a 'save' event: the digest of the text that was shown. */
export function saveRequest(state: FeedbackState): { digest: string } | null {
  return state.step === 'saving' ? { digest: state.review.digest } : null;
}

export interface SectionRow {
  id: SectionId;
  title: string;
  /** "312 lines", or "Not included". */
  count: string;
  included: boolean;
}

const COUNT_KEYS = {
  description: 'diagnostics.feedback.sectionCount.description',
  system: 'diagnostics.feedback.sectionCount.system',
  selfCheck: 'diagnostics.feedback.sectionCount.selfCheck',
  logs: 'diagnostics.feedback.sectionCount.logs',
  crashReports: 'diagnostics.feedback.sectionCount.crashReports',
} as const;

const TITLE_KEYS = {
  description: 'diagnostics.feedback.section.description',
  system: 'diagnostics.feedback.section.system',
  selfCheck: 'diagnostics.feedback.section.selfCheck',
  logs: 'diagnostics.feedback.section.logs',
  crashReports: 'diagnostics.feedback.section.crashReports',
} as const;

/** The parts the file can hold, in the order they appear, with what each holds or that it is left out. */
export function sectionRows(bundle: Bundle): SectionRow[] {
  const order: SectionId[] = ['description', 'system', 'selfCheck', 'logs', 'crashReports'];
  return order
    .map((id): SectionRow | null => {
      const section = bundle.sections.find((s) => s.id === id);
      if (section)
        return { id, title: t(TITLE_KEYS[id]), count: t(COUNT_KEYS[id], { count: section.items }), included: true };
      // The description and the self-check are left out quietly when empty. The two optional parts say so.
      return id === 'logs' || id === 'crashReports'
        ? { id, title: t(TITLE_KEYS[id]), count: t('diagnostics.feedback.notIncluded'), included: false }
        : null;
    })
    .filter((row): row is SectionRow => row !== null);
}

/** How many things were removed in all. */
export function removedTotal(redactions: Redactions): number {
  return Object.values(redactions).reduce((sum, count) => sum + count, 0);
}

/** "3 things were removed and replaced by marks such as <path>.", or that nothing needed removing. */
export function removedLine(redactions: Redactions): string {
  const count = removedTotal(redactions);
  return count === 0 ? t('diagnostics.feedback.removedNothing') : t('diagnostics.feedback.removed', { count });
}
