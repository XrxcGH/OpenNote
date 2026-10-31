// The read-only notice of a page whose ink the last run, still closing, kept in its journal.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StillClosingNotice } from './stillClosing';

afterEach(cleanup);

describe('the still-closing notice', () => {
  it('says the page is read-only until a restart brings the ink back', () => {
    render(<StillClosingNotice readOnly={{ reason: 'stillClosing', action: null }} />);
    expect(screen.getByRole('status').textContent).toMatch(/still closing.*read-only.*restart OpenNote/);
  });

  it('shows nothing for a writable page or another reason', () => {
    const { container, rerender } = render(<StillClosingNotice readOnly={null} />);
    expect(container.textContent).toBe('');
    rerender(<StillClosingNotice readOnly={{ reason: 'lockedElsewhere', action: null }} />);
    expect(container.textContent).toBe('');
  });
});
