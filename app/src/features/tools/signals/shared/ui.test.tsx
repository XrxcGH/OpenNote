// The shared field in a real browser: a sequence field is a text area that wraps, never one line that cuts it off.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../../../test';
import { Field } from './ui';

describe('signals Field', () => {
  it('shows a long sequence in a wrapping text area (walk VB-1)', () => {
    const long = Array.from({ length: 60 }, (_, i) => String(i)).join(', ');
    renderUi(<Field label="Samples" value={long} onChange={() => undefined} wide lines={2} />);
    const box = screen.getByRole('textbox', { name: 'Samples' });
    expect(box.tagName).toBe('TEXTAREA');
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
  });
  it('stays one line without lines', () => {
    renderUi(<Field label="Rate" value="2" onChange={() => undefined} />);
    expect(screen.getByRole('textbox', { name: 'Rate' }).tagName).toBe('INPUT');
  });
});
