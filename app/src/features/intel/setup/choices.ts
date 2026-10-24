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

/**
 * What Recommended turns on here. Transcription is claimed only when this build has a speech engine to run it,
 * so Recommended never promises a feature that would do nothing.
 */
export function recommendedFeatures(speechEngine = true): Feature[] {
  return RECOMMENDED.filter((feature) => speechEngine || feature !== 'transcription');
}

/** The draft as it stands when the person picks a mode. `speechEngine` says whether transcription can run here. */
export function draftForMode(mode: SmartMode, current: SmartDraft, speechEngine = true): SmartDraft {
  if (mode === 'recommended') {
    return {
      mode,
      features: Object.fromEntries(recommendedFeatures(speechEngine).map((feature) => [feature, true])),
      speechModel: speechEngine ? (current.speechModel ?? RECOMMENDED_SPEECH_MODEL) : null,
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
  if (draft.mode === 'recommended') return RECOMMENDED.filter((feature) => draft.features[feature]);
  return CHOOSABLE.filter((feature) => draft.features[feature]);
}

/** The speech model to download, only when transcription is on. */
export function speechModelToDownload(draft: SmartDraft): string | null {
  return featuresOn(draft).includes('transcription') ? draft.speechModel : null;
}
