// The timeline builder in the window: the example draws and a bad row names its line. The keyboard zooms the
// picture, the comparison reports the overlap, and the axis switch reaches deep time.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { TimelineTool } from './TimelineTool';

const rowsField = () => screen.getByRole('textbox', { name: /^Events and periods/ });

describe('timeline builder', () => {
  it('draws the example and compares two rows', async () => {
    const { container } = renderUi(<TimelineTool />);
    expect(screen.getByText('5 items on 2 tracks.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insert editable figure' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Second'), { target: { value: '2' } });
    // Ming 1368 to 1644 and Edo 1603 to 1868 share 1603 to 1644.
    expect(screen.getByText('1603 to 1644 (41 years)')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('names the line of a row it cannot read', () => {
    renderUi(<TimelineTool />);
    fireEvent.change(rowsField(), { target: { value: 'A, 1500\nB, 0 BCE' } });
    expect(screen.getByText(/^Line 2: There is no year 0 BCE/)).toBeTruthy();
  });

  it('zooms from the keyboard and fits again', () => {
    renderUi(<TimelineTool />);
    const fit = screen.getByRole('button', { name: 'Fit all' }) as HTMLButtonElement;
    expect(fit.disabled).toBe(true);
    const picture = screen.getAllByRole('group', { name: /Timeline picture/ })[1]!;
    fireEvent.keyDown(picture, { key: '+' });
    expect(fit.disabled).toBe(false);
    fireEvent.click(fit);
    expect(fit.disabled).toBe(true);
  });

  it('shows deep time in years before present', () => {
    renderUi(<TimelineTool />);
    fireEvent.change(rowsField(), {
      target: { value: 'Earth forms, 4.5 Ga\nDinosaurs end, 66 Ma\nHolocene, 11.7 ka' },
    });
    fireEvent.change(screen.getByLabelText('Axis'), { target: { value: 'log' } });
    const image = screen.getByRole('img', { name: /from 10 Ga to 10 ka/ });
    expect(image).toBeTruthy();
  });
});
