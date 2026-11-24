// A command of an on-device feature is out of the palette while its switch is off (walk 9, T1-D05-4).
import { describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../../app/flags';
import { commands } from '../../../registries';
import type { CommandContext } from '../../../commands/types';
import { loadApi, loadTesting } from '../../intel';
import './plus';
import './register';
import '../registrations/readAloud';

const ctx = {} as CommandContext;
const visible = (id: string) => commands.get(id as never)?.when?.(ctx) ?? true;

describe('commands of features that are switched off', () => {
  it('hides Ask your notes, Related pages and Summarize until their switches are on', async () => {
    initFlags('dev');
    (await loadTesting()).installTestHost();
    const api = await loadApi();
    // Switches off, as a new install has them.
    expect(visible('intel.askNotes')).toBe(false);
    expect(visible('intel.relatedPages')).toBe(false);
    expect(visible('intel.summarizePage')).toBe(false);
    await api.loadExtras();
    await new Promise((done) => setTimeout(done, 50));
    api.extrasState.set({ loaded: true, on: { meaning: true, ask: true, writing: false } });
    await vi.waitFor(() => expect(visible('intel.askNotes')).toBe(true));
    expect(visible('intel.relatedPages')).toBe(true);
  });
});
