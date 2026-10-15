import { describe, expect, it } from 'vitest';
import { parseSession, validateSession } from '../input/testing/session';
import { DEFAULT_SETUP, labFileName, labFileText, labHeader, startRecording } from './labRecorder';
import type { PointerEventLike } from '../input/testing/capture';

const env = { dpr: 1.5, w: 1600, h: 1000, ua: 'Mozilla/5.0 (Windows NT 10.0) WebView2' };
const ev = (type: string, pt: string, id: number, t: number, x: number): PointerEventLike => ({
  type,
  pointerType: pt,
  pointerId: id,
  timeStamp: t,
  clientX: x,
  clientY: 300,
  width: pt === 'touch' ? 200 : 1,
  height: pt === 'touch' ? 150 : 1,
  pressure: pt === 'pen' ? 0.4 : 0,
  buttons: type === 'pointerup' ? 0 : 1,
});

describe('the Palm lab', () => {
  it('records a pen and a palm, labels them from the step, and round-trips the file', () => {
    const rec = startRecording(labHeader({ ...DEFAULT_SETUP, model: 'Test tablet', consent: true }, env));
    rec.feed(ev('pointerdown', 'touch', 7, 5, 700));
    rec.feed(ev('pointerdown', 'pen', 1, 10, 500));
    rec.feed(ev('pointermove', 'pen', 1, 20, 520));
    rec.feed(ev('pointerup', 'pen', 1, 30, 540));
    rec.feed(ev('pointerup', 'touch', 7, 40, 700));
    expect(rec.feed({ ...ev('wheel', 'x', 9, 50, 1), pointerType: 'x' })).toBe(5);
    const out = rec.stop();
    expect(out.problems).toEqual([]);
    expect(out.contacts).toEqual({ pen: 1, touch: 1 });
    expect(out.session.labels.find((l) => l.id === 7)?.cls).toBe('palm');
    const text = labFileText(out);
    expect(validateSession(parseSession(text))).toEqual([]);
    expect(labFileName(out.session, new Date('2026-01-02T00:00:00Z'))).toBe(
      'surface-pen-write-resting-2026-01-02.session.jsonl',
    );
  });

  it('refuses to export without consent', () => {
    const rec = startRecording(labHeader(DEFAULT_SETUP, env));
    rec.feed(ev('pointerdown', 'pen', 1, 10, 500));
    expect(rec.stop().problems).toContain('consent is required');
  });
});
