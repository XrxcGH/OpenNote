// A title bar item's slot: a hidden item leaves no wrapper, so the bar's gap has nothing to space out.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TitleBarItemDef } from '../../registries/types';
import { ItemSlot } from './ItemSlot';

const item = (useVisible?: () => boolean): TitleBarItemDef => ({
  id: 'test.item',
  side: 'end',
  order: 1,
  priority: 1,
  compact: 'hide',
  Component: ({ presentation }) => <b>{presentation}</b>,
  useVisible,
});

describe('a title bar item slot', () => {
  it('wraps an item that says nothing about being hidden', () => {
    const { container } = render(<ItemSlot item={item()} className="slot" presentation="icon" />);
    expect(container.innerHTML).toBe('<span class="slot"><b>icon</b></span>');
  });

  it('wraps an item that says it shows', () => {
    const { container } = render(<ItemSlot item={item(() => true)} presentation="full" />);
    expect(container.innerHTML).toBe('<span><b>full</b></span>');
  });

  it('renders nothing at all for an item that says it is hidden', () => {
    const { container } = render(<ItemSlot item={item(() => false)} className="slot" presentation="full" />);
    expect(container.innerHTML).toBe('');
  });
});
