import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../../../test';
import { HintLine } from './Popups';

describe('the argument hint', () => {
  it('describes the entry with the signature and names the current argument in words', () => {
    renderUi(
      <>
        <textarea aria-label="Entry" aria-describedby="hint" />
        <HintLine id="hint" hint={{ name: 'VLOOKUP', arg: 1, part: 1 }} />
      </>,
    );
    const tip = screen.getByRole('tooltip');
    // A label on the tooltip would replace the signature as the entry's description.
    expect(tip.hasAttribute('aria-label')).toBe(false);
    expect(tip.querySelector('[aria-label]')).toBeNull();
    expect(tip.textContent).toContain('table_array, current argument, col_index_num');
  });
});
