// The live calculation block: More to insert offers it, it keeps the form and the typed values, and Open in tool
// (the kit registry) puts them back into the form.
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../flags';
import { KIT_CALC_TYPE } from '../../kits/block/model';
import { openKitTool, registerKit, resetKits } from '../../kits/registry';
import { FORMS as atoms } from '../atoms/Tool';
import { MODPHYS_KIT, ToolForms, readModPhysInputs } from './ToolForms';

interface Panel {
  type: string;
  data: { kit: string; tool: string; inputs: unknown; summary: string };
}

afterEach(() => resetKits());

describe('the live calculation block', () => {
  it('keeps the typed values and reopens the form with them', async () => {
    const panels: Panel[] = [];
    const take = (event: Event) => {
      const detail = (event as CustomEvent<{ panel?: Panel; handled: boolean }>).detail;
      if (detail.panel) panels.push(detail.panel);
      detail.handled = true;
    };
    window.addEventListener(INSERT_EVENT, take);
    try {
      const { unmount } = renderUi(<ToolForms tool="atoms" forms={atoms} />);
      fireEvent.change(screen.getByLabelText('Calculation'), { target: { value: 'line' } });
      fireEvent.change(screen.getByLabelText('Nuclear charge Z'), { target: { value: '2' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'More to insert' }));
      });
      await act(async () => {
        fireEvent.click(await screen.findByRole('menuitem', { name: /Live calculation/ }));
      });
      expect(panels).toHaveLength(1);
      const panel = panels[0]!;
      expect(panel.type).toBe(KIT_CALC_TYPE);
      expect(panel.data.kit).toBe(MODPHYS_KIT);
      expect(panel.data.tool).toBe('atoms');
      const kept = readModPhysInputs(panel.data.inputs)!;
      expect(kept.form).toBe('line');
      expect(kept.values.text.z).toBe('2');
      unmount();

      // Open in tool: the registry holds the inputs until the form shows and takes them.
      registerKit(MODPHYS_KIT, () => undefined);
      await openKitTool(MODPHYS_KIT, 'atoms', panel.data.inputs);
      renderUi(<ToolForms tool="atoms" forms={atoms} />);
      expect((screen.getByLabelText('Nuclear charge Z') as HTMLInputElement).value).toBe('2');
    } finally {
      window.removeEventListener(INSERT_EVENT, take);
    }
  });

  it('ignores inputs that are not a form of these tools', () => {
    expect(readModPhysInputs({ texts: {}, system: 'si' })).toBeNull();
    expect(readModPhysInputs({ form: 'line', values: { text: { z: 2, n: '3' }, unit: {} } })?.values.text).toEqual({
      n: '3',
    });
  });
});
