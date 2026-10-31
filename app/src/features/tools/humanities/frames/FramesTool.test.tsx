// Note frames in the window: inserting with no page focused says so in the window, not only to a screen reader.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../../../test';
import { INSERT_EVENT } from '../../flags';
import { FramesTool } from './FramesTool';

describe('note frames tool', () => {
  it('shows a notice when no page takes the frame, and confirms when one does', () => {
    renderUi(<FramesTool />);
    const button = screen.getByRole('button', { name: 'Insert frame' });
    fireEvent.click(button);
    expect(screen.getByText('Click in a page first, then insert.')).toBeTruthy();
    const take = (event: Event) => {
      (event as CustomEvent<{ handled: boolean }>).detail.handled = true;
    };
    window.addEventListener(INSERT_EVENT, take);
    try {
      fireEvent.click(button);
      expect(screen.getByText('Added to the page.')).toBeTruthy();
      expect(screen.queryByText('Click in a page first, then insert.')).toBeNull();
    } finally {
      window.removeEventListener(INSERT_EVENT, take);
    }
  });
});
