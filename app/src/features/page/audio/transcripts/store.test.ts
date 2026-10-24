import { describe, expect, it } from 'vitest';
import type { OpenPage } from '../../../../services/pages/types';
import { shownPage } from '../../history/shown';
import type { TranscriptData } from './model';
import { adoptTranscripts, hold, transcriptData } from './store';

const data: TranscriptData = {
  recording: 'rec1',
  language: null,
  summary: '',
  lines: [{ id: 'a', startMs: 0, endMs: 1000, text: 'hello' }],
  speakers: {},
  chapters: [],
  source: 'imported',
} as unknown as TranscriptData;

describe('adopting a page after its transcript was saved', () => {
  it('keeps the transcript the page as opened does not have', () => {
    const page = { id: 'p1', initial: { view: {} }, onFrame: () => () => undefined } as unknown as OpenPage;
    shownPage.set(page);
    hold([data]);
    adoptTranscripts(page);
    expect(transcriptData('rec1')?.lines).toHaveLength(1);
  });
});
