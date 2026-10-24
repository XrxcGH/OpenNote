import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS,
  canSave,
  openFeedback,
  reduceFeedback,
  removedLine,
  removedTotal,
  saveRequest,
  sectionRows,
} from './feedback';
import type { FeedbackEvent, FeedbackState } from './feedback';
import type { Bundle, BundleReview, Redactions } from './types';

const NONE: Redactions = { paths: 0, quoted: 0, links: 0, emails: 0, ids: 0, tokens: 0, names: 0, private: 0 };

const bundle: Bundle = {
  createdUnix: 1_790_000_000,
  redactions: { ...NONE, paths: 2, ids: 1 },
  sections: [
    { id: 'system', title: 'System', body: 'OpenNote: 1.0.0\n', redactions: NONE, items: 14 },
    { id: 'selfCheck', title: 'Self-check', body: 'Overall: pass\n', redactions: NONE, items: 7 },
    { id: 'logs', title: 'Recent log lines', body: '', redactions: { ...NONE, paths: 2, ids: 1 }, items: 312 },
  ],
};

const review: BundleReview = {
  text: 'OpenNote feedback bundle\n',
  digest: 'f00d',
  suggestedFileName: 'OpenNote-feedback.txt',
};

function run(...events: FeedbackEvent[]): FeedbackState {
  return events.reduce(reduceFeedback, openFeedback());
}

const toReview = [
  { type: 'change', options: { description: 'It crashed.' } },
  { type: 'review' },
  { type: 'built', review, bundle },
] satisfies FeedbackEvent[];

describe('the form', () => {
  it('starts with logs on and crash reports off, so crash reports are the person to choose', () => {
    expect(DEFAULT_OPTIONS).toEqual({ description: '', includeLogs: true, includeCrashReports: false });
    expect(openFeedback()).toEqual({ step: 'edit', options: DEFAULT_OPTIONS });
    expect(openFeedback({ includeLogs: false })).toEqual({
      step: 'edit',
      options: { ...DEFAULT_OPTIONS, includeLogs: false },
    });
  });

  it('keeps what the person types and chooses', () => {
    const state = run(
      { type: 'change', options: { description: 'It crashed.' } },
      { type: 'change', options: { includeCrashReports: true } },
    );
    expect(state).toEqual({
      step: 'edit',
      options: { description: 'It crashed.', includeLogs: true, includeCrashReports: true },
    });
  });
});

describe('the steps to a saved file', () => {
  it('builds the file, shows all of it, and only then offers Save', () => {
    const building = run({ type: 'review' });
    expect(building.step).toBe('building');
    expect(canSave(building)).toBe(false);
    const reviewing = run(...toReview);
    expect(reviewing.step).toBe('review');
    expect(canSave(reviewing)).toBe(true);
    expect(saveRequest(reviewing)).toBeNull();
  });

  it('saves with the digest of the text that was shown', () => {
    const saving = run(...toReview, { type: 'save' });
    expect(saving.step).toBe('saving');
    expect(saveRequest(saving)).toEqual({ digest: 'f00d' });
    expect(canSave(saving)).toBe(false);
    expect(run(...toReview, { type: 'save' }, { type: 'saved', name: 'OpenNote-feedback.txt' })).toEqual({
      step: 'saved',
      name: 'OpenNote-feedback.txt',
    });
  });

  it('keeps the text on screen after a failed save, and saves again from there', () => {
    const failed = run(...toReview, { type: 'save' }, { type: 'saveFailed' });
    expect(failed.step).toBe('failed');
    expect(canSave(failed)).toBe(true);
    expect(reduceFeedback(failed, { type: 'save' }).step).toBe('saving');
  });

  it('goes back to the form to change a choice, which builds a new file', () => {
    const back = run(...toReview, { type: 'back' });
    expect(back).toEqual({
      step: 'edit',
      options: { description: 'It crashed.', includeLogs: true, includeCrashReports: false },
    });
    expect(run(...toReview, { type: 'back' }, { type: 'review' }).step).toBe('building');
  });

  it('returns to the form if building fails', () => {
    expect(run({ type: 'review' }, { type: 'buildFailed' }).step).toBe('edit');
  });

  it('cannot be edited, built, or saved from the wrong step', () => {
    const reviewing = run(...toReview);
    expect(reduceFeedback(reviewing, { type: 'change', options: { description: 'changed' } })).toBe(reviewing);
    const edit = openFeedback();
    expect(reduceFeedback(edit, { type: 'save' })).toBe(edit);
    expect(reduceFeedback(edit, { type: 'built', review, bundle })).toBe(edit);
    expect(reduceFeedback(edit, { type: 'saved', name: 'x' })).toBe(edit);
  });

  it('does not close while a save is under way', () => {
    const saving = run(...toReview, { type: 'save' });
    expect(reduceFeedback(saving, { type: 'close' })).toBe(saving);
    expect(reduceFeedback(reviewingState(), { type: 'close' })).toEqual({ step: 'closed' });
  });
});

function reviewingState(): FeedbackState {
  return run(...toReview);
}

describe('the review', () => {
  it('lists each part with what it holds, and says which optional parts are left out', () => {
    expect(sectionRows(bundle).map((r) => [r.id, r.count, r.included])).toEqual([
      ['system', '14 lines', true],
      ['selfCheck', '7 checks', true],
      ['logs', '312 lines', true],
      ['crashReports', 'Not included', false],
    ]);
    const withNote: Bundle = {
      ...bundle,
      sections: [
        { id: 'description', title: 'x', body: 'y', redactions: NONE, items: 1 },
        ...bundle.sections.slice(0, 2),
      ],
    };
    expect(sectionRows(withNote).map((r) => r.id)).toEqual([
      'description',
      'system',
      'selfCheck',
      'logs',
      'crashReports',
    ]);
    expect(sectionRows(withNote)[0]?.count).toBe('1 character');
  });

  it('says how much was removed', () => {
    expect(removedTotal(bundle.redactions)).toBe(3);
    expect(removedLine(bundle.redactions)).toBe('3 things were removed and replaced by marks such as <path>.');
    expect(removedLine({ ...NONE, tokens: 1 })).toBe('1 thing was removed and replaced by marks such as <path>.');
    expect(removedLine(NONE)).toBe('Nothing needed to be removed.');
  });
});
