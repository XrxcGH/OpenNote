// The modern physics window in a real browser: every calculation of every tool works out its first values without
// an error and has no axe violations in either theme; a bad value says what is wrong; the tool picker switches tools.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../test';
import { KitForm } from './shared/KitForm';
import type { FormDef } from './shared/ToolForms';
import { FORMS as plasma } from './plasma/Tool';
import { FORMS as stars } from './stars/Tool';
import { FORMS as cosmos } from './cosmos/Tool';
import { FORMS as spin } from './spin/Tool';
import { FORMS as atoms } from './atoms/Tool';
import { FORMS as molecules } from './molecules/Tool';
import { FORMS as sky } from './sky/Tool';
import { FORMS as solids } from './solids/Tool';
import { FORMS as schrodinger } from './schrodinger/Tool';
import ModPhysWindow from './Window';

const TOOLS: Record<string, readonly FormDef[]> = {
  plasma,
  stars,
  cosmos,
  spin,
  atoms,
  molecules,
  sky,
  solids,
  schrodinger,
};

const cases = Object.entries(TOOLS).flatMap(([tool, forms]) =>
  forms.map((form) => [`${tool} ${form.id}`, tool, form] as const),
);

describe('the modern physics forms', () => {
  it.each(cases)('%s works out its first values', (_name, tool, form) => {
    const { container, unmount } = renderUi(
      <KitForm name={`${tool}-${form.id}`} fields={form.fields} solve={form.solve} />,
    );
    const answer = container.querySelector('[data-modphys-answer]')!;
    expect(answer.querySelector('[data-modphys-error]')?.textContent ?? null).toBeNull();
    expect(within(answer as HTMLElement).queryAllByRole('row').length).toBeGreaterThan(0);
    unmount();
  });

  it.each(['light', 'dark'] as const)('has no axe violations in the %s theme', async (theme) => {
    const { container } = renderUi(
      <KitForm name="plasma-parameters" fields={plasma[0]!.fields} solve={plasma[0]!.solve} />,
      { theme },
    );
    await expectNoAxeViolations(container);
  });

  it('says what is wrong with an impossible value', () => {
    renderUi(<KitForm name="plasma-check" fields={plasma[0]!.fields} solve={plasma[0]!.solve} />);
    fireEvent.change(screen.getByLabelText('Electron density'), { target: { value: '0' } });
    expect(screen.getByRole('status').textContent).toContain('The density must be greater than zero.');
  });

  it('switches tools from the picker', async () => {
    renderUi(<ModPhysWindow />);
    const picker = screen.getByLabelText('Tool');
    await act(async () => {
      fireEvent.change(picker, { target: { value: 'plasma' } });
    });
    expect(await screen.findByLabelText('Calculation')).toBeTruthy();
  });
});

describe('the bound-states form', () => {
  const well = schrodinger.find((form) => form.id === 'well')!;
  const shown = () =>
    [...document.querySelectorAll('[data-modphys-form="q-well"] label')].map((one) => one.textContent ?? '');

  it('shows only the inputs the chosen potential reads, and solves after a switch', async () => {
    renderUi(<KitForm name="q-well" fields={well.fields} solve={well.solve} />);
    expect(shown()).toContain('Width (nm)');
    expect(shown().some((one) => one.startsWith('Depth'))).toBe(false);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Potential'), { target: { value: 'harmonic' } });
    });
    expect(shown().some((one) => one.startsWith('Width'))).toBe(false);
    // ħω = 1 eV gives E1 = ħω/2 = 0.5 eV exactly.
    expect(shown()).toContain('Oscillator energy ħω (eV)');
    expect(screen.getByRole('status').textContent).toContain('(exact 0.5,');
  });
});

describe('inserting with no page', () => {
  it('says so where a sighted student can see it', async () => {
    renderUi(<KitForm name="plasma-insert" fields={plasma[0]!.fields} solve={plasma[0]!.solve} />);
    expect(document.querySelector('[data-modphys-insert-note]')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Insert answer' }));
    });
    expect(document.querySelector('[data-modphys-insert-note]')?.textContent).toBe('Click in a page first, then insert.');
  });
});

describe('a narrow window', () => {
  it('wraps the result table instead of scrolling it sideways and keeps the plot readable', () => {
    const well = schrodinger.find((form) => form.id === 'well')!;
    const { container } = renderUi(
      <div style={{ inlineSize: '300px' }}>
        <KitForm name="q-narrow" fields={well.fields} solve={well.solve} />
      </div>,
    );
    const table = container.querySelector('[data-modphys-answer] [role="region"]')!;
    expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth + 1);
    const svg = container.querySelector('[data-modphys-answer] figure svg')!;
    expect(svg.getBoundingClientRect().width).toBeGreaterThanOrEqual(359);
  });
});
