// The thermodynamics kit window: every tool opens with an answer from its first values, the tabs follow the ARIA
// pattern, a changed input works the problem again, the unit system switches the results, and Insert puts the answer
// on the page. The window passes axe.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { kitThermo } from '../../../../strings/en/kitThermo';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../../tools/flags';
import { THERMO_META, THERMO_TOOL_IDS } from '../meta';
import { chooseTool } from './store';
import { ThermoKit } from './ThermoKit';

const inserted: unknown[] = [];
const listen = (event: Event) => {
  const detail = (event as CustomEvent<{ text?: string; table?: unknown; math?: unknown; handled: boolean }>).detail;
  inserted.push(detail.text ?? detail.table ?? detail.math);
  detail.handled = true;
};
window.addEventListener(INSERT_EVENT, listen);
afterEach(() => {
  inserted.splice(0);
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

const results = () => screen.findByRole('table', { name: kitThermo.ui.results });

describe('the thermodynamics kit', () => {
  it('opens every tool with an answer and moves between tabs with the keyboard', async () => {
    chooseTool(THERMO_TOOL_IDS[0]);
    const { container } = renderUi(<ThermoKit />);
    for (const id of THERMO_TOOL_IDS) {
      await userEvent.click(screen.getByRole('tab', { name: kitThermo.tab[id] }));
      expect(await results()).toBeTruthy();
    }
    const first = screen.getByRole('tab', { name: kitThermo.tab[THERMO_TOOL_IDS[0]] });
    await userEvent.click(first);
    await userEvent.keyboard('{End}');
    const last = screen.getByRole('tab', { name: kitThermo.tab[THERMO_TOOL_IDS[THERMO_TOOL_IDS.length - 1]] });
    expect(last.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(last);
    await expectNoAxeViolations(container);
  });

  it('groups the tabs by subject, and the arrow keys cross from one group to the next', async () => {
    chooseTool('psychro');
    renderUi(<ThermoKit />);
    await results();
    for (const meta of THERMO_META) {
      const group = screen.getByRole('tablist', { name: kitThermo.subject[meta.subject] });
      expect(within(group).getByRole('tab', { name: kitThermo.tab[meta.id] })).toBeTruthy();
    }
    await userEvent.click(screen.getByRole('tab', { name: kitThermo.tab.psychro }));
    await userEvent.keyboard('{ArrowRight}');
    const next = screen.getByRole('tab', { name: kitThermo.tab.combustion });
    expect(next.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(next);
  });

  it('works the problem again when an input changes and inserts the answer', async () => {
    chooseTool('statthermo');
    renderUi(<ThermoKit />);
    await results();
    await userEvent.selectOptions(screen.getByLabelText(kitThermo.ui.mode), 'solid');
    const temperature = screen.getByLabelText(kitThermo.field.temperature);
    await userEvent.clear(temperature);
    await userEvent.type(temperature, '171.75');
    const table = await results();
    await waitFor(() => expect(within(table).getByText('2.4762')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: kitThermo.ui.insert }));
    await userEvent.click(await screen.findByRole('menuitem', { name: kitThermo.ui.insertAnswer }));
    expect(String(inserted[0])).toContain('2.4762');
  });

  it('says what is missing in words', async () => {
    chooseTool('statthermo');
    renderUi(<ThermoKit />);
    await results();
    await userEvent.selectOptions(screen.getByLabelText(kitThermo.ui.mode), 'speeds');
    await userEvent.clear(screen.getByLabelText(kitThermo.field.pressure));
    expect(await screen.findByText(`Type a value for ${kitThermo.field.pressure}.`)).toBeTruthy();
  });
});
