// Which setup steps run, and what setup remembers (ARCHITECTURE.md sections 17.1 and 16.4). Steps come from the
// setupSteps registry. Person steps are recorded in settings.json, which roams; device steps are recorded in
// state.json, which stays on this device. So a new device with a roaming profile sees only the device steps.

import type { DeviceState, Settings } from '../../platform/types';
import type { SetupContext, SetupDraft, SetupStepDef } from '../../registries';

export type DeviceSetup = DeviceState['setup'];

/** The draft key a step's commit sets to where the first page opens, for the finishing step. */
export const OPEN_AFTER_SETUP = 'openAfterSetup';

const byOrder = (a: SetupStepDef, b: SetupStepDef) => a.order - b.order;

/** The ids recorded as done in a step's scope. */
export function recordFor(step: SetupStepDef, settings: Settings, device: DeviceSetup): readonly string[] {
  return step.scope === 'person' ? settings.setup.completedSteps : device.completedSteps;
}

/**
 * The steps this run shows, in order: enabled steps that aren't done in their scope. After setup is done, only a
 * scope that has some record can show a step, because a step a later version adds is what's missing from a
 * record that exists. An empty record with status "done" comes from a development or test payload.
 */
export function pendingSteps(steps: readonly SetupStepDef[], ctx: SetupContext, device: DeviceSetup): SetupStepDef[] {
  return steps
    .filter((step) => step.isEnabled(ctx))
    .sort(byOrder)
    .filter((step) => {
      const record = recordFor(step, ctx.settings, device);
      if (record.includes(step.id)) return false;
      return device.status !== 'done' || record.length > 0;
    });
}

/** The draft a run starts from, before anything is chosen. */
export function initialDraft(saved: unknown, settings: Settings): SetupDraft {
  const draft = typeof saved === 'object' && saved !== null ? (saved as SetupDraft) : {};
  return { ...draft, look: draft.look ?? { theme: settings.appearance.theme } };
}

/** The ids done after a run, with what was recorded before. */
export function withCompleted(record: readonly string[], done: readonly string[]): string[] {
  return [...new Set([...record, ...done])];
}

/** The steps of a run, by scope, as the two records that finishing updates. */
export function completedBy(steps: readonly SetupStepDef[], scope: SetupStepDef['scope']): string[] {
  return steps.filter((step) => step.scope === scope).map((step) => step.id);
}
