// Phase 12's flags. A flag says whether the feature is built, not whether the person turned it on: every on-device
// feature also stays off in IntelSettings until the person chooses it. app/flags.ts joins these to the other lists.
import type { FlagDef, FlagId } from '../../app/flags';

export type IntelFlagId = Extract<FlagId, `intel.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
/** On in every build. */
const everywhere = { dev: true, nightly: true, beta: true, stable: true };

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
  flag('intel.handwriting', 'Handwriting to text, from the selected ink.', everywhere),
  flag('intel.searchText', 'Text in images and handwriting, for search.', everywhere),
  flag('intel.models', 'Model downloads with consent, and the speech model picker.', everywhere),
  flag('intel.vocabulary', 'A custom vocabulary for transcripts, kept for each notebook.', everywhere),
  flag('intel.background', 'The activity panel for background work, with pause and limits.', everywhere),
  flag('intel.backgroundOcr', 'Read the text in new images in the background.', everywhere),
  flag('intel.handwritingExtras', 'Special characters, chemistry, and alternatives for handwriting.', everywhere),
  flag('intel.meaning', 'Find by meaning, and Related pages.', everywhere),
  flag('intel.ask', 'Ask your notes, with the pages it used.', everywhere),
  flag('intel.writing', 'Writing tools: proofread, rewrite, shorten, make a list, tidy structure.', everywhere),
];
