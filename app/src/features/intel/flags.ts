// Phase 12's flags. A flag says whether the feature is built, not whether the person turned it on: every on-device
// feature also stays off in IntelSettings until the person chooses it. app/flags.ts joins these to the other lists.
import type { FlagDef, FlagId } from '../../app/flags';

export type IntelFlagId = Extract<FlagId, `intel.${string}`>;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const everywhere = { dev: true, nightly: true, beta: true, stable: true };
/** On in development and nightly builds while the feature is built, and off in Beta and Stable until it is done. */
const building = { dev: true, nightly: true, beta: false, stable: false };
const off = { dev: false, nightly: false, beta: false, stable: false };

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
  flag('intel.handwriting', 'Handwriting to text. Waits for the pen layer.', off),
  flag('intel.searchText', 'Text in images and handwriting, for search.', building),
];
