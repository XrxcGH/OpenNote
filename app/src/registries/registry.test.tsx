import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createRegistry, useRegistry } from './registry';

const items = createRegistry<{ id: string; label: string }>('test items');

function List() {
  return (
    <ul aria-label="items">
      {useRegistry(items).map((item) => (
        <li key={item.id}>{item.label}</li>
      ))}
    </ul>
  );
}

describe('useRegistry', () => {
  it('re-renders when items are added and removed', () => {
    render(<List />);
    const list = () => screen.getByRole('list', { name: 'items' }).textContent;
    expect(list()).toBe('');
    let remove = () => {};
    act(() => {
      remove = items.register({ id: 'a', label: 'First' });
    });
    act(() => void items.register({ id: 'b', label: 'Second' }));
    expect(list()).toBe('FirstSecond');
    act(() => remove());
    expect(list()).toBe('Second');
  });
});
