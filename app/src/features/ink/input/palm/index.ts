// Palm rejection: a classifier that decides what each touch contact does while pens and fingers share the glass.

export { createPalmFilter } from './filter';
export type { PalmFilter, Surface, SystemSignal, TouchPolicy } from './filter';
export { End, Fx, Role, ROLE_NAMES } from './effects';
export type { Effects } from './effects';
export { PRESENCE_NAMES } from './presence';
export type { PenSignal, Presence } from './presence';
export { E, explainBits } from './score';
export {
  classifyDevice,
  DEFAULT_PALM_SETTINGS,
  EMPTY_LEARNED,
  palmSettingsFromInk,
  sanitizeLearned,
  sanitizeProfile,
  sanitizeSettings,
  UNKNOWN_PROFILE,
  unavailableSettings,
} from './settings';
export type {
  DeviceFacts,
  DeviceProfile,
  FingerDraw,
  Handedness,
  HandShape,
  LearnedState,
  PalmSettings,
  Platform,
  ProfileId,
  Sensitivity,
} from './settings';
export { calibratePxPerMm, resolvePxPerMm } from './units';
export * as palmThresholds from './thresholds';
