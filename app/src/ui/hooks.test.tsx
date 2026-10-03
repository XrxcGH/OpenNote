import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layerStore, topLayer } from '../state/layers';
import { useDelayedFlag, useLayer, useLongPress } from './hooks';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function Pressable({ onLongPress, onClick }: { onLongPress(anchor: unknown): void; onClick?(): void }) {
  const handlers = useLongPress(onLongPress);
  return (
    <button type="button" {...handlers} onClick={onClick}>
      Hold me
    </button>
  );
}

describe('useLongPress', () => {
  const button = () => screen.getByRole('button', { name: 'Hold me' });

  it('calls back with the press position after 500 ms, for any pointer', () => {
    const onLongPress = vi.fn();
    render(<Pressable onLongPress={onLongPress} />);
    fireEvent.pointerDown(button(), { clientX: 40, clientY: 60, pointerType: 'pen' });
    advance(499);
    expect(onLongPress).not.toHaveBeenCalled();
    advance(1);
    expect(onLongPress).toHaveBeenCalledWith({ x: 40, y: 60 });
  });

  it('is cancelled by releasing early, moving more than the slop, or a cancelled pointer', () => {
    const onLongPress = vi.fn();
    render(<Pressable onLongPress={onLongPress} />);
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10 });
    advance(300);
    fireEvent.pointerUp(button());
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button(), { clientX: 10, clientY: 19 });
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(button());
    advance(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('allows a little movement', () => {
    const onLongPress = vi.fn();
    render(<Pressable onLongPress={onLongPress} />);
    fireEvent.pointerDown(button(), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button(), { clientX: 13, clientY: 12 });
    advance(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('swallows the click that follows a long press, and only that one', () => {
    const onClick = vi.fn();
    render(<Pressable onLongPress={() => {}} onClick={onClick} />);
    fireEvent.pointerDown(button());
    advance(500);
    fireEvent.pointerUp(button());
    fireEvent.click(button());
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(button());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

function Delayed({ active, delayMs }: { active: boolean; delayMs?: number }) {
  return <p>{useDelayedFlag(active, delayMs) ? 'Loading' : 'Nothing'}</p>;
}

describe('useDelayedFlag', () => {
  it('stays false for a quick load, then turns true after 300 ms', () => {
    const { rerender } = render(<Delayed active />);
    advance(299);
    expect(screen.getByText('Nothing')).toBeTruthy();
    advance(1);
    expect(screen.getByText('Loading')).toBeTruthy();
    rerender(<Delayed active={false} />);
    expect(screen.getByText('Nothing')).toBeTruthy();
  });

  it('never shows when the load ends first, and starts over for the next one', () => {
    const { rerender } = render(<Delayed active />);
    advance(200);
    rerender(<Delayed active={false} />);
    advance(1000);
    expect(screen.getByText('Nothing')).toBeTruthy();
    rerender(<Delayed active />);
    advance(299);
    expect(screen.getByText('Nothing')).toBeTruthy();
  });

  it('takes its own delay', () => {
    render(<Delayed active delayMs={50} />);
    advance(50);
    expect(screen.getByText('Loading')).toBeTruthy();
  });
});

function Layered({ open, onClose }: { open: boolean; onClose(reason: string): void }) {
  useLayer({ id: 'test-layer', kind: 'popover', modal: false, close: onClose }, open);
  return null;
}

describe('useLayer', () => {
  it('is on the stack while open and gone when closed or unmounted', () => {
    const { rerender, unmount } = render(<Layered open={false} onClose={() => {}} />);
    expect(layerStore.get()).toEqual([]);
    rerender(<Layered open onClose={() => {}} />);
    expect(topLayer()?.id).toBe('test-layer');
    rerender(<Layered open={false} onClose={() => {}} />);
    expect(layerStore.get()).toEqual([]);
    rerender(<Layered open onClose={() => {}} />);
    unmount();
    expect(layerStore.get()).toEqual([]);
  });

  it('calls the latest close, without pushing the layer again', () => {
    const [first, second] = [vi.fn(), vi.fn()];
    const { rerender } = render(<Layered open onClose={first} />);
    const layer = topLayer();
    rerender(<Layered open onClose={second} />);
    expect(topLayer()).toBe(layer);
    topLayer()?.close('escape');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('escape');
  });
});
