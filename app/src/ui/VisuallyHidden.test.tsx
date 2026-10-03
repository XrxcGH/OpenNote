import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../test';
import { VisuallyHidden } from './VisuallyHidden';

describe('VisuallyHidden', () => {
  it('keeps text in the accessibility tree but off the screen', () => {
    renderUi(
      <button type="button" aria-describedby="hint">
        Dark mode
        <VisuallyHidden id="hint">Following Windows.</VisuallyHidden>
      </button>,
    );
    const hint = document.getElementById('hint') as HTMLElement;
    const rect = hint.getBoundingClientRect();
    expect(rect.width).toBeLessThanOrEqual(1);
    expect(rect.height).toBeLessThanOrEqual(1);
    expect(hint.checkVisibility()).toBe(true);
    expect(screen.getByRole('button', { description: 'Following Windows.' })).toBeTruthy();
  });
});
