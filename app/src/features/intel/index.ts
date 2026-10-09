// On-device intelligence from the interface's side (Phase 12): the choices and the client for this platform, the
// Settings section, copying text from an image, handwriting to text, summaries, the read-aloud engine, and the seam
// for search. Other features import only from this file, and it stays small. The page's read-aloud chunk imports it,
// so everything but the read-aloud engine's stand-in loads on demand: loadApi has the rest.
export { intelSpeechEngine } from './speechProxy';
export type { OnDeviceSpeech } from './speechEngine';

/** The Settings section, loaded when Settings first shows it. */
export const loadSettingsSection = () => import('./SettingsSection');

/** The client, the choices, the commands' work, and the seam for search. */
export const loadApi = () => import('./api');

/** The smart features step of first-run setup, and what finishing it does. */
export const loadSmartFeaturesStep = () => import('./setup/SmartFeaturesStep');
export const commitSmartFeatures = (...args: Parameters<typeof import('./setup/commit').commitSmartFeatures>) =>
  import('./setup/commit').then((module) => module.commitSmartFeatures(...args));

/** When a model download last started, for the Privacy panel. */
export { useModelDownloadsLastRan } from './models/lastRan';

/** Which features use a cloud service with the person's own key, for the Privacy panel. */
export { useCloudKeyUse } from './cloud/lastRan';

/** Test helpers (a host over the fake transport), for other features' tests. Loaded only when a test asks. */
export const loadTesting = () => import('./testing');
