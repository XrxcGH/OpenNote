// The Palm lab's logic (palm README, "Measurement"): builds a labeled session from a guided recording, probes what the
// device reports, and names the file for tests/fixtures/palm/. The screen is PalmLab.tsx; this file is plain logic so
// it runs in Node tests with fake pointer events.
import { autoLabel, createSessionRecorder, probeCapabilities, TASKS } from '../input/testing/capture';
import type { PointerEventLike, SessionRecorder } from '../input/testing/capture';
import { PROFILES } from '../input/testing/profiles';
import { serializeSession, validateSession } from '../input/testing/session';
import type { Grip, Posture, Session, SessionHeader } from '../input/testing/session';

export const LAB_TASKS = Object.keys(TASKS);

export interface LabSetup {
  readonly profile: string;
  readonly task: string;
  readonly handedness: 'right' | 'left';
  readonly grip: Grip;
  readonly posture: Posture;
  readonly model: string;
  readonly consent: boolean;
}

export const DEFAULT_SETUP: LabSetup = {
  profile: 'surface-pen',
  task: LAB_TASKS[0],
  handedness: 'right',
  grip: 'tripod',
  posture: 'desk',
  model: '',
  consent: false,
};

type Header = Omit<SessionHeader, 'format' | 'version'>;

/** The header for a recording; capabilities start empty and are filled by the probe when the recording stops. */
export function labHeader(setup: LabSetup, env: { dpr: number; w: number; h: number; ua: string }): Header {
  const profile = PROFILES.find((p) => p.id === setup.profile) ?? PROFILES[0];
  const os = /windows/i.test(env.ua)
    ? 'windows'
    : /android/i.test(env.ua)
      ? 'android'
      : /mac|ipad/i.test(env.ua)
        ? 'apple'
        : 'other';
  return {
    device: { os, model: setup.model.trim() || 'unnamed', digitizer: profile.size, penFamily: profile.id },
    profile: profile.id,
    capabilities: { hover: profile.hover, pressureLevels: 0, tiltMode: 'none', sizeMode: profile.size, rateHz: 0 },
    screen: { dpr: env.dpr, cssPxPerMm: profile.cssPxPerMm, refreshHz: 60, w: env.w, h: env.h },
    webview: env.ua.slice(0, 120),
    handedness: setup.handedness,
    grip: setup.grip,
    posture: setup.posture,
    settings: {},
    task: setup.task,
    consent: setup.consent,
  };
}

export interface LabRecording {
  readonly recorder: SessionRecorder;
  /** Feeds one pointer event, and answers how many events have been recorded. */
  feed(e: PointerEventLike): number;
  stop(): LabResult;
}

export interface LabResult {
  readonly session: Session;
  readonly capabilities: SessionHeader['capabilities'];
  readonly problems: string[];
  readonly contacts: { pen: number; touch: number };
}

export function startRecording(header: Header, origin = 0): LabRecording {
  const recorder = createSessionRecorder(header);
  recorder.tool(true, origin);
  let count = 0;
  return {
    recorder,
    feed(e) {
      if (e.pointerType !== 'pen' && e.pointerType !== 'touch' && e.pointerType !== 'mouse') return count;
      recorder.pointer(e, 'page');
      return ++count;
    },
    stop() {
      const raw = recorder.finish();
      const capabilities = probeCapabilities(raw);
      const withCaps: Session = { ...raw, header: { ...raw.header, capabilities } };
      const labeled: Session = { ...withCaps, labels: autoLabel(withCaps) };
      const down = (pt: string) => labeled.events.filter((e) => e.pt === pt && e.type === 'pointerdown').length;
      const problems = validateSession(labeled);
      if (!labeled.header.consent) problems.push('consent is required');
      return { session: labeled, capabilities, problems, contacts: { pen: down('pen'), touch: down('touch') } };
    },
  };
}

/** The file to save under tests/fixtures/palm/: the profile, the task, then a date. */
export function labFileName(session: Session, date = new Date()): string {
  return `${session.header.profile}-${session.header.task}-${date.toISOString().slice(0, 10)}.session.jsonl`;
}

export function labFileText(result: LabResult): string {
  return serializeSession(result.session);
}
