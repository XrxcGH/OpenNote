// The calendar converter in the window: the starting date in every calendar, a Maya Long Count typed in, an
// impossible date, and the festivals of a year.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { CalendarsTool } from './CalendarsTool';

describe('calendars and eras tool', () => {
  it('shows 3 October 2024 in the other calendars', async () => {
    const { container } = renderUi(<CalendarsTool />);
    expect(screen.getByText('1 Tishrei 5785 AM')).toBeTruthy();
    expect(screen.getByText('Thursday')).toBeTruthy();
    expect(screen.getByText('2460587')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('reads a Long Count and refuses an impossible day', () => {
    renderUi(<CalendarsTool />);
    fireEvent.change(screen.getByLabelText('Calendar'), { target: { value: 'maya' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Long Count/ }), { target: { value: '13.0.0.0.0' } });
    expect(screen.getByText('21 December 2012')).toBeTruthy();
    expect(screen.getByText('13.0.0.0.0, 4 Ahau 3 Kankin')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Calendar'), { target: { value: 'gregorian' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Day' }), { target: { value: '32' } });
    expect(screen.getByText('That month does not have that day.')).toBeTruthy();
  });

  it('lists the festivals of a year', () => {
    renderUi(<CalendarsTool />);
    fireEvent.click(screen.getByRole('tab', { name: 'Festivals in a year' }));
    expect(screen.getAllByText('2025-04-20')).toHaveLength(2);
  });
});
