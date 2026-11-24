// A command of an on-device feature is out of the palette while its switch is off (walk 9, T1-D05-4).
import { describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import { commands } from '../../../registries';
import { intelState, OFF } from '../../intel/choices';
import { extrasState } from '../../intel/extras';
import type { CommandContext } from '../../../commands/types';
import './plus';
import './register';
import '../registrations/readAloud';
import { shownQueue } from '../sync/shown';

const ctx = {} as CommandContext;
const visible = (id: string) => commands.get(id as never)?.when?.(ctx) ?? true;

describe('commands of features that are switched off', () => {
  it('hides Summarize, Ask your notes and Related pages until their switches are on', () => {
    initFlags('dev');
    intelState.set({ loaded: true, choices: OFF, status: null, failed: false });
    extrasState.set({ loaded: true, on: { meaning: false, ask: false, writing: false } });
    expect(visible('intel.askNotes')).toBe(false);
    expect(visible('intel.relatedPages')).toBe(false);
    expect(visible('intel.summarizePage')).toBe(false);
    extrasState.set({ loaded: true, on: { meaning: true, ask: true, writing: false } });
    expect(visible('intel.askNotes')).toBe(true);
    expect(visible('intel.relatedPages')).toBe(true);
    void shownQueue;
  });
});
