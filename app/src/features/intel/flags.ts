// Phase 12's flags. A flag says whether the feature is built, not whether the person turned it on: every on-device
// feature also stays off in IntelSettings until the person chooses it. app/flags.ts joins these to the other lists.
import type { FlagDef, FlagId } from '../../app/flags';

export type IntelFlagId = Extract<FlagId, `intel.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const everywhere = { dev: true, nightly: true, beta: true, stable: true };
/** On in development, nightly, and Beta builds while the feature is tried, and off in Stable until it is done. */
const building = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: IntelFlagId, description: string, enabled: FlagDef['enabled']): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled,
});

export const INTEL_FLAGS: readonly FlagDef[] = [
  flag('intel.ocr', 'Copy text from an image.', everywhere),
  flag('intel.readAloud', 'Read aloud with the voices installed on Windows.', everywhere),
  flag('intel.summaries', 'Summaries and keywords.', everywhere),
  flag('intel.handwriting', 'Handwriting to text, from the selected ink.', building),
  flag('intel.searchText', 'Text in images and handwriting, for search.', building),
  flag('intel.models', 'Model downloads with consent, and the speech model picker.', building),
  flag('intel.vocabulary', 'A custom vocabulary for transcripts, kept for each notebook.', building),
  flag('intel.background', 'The activity panel for background work, with pause and limits.', building),
  flag('intel.backgroundOcr', 'Read the text in new images in the background.', building),
  flag('intel.handwritingExtras', 'Special characters, chemistry, and alternatives for handwriting.', building),
  flag('intel.meaning', 'Find by meaning, and Related pages.', building),
  flag('intel.ask', 'Ask your notes, with the pages it used.', building),
  flag('intel.writing', 'Writing tools: proofread, rewrite, shorten, make a list, tidy structure.', building),
  flag('intel.transcription', 'Transcription on this device with a downloaded Whisper model.', building),
];
