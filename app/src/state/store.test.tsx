import { act, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { describe, expect, it } from 'vitest';
import { createStore, shallowEqual, useStore } from './store';

interface State {
  count: number;
  other: number;
  items: number[];
}

const store = createStore<State>({ count: 0, other: 0, items: [1, 2] }, 'test.hooks');
let renders = 0;

function Count() {
  return <output aria-label="count">{useStore(store, (state) => state.count)}</output>;
}

const counted = () => (renders += 1);

function Evens() {
  // A selector that builds a new array each time; shallow equality keeps it from re-rendering.
  const evens = useStore(store, (state) => state.items.filter((n) => n % 2 === 0), shallowEqual);
  return <output aria-label="evens">{evens.join(',')}</output>;
}

describe('useStore', () => {
  it('re-renders only when the selected value changes', () => {
    render(
      <Profiler id="count" onRender={counted}>
        <Count />
      </Profiler>,
    );
    const before = renders;
    act(() => store.set((state) => ({ ...state, other: state.other + 1 })));
    expect(renders).toBe(before);
    act(() => store.set((state) => ({ ...state, count: state.count + 1 })));
    expect(renders).toBe(before + 1);
    expect(screen.getByRole('status', { name: 'count' }).textContent).toBe('1');
  });

  it('caches selections that build new arrays, so nothing loops', () => {
    render(<Evens />);
    act(() => store.set((state) => ({ ...state, items: [...state.items, 4] })));
    expect(screen.getByRole('status', { name: 'evens' }).textContent).toBe('2,4');
  });
});
