import { describe, expect, it } from 'vitest';
import { defaultBootData } from '../../boot/defaults';
import type { SetupContext, SetupStepDef } from '../../registries';
import { DEFAULT_OS } from '../../state/os';
import { DEFAULT_SETTINGS } from '../../state/settings';
import { completedBy, initialDraft, pendingSteps, withCompleted } from './model';
import type { DeviceSetup } from './model';

const step = (id: string, scope: SetupStepDef['scope'], order: number, enabled = true): SetupStepDef => ({
  id,
  title: 'setup.steps.welcome',
  order,
  scope,
  isEnabled: () => enabled,
  load: () => Promise.reject(new Error('not loaded in this test')),
  commit: () => Promise.resolve(),
});

const STEPS = [step('storage', 'device', 30), step('welcome', 'person', 10), step('look', 'person', 20)];

function pending(person: string[], device: Partial<DeviceSetup>, steps = STEPS): string[] {
  const settings = { ...DEFAULT_SETTINGS, setup: { completedSteps: person } };
  const record: DeviceSetup = { status: 'notStarted', step: null, completedSteps: [], draft: null, ...device };
  const ctx = { os: DEFAULT_OS, settings, firstRun: true } as SetupContext;
  return pendingSteps(steps, ctx, record).map((found) => found.id);
}

describe('pendingSteps', () => {
  it('shows every enabled step, in order, on a first run', () => {
    expect(pending([], {})).toEqual(['welcome', 'look', 'storage']);
    expect(pending([], { status: 'inProgress', step: 'look' })).toEqual(['welcome', 'look', 'storage']);
  });

  it('leaves out steps that are not enabled', () => {
    const steps = [...STEPS, step('smart', 'device', 40, false)];
    expect(pending([], {}, steps)).toEqual(['welcome', 'look', 'storage']);
  });

  it('shows only the device step on a new device with a roaming profile', () => {
    expect(pending(['welcome', 'look'], {})).toEqual(['storage']);
  });

  it('shows nothing once setup is done, and only a new step that a later version enabled', () => {
    const done = { status: 'done' as const, completedSteps: ['storage'] };
    expect(pending(['welcome', 'look'], done)).toEqual([]);
    expect(pending(['welcome', 'look'], done, [...STEPS, step('import', 'person', 50)])).toEqual(['import']);
    expect(pending(['welcome', 'look'], done, [...STEPS, step('smart', 'device', 40)])).toEqual(['smart']);
  });

  it('shows nothing for the development payload, where setup is done and no record exists', () => {
    expect(pending([], { status: 'done' })).toEqual([]);
  });
});

describe('the draft and the records', () => {
  it('starts from a saved draft, and from the saved theme otherwise', () => {
    expect(initialDraft(null, DEFAULT_SETTINGS)).toEqual({ look: { theme: 'system' } });
    expect(initialDraft({ look: { theme: 'dark' } }, DEFAULT_SETTINGS)).toEqual({ look: { theme: 'dark' } });
    expect(initialDraft('broken', defaultBootData().settings).look).toEqual({ theme: 'system' });
  });

  it('records each scope apart and keeps what was recorded before', () => {
    expect(completedBy(STEPS, 'person')).toEqual(['welcome', 'look']);
    expect(completedBy(STEPS, 'device')).toEqual(['storage']);
    expect(withCompleted(['welcome'], ['welcome', 'look'])).toEqual(['welcome', 'look']);
  });
});
