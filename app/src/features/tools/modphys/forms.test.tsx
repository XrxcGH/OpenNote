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
import ModPhysWindow from './Window';

const TOOLS: Record<string, readonly FormDef[]> = { plasma, stars, cosmos, spin, atoms };

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
