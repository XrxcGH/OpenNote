import { describe, expect, it } from 'vitest';
import { autoLabel, createSessionRecorder, probeCapabilities } from './capture';
import type { PointerEventLike } from './capture';
import { profileById } from './profiles';
import { replaySession } from './replay';
import { generate, SCENARIOS } from './scenarios';
import { parseSession, serializeSession, validateSession } from './session';

const header = {
  device: { os: 'windows', model: 'Surface Laptop Studio 2', digitizer: 'real', penFamily: 'surface-pen' },
  profile: 'surface-pen',
  capabilities: {
    hover: 'short' as const,
    pressureLevels: 4096,
    tiltMode: 'degrees' as const,
    sizeMode: 'real' as const,
    rateHz: 240,
  },
  screen: { dpr: 1.5, cssPxPerMm: 5.28, refreshHz: 120, w: 1600, h: 1000 },
  webview: 'WebView2 140',
  handedness: 'right' as const,
  grip: 'tripod' as const,
  posture: 'desk' as const,
  settings: {},
  task: 'write-resting',
  consent: true,
};

const ev = (
  type: string,
  pointerType: string,
  pointerId: number,
  t: number,
  x: number,
  extra: Partial<PointerEventLike> = {},
): PointerEventLike => ({
  type,
  pointerType,
  pointerId,
  timeStamp: t,
  clientX: x,
  clientY: 300,
  width: pointerType === 'touch' ? 200 : 1,
  height: pointerType === 'touch' ? 150 : 1,
  pressure: pointerType === 'pen' ? 0.4 : 0,
  tiltX: pointerType === 'pen' ? 20 : 0,
  tiltY: pointerType === 'pen' ? 25 : 0,
  buttons: type === 'pointerup' ? 0 : 1,
  ...extra,
});

describe('the session recorder', () => {
  it('records pointer, system, and hint events with coalesced samples, and labels them from the task', () => {
    const rec = createSessionRecorder(header);
    rec.tool(true, 0);
    rec.pointer(ev('pointermove', 'pen', 1, 5, 500, { buttons: 0 }), 'page');
    rec.pointer(ev('pointerdown', 'pen', 1, 10, 500), 'page');
    rec.pointer(ev('pointerdown', 'touch', 7, 12, 700), 'page');
    const batch = [ev('pointermove', 'pen', 1, 14, 501), ev('pointermove', 'pen', 1, 18, 502)];
    rec.pointer({ ...batch[1], getCoalescedEvents: () => batch }, 'page');
    rec.native('palm', 20, 700, 300);
    rec.pointer(ev('pointerup', 'pen', 1, 30, 503), 'page');
    rec.pointer(ev('pointerup', 'touch', 7, 40, 700), 'page');
    rec.blur(50);
    const session = rec.finish();
    expect(validateSession(session)).toEqual([]);
    expect(session.events.find((e) => e.type === 'pointermove' && e.bs === 1)?.co).toHaveLength(1);
    expect(autoLabel(session).map((l) => `${l.id} ${l.cls} ${l.intent}`)).toEqual(['1 pen ink', '7 palm none']);
    expect(parseSession(serializeSession(session))).toEqual(session);
    expect(probeCapabilities(session)).toMatchObject({ hover: 'short', tiltMode: 'degrees', sizeMode: 'real' });
  });

  it('replays a recording of a generated session to the same outcome', () => {
    const session = generate(SCENARIOS[0], profileById('surface-pen'), 3);
    const again = parseSession(serializeSession(session));
    const a = replaySession(session);
    const b = replaySession(again);
    expect([...b.contacts.values()]).toEqual([...a.contacts.values()]);
  });
});
