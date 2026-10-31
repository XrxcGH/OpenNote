// Insert offers a live calculation: a kits' shared block (ext:org.opennote/kitcalc) that keeps the tool, the
// calculation, and the typed values, and whose Open in tool puts those values back in the window.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../flags';
import { openKitTool, registerKit, resetKits } from '../../kits/registry';
import { closeTool } from '../../ui/host';
import { loadStored } from '../../ui/storage';
import { reopenLifeSys } from '../open';
import { LifeSysTool } from './LifeSysTool';

type Panel = { type: string; data: Record<string, unknown>; fallback: string };
let panels: Panel[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<{ panel?: Panel; handled: boolean }>).detail;
  if (detail.panel) panels.push(detail.panel);
  detail.handled = true;
};

beforeEach(() => {
  panels = [];
  localStorage.clear();
  localStorage.setItem('opennote.tools.lifesys', JSON.stringify({ tool: 'diversity' }));
  localStorage.setItem('opennote.tools.lifesys.calc', JSON.stringify({ diversity: 'petersen' }));
  window.addEventListener(INSERT_EVENT, listen);
});
afterEach(() => {
  window.removeEventListener(INSERT_EVENT, listen);
  resetKits();
  closeTool('lifesys');
  localStorage.clear();
});

describe('a live life science calculation', () => {
  it('goes on the page as a kitcalc block holding the tool, calculation, and values', async () => {
    renderUi(<LifeSysTool />);
    const marked = await screen.findByLabelText('Marked and released, M');
    fireEvent.change(marked, { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Live calculation that reopens with these values' }));
    await waitFor(() => expect(panels).toHaveLength(1));
    const [panel] = panels;
    expect(panel!.type).toBe('ext:org.opennote/kitcalc');
    expect(panel!.data).toMatchObject({ kit: 'lifesys', tool: 'diversity' });
    const inputs = panel!.data.inputs as { calc: string; values: { text: Record<string, string> } };
    expect(inputs.calc).toBe('petersen');
    expect(inputs.values.text).toMatchObject({ M: '40' });
    expect(panel!.fallback).toContain(panel!.data.title as string);
  });

  it('puts the block values back in the window when the block reopens the tool', async () => {
    registerKit('lifesys', reopenLifeSys);
    const values = { text: { x: '30' }, unit: {} };
    expect(await openKitTool('lifesys', 'physiology', { calc: 'lms', values })).toBe(true);
    expect(loadStored<Record<string, string>>('lifesys.calc', {}).physiology).toBe('lms');
    expect(loadStored('lifesys.physiology.lms', null)).toEqual(values);
    expect(loadStored<{ tool?: string }>('lifesys', {}).tool).toBe('diversity');
  });
});
