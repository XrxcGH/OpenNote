// Setup's runtime (ARCHITECTURE.md sections 16.4 and 17.1). It holds the platform and the notes service, the
// steps and draft of the run, and its progress in state.json. app/start.ts installs it with the other
// listeners. When steps are pending, it opens setup at the step a closed run stopped on.

import { navigate } from '../../app/location';
import type { DeviceSetup } from './model';
import type { Platform } from '../../platform/types';
import { setupSteps } from '../../registries';
import type { SetupContext, SetupDraft, SetupStepDef, SetupStepId } from '../../registries';
import type { NotesService } from '../../services/notes/types';
import { osStore } from '../../state/os';
import { getSettings } from '../../state/settings';
import { DEFAULT_LOCATION, sessionStore } from '../../state/session';
import { createStore } from '../../state/store';
import { initialDraft, pendingSteps } from './model';

interface Host {
  platform: Platform;
  notes: NotesService;
}

interface SetupState {
  /** The ids of this run's steps, in order. Empty when no run has started. */
  flow: readonly SetupStepId[];
  draft: SetupDraft;
  /** What state.json holds, because the platform has no getter for it. */
  record: DeviceSetup;
}

const EMPTY_RECORD: DeviceSetup = { status: 'done', step: null, completedSteps: [], draft: null };

export const setupStore = createStore<SetupState>({ flow: [], draft: {}, record: EMPTY_RECORD }, 'setup');

let host: Host | null = null;

export function getHost(): Host {
  if (!host) throw new Error('Setup needs installSetup(platform, notes) first.');
  return host;
}

export function setupContext(): SetupContext {
  const { platform, notes } = getHost();
  return { platform, notes, os: osStore.get(), settings: getSettings(), firstRun: platform.boot.firstRun };
}

/** The steps of the current run, in order. */
export function flowSteps(flow: readonly SetupStepId[] = setupStore.get().flow): SetupStepDef[] {
  return flow.flatMap((id) => setupSteps.get(id) ?? []);
}

/** Starts a run: the pending steps and the draft, saved from an earlier run or fresh. Returns the steps. */
export function startRun(): SetupStepDef[] {
  const { record } = setupStore.get();
  const steps = pendingSteps(setupSteps.list(), setupContext(), record);
  const saved = record.status === 'inProgress' ? record.draft : null;
  setupStore.set((state) => ({
    ...state,
    flow: steps.map((step) => step.id),
    draft: initialDraft(saved, getSettings()),
  }));
  return steps;
}

/** Remembers where the run is, so closing the app mid-setup resumes at the same step with the same choices. */
export function saveProgress(step: SetupStepId, draft: SetupDraft): void {
  const record: DeviceSetup = { ...setupStore.get().record, status: 'inProgress', step, draft };
  setupStore.set((state) => ({ ...state, record }));
  getHost().platform.state.update({ setup: { status: 'inProgress', step, draft } });
}

/** Merges choices into the draft. A step passes whole sections, such as { look: { theme } }. */
export function updateDraft(update: Partial<SetupDraft>): void {
  setupStore.set((state) => ({ ...state, draft: { ...state.draft, ...update } }));
}

/** Records that the run is over, in state.json. */
export function saveDone(completedSteps: readonly string[]): DeviceSetup {
  const record: DeviceSetup = { status: 'done', step: null, completedSteps: [...completedSteps], draft: null };
  setupStore.set((state) => ({ ...state, record }));
  getHost().platform.state.update({ setup: record });
  return record;
}

/**
 * Connects setup to the app. When steps are pending, it opens setup (at the saved step, when a run was closed
 * mid-way). When none are and the saved location is setup, it leaves for the workspace.
 */
export function installSetup(platform: Platform, notes: NotesService): () => void {
  host = { platform, notes };
  setupStore.set((state) => ({ ...state, record: platform.boot.state.setup }));
  const steps = startRun();
  const { record } = setupStore.get();
  if (steps.length > 0) {
    const step = steps.find((candidate) => candidate.id === record.step) ?? steps[0];
    navigate({ view: 'setup', step: step.id }, { replace: true });
  } else if (sessionStore.get().location.view === 'setup') {
    navigate(DEFAULT_LOCATION, { replace: true });
  }
  return () => {
    host = null;
  };
}
