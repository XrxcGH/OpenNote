// Typing a map from the keyboard: Enter adds a branch beside, Tab one under, and the new branch takes the typing.
import { cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { MindMap } from './MindMap';

afterEach(cleanup);

// The page hands the patched map back as new props, as the panel block does.
function Host() {
  const [data, setData] = useState<Record<string, unknown>>({ root: { id: 'r', text: 'Root', children: [] } });
  return <MindMap data={data} readOnly={false} onChange={(root) => setData({ root })} />;
}

describe('MindMap keyboard', () => {
  it('types into a child made with Tab after a branch made with Enter', async () => {
    render(<Host />);
    const rootChip = document.querySelector('[data-node]') as HTMLElement;
    rootChip.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('X{Enter}Y{Tab}');
    await userEvent.keyboard('Z{Escape}');
    const shown = [...document.querySelectorAll('[data-node]')].map((one) => one.textContent);
    expect(shown.some((text) => text?.endsWith('Z'))).toBe(true);
  });
});
