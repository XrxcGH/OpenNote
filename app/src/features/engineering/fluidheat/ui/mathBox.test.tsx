// The typeset math of the kit results has room at its sides, so the last glyph of a formula is not cut off
// (walk 9, W9-VB-7).
import '../text';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../../../test';
import { saveTab } from '../open';
import { FluidHeatKit } from './FluidHeatKit';

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Nothing saved.
  }
});

describe('the fluid and heat kit math box', () => {
  it('pads typeset math at both sides and scrolls instead of cutting', async () => {
    saveTab('dimensional');
    const { container } = renderUi(<FluidHeatKit />);
    await waitFor(() => expect(container.querySelector('.katex-display')).not.toBeNull());
    const style = getComputedStyle(container.querySelector('.katex-display')!.parentElement!);
    expect(style.overflowX).toBe('auto');
    expect(Number.parseFloat(style.paddingRight)).toBeGreaterThan(0);
    expect(Number.parseFloat(style.paddingLeft)).toBeGreaterThan(0);
  });
});
