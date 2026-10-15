// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { installDropGuard } from './dropGuard';

function drop(type: string, types: string[], prevented = false): DragEvent {
  const event = new Event(type, { cancelable: true }) as unknown as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: { types, dropEffect: 'copy' } });
  if (prevented) event.preventDefault();
  return event;
}

describe('installDropGuard', () => {
  it('keeps a dropped file from opening in place of the app', () => {
    const remove = installDropGuard();
    const dragover = drop('dragover', ['Files']);
    window.dispatchEvent(dragover);
    expect(dragover.defaultPrevented).toBe(true);
    const dropped = drop('drop', ['Files']);
    window.dispatchEvent(dropped);
    expect(dropped.defaultPrevented).toBe(true);
    remove();
  });

  it('leaves dragged text alone and stops once removed', () => {
    const remove = installDropGuard();
    const text = drop('drop', ['text/plain']);
    window.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
    remove();
    const after = drop('drop', ['Files']);
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
