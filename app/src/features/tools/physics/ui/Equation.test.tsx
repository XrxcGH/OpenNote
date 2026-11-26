// A governing equation wider than the tool window shrinks to fit it instead of scrolling sideways (full walk 2,
// Orbital maneuvers and Lambert).
import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../../../test';
import { Equation } from './OutcomeView';

const WIDE = Array.from({ length: 9 }, (_, index) => `v_{${index}}^2`).join(' + ');

describe('the governing equation', () => {
  it('fits a box narrower than the equation', async () => {
    const { container } = renderUi(
      <div style={{ inlineSize: 360 }}>
        <Equation latex={WIDE} />
      </div>,
    );
    const box = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('div > div');
      expect(found?.querySelector('.katex')).not.toBeNull();
      return found!;
    });
    await waitFor(() => expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1));
  });
});
