// What the person has chosen, as far as the interface knows (Phase 12). It is a separate module so the small parts of
// the page that ask "is read aloud on?" do not load the client. Every feature is off until the choices load.
import { FEATURES } from '../../services/intel/types';
import type { Feature, FeatureStatus, IntelSettings } from '../../services/intel/types';
import { createStore } from '../../state/store';

export interface IntelState {
  /** False until the saved choices have been read. */
  loaded: boolean;
  /** The saved choices, all off until they load. */
  choices: IntelSettings;
  /** What each feature needs, once asked. Null until then. */
  status: readonly FeatureStatus[] | null;
  /** Reading the choices failed. */
  failed: boolean;
}

export const OFF = Object.fromEntries(FEATURES.map((feature) => [feature, false])) as unknown as IntelSettings;

export const intelState = createStore<IntelState>(
  { loaded: false, choices: OFF, status: null, failed: false },
  'intel state',
);

/** Whether the person has turned the feature on, as far as is known. False until the choices load. */
export function isOn(feature: Feature): boolean {
  return intelState.get().choices[feature];
}
