// Loads a tool's words into the strings when the tool first opens, so they stay out of the start-up bundle. The
// keys are typed in strings/en/kitSignals.ts; until a tool's words arrive, nothing shows its words.
import { en } from '../../../../strings/en';
import type { SignalToolWords } from '../../../../strings/en/kitSignals';

type Section = keyof SignalToolWords;

const LOADERS: { [K in Section]: () => Promise<SignalToolWords[K]> } = {
  spectrum: () => import('../../../../strings/en/kitSignals/spectrum').then((m) => m.spectrum),
  systems: () => import('../../../../strings/en/kitSignals/systems').then((m) => m.systems),
  comms: () => import('../../../../strings/en/kitSignals/comms').then((m) => m.comms),
  rf: () => import('../../../../strings/en/kitSignals/rf').then((m) => m.rf),
  filters: () => import('../../../../strings/en/kitSignals/filters').then((m) => m.filters),
  medimaging: () => import('../../../../strings/en/kitSignals/medimaging').then((m) => m.medimaging),
  audio: () => import('../../../../strings/en/kitSignals/audio').then((m) => m.audio),
  images: () => import('../../../../strings/en/kitSignals/images').then((m) => m.images),
  neurodata: () => import('../../../../strings/en/kitSignals/neurodata').then((m) => m.neurodata),
};

/** Which other tools' words a tool reads (the filter designer names the spectrum analyzer's windows). */
const ALSO: Partial<Record<Section, readonly Section[]>> = { filters: ['spectrum'] };

/** The insert menu, error, and step words every tool shares; loaded once, with the first tool. */
let common: Promise<void> | undefined;
function loadCommon(target: Record<string, unknown>): Promise<void> {
  common ??= import('../../../../strings/en/kitSignals/common').then((m) => {
    Object.assign(target, m.common);
  });
  return common;
}

export async function loadWords(section: Section): Promise<void> {
  const target = en.kitSignals as unknown as Record<string, unknown>;
  await Promise.all([
    loadCommon(target),
    ...[section, ...(ALSO[section] ?? [])].map(async (one) => {
      if (!target[one]) target[one] = await LOADERS[one]();
    }),
  ]);
}
