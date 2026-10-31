// The map maker in the window: the starting map, a bad point, and the distance from JFK to LHR.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { MapsTool } from './MapsTool';

describe('map maker', () => {
  it('draws the starting map and explains a bad point', async () => {
    const { container } = renderUi(<MapsTool />);
    expect(screen.getByRole('img', { name: /Equal Earth projection with 5 features/ })).toBeTruthy();
    await expectNoAxeViolations(container);
    fireEvent.change(screen.getByRole('textbox', { name: /^Points/ }), { target: { value: 'Nowhere, 95, 0' } });
    expect(screen.getByText('Use latitudes from −90 to 90 and longitudes in degrees.')).toBeTruthy();
  });

  it('measures JFK to LHR', () => {
    renderUi(<MapsTool />);
    fireEvent.click(screen.getByRole('tab', { name: 'Measure' }));
    expect(screen.getByText('5554.909 km')).toBeTruthy();
  });
});
