// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSERT_EVENT } from '../flags';
import { openKitTool, registerKit, resetKits } from '../kits/registry';
import { loadStored } from '../ui/storage';
import { CIVIL_KIT_ID, CIVIL_RESTORE_EVENT, civilValuesStore, reopenCivilCalc } from './open';
import { civilChoice } from './selection';
import { insertLive } from './ui/insert';
import type { Outcome } from './core/types';

const openTool = vi.fn();
vi.mock('../ui/host', () => ({ openTool: (id: string) => openTool(id) }));

afterEach(() => resetKits());

describe('the civil kit live calculation block', () => {
  it('inserts a kitcalc block that keeps the typed inputs', async () => {
    let panel: { type: string; data: Record<string, unknown> } | undefined;
    const take = (event: Event) => {
      const detail = (event as CustomEvent<{ panel?: typeof panel; handled: boolean }>).detail;
      panel = detail.panel;
      detail.handled = true;
    };
    window.addEventListener(INSERT_EVENT, take);
    const outcome: Outcome = {
      answer: { key: 'hydraulics.gvf.answer', vars: { type: 'M1', L: 10, dir: 'upstream' } },
      rows: [{ label: 'hydraulics.r.yc', value: 0.61, unit: 'm' }],
      steps: [],
    };
    const state = { text: { Q: '4.5', y1: '2' }, unit: { y1: 'm' } };
    await insertLive(outcome, { tool: 'hydraulics', calc: 'gvf', title: 'GVF', state });
    window.removeEventListener(INSERT_EVENT, take);
    expect(panel?.type).toBe('ext:org.opennote/kitcalc');
    expect(panel?.data).toMatchObject({ kit: CIVIL_KIT_ID, tool: 'hydraulics.gvf', inputs: state });
  });

  it('puts the inputs back and opens the calculation on Open in tool', async () => {
    registerKit(CIVIL_KIT_ID, reopenCivilCalc);
    const restored = vi.fn();
    window.addEventListener(CIVIL_RESTORE_EVENT, restored);
    const inputs = { text: { Q: '9' }, unit: {} };
    expect(await openKitTool(CIVIL_KIT_ID, 'hydraulics.gvf', inputs)).toBe(true);
    expect(loadStored(civilValuesStore('hydraulics', 'gvf'), null)).toEqual(inputs);
    expect(restored).toHaveBeenCalledTimes(1);
    expect(civilChoice.get()).toMatchObject({ tool: 'hydraulics', calcs: { hydraulics: 'gvf' } });
    expect(openTool).toHaveBeenCalledWith('kit-civil');
  });
});
