// What the smart features step of setup records, and what finishing it does (Phase 12). Recommended turns on the four
// features that read notes, handwriting, images, and recordings; Custom lets the person pick each one; Not now leaves
// everything off. Nothing leaves the device in any of them, and a model downloads only if one was chosen with its size
// in view.
import type { Feature } from '../../../services/intel';

export type SmartMode = 'recommended' | 'custom' | 'notNow';

export interface SmartDraft {
  mode: SmartMode;
  /** The features Custom turned on. Recommended and Not now ignore it. */
  features: Partial<Record<Feature, boolean>>;
  /** The speech model to download after setup, or null to choose later. */
  speechModel: string | null;
}

/** What Recommended turns on. Read aloud uses the voices Windows already has, so it stays a choice. */
export const RECOMMENDED: readonly Feature[] = ['ocr', 'handwriting', 'summaries', 'transcription'];

/** The speech model Recommended offers: the balanced English one. */
export const RECOMMENDED_SPEECH_MODEL = 'speech-base-en';

/** The features that can be chosen one by one, in the order the step lists them. */
export const CHOOSABLE: readonly Feature[] = ['ocr', 'handwriting', 'readAloud', 'summaries', 'transcription'];

export const NOT_NOW: SmartDraft = { mode: 'notNow', features: {}, speechModel: null };

/** The draft as it stands when the person picks a mode. */
export function draftForMode(mode: SmartMode, current: SmartDraft): SmartDraft {
  if (mode === 'recommended') {
    return {
      mode,
      features: Object.fromEntries(RECOMMENDED.map((feature) => [feature, true])),
      speechModel: current.speechModel ?? RECOMMENDED_SPEECH_MODEL,
    };
  }
  if (mode === 'custom') {
    return { mode, features: current.features, speechModel: current.speechModel };
  }
  return NOT_NOW;
}

/** The features this draft turns on. */
export function featuresOn(draft: SmartDraft): Feature[] {
  if (draft.mode === 'notNow') return [];
  if (draft.mode === 'recommended') return [...RECOMMENDED];
  return CHOOSABLE.filter((feature) => draft.features[feature]);
}

/** The speech model to download, only when transcription is on. */
export function speechModelToDownload(draft: SmartDraft): string | null {
  return featuresOn(draft).includes('transcription') ? draft.speechModel : null;
}
