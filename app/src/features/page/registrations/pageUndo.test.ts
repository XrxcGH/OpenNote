// @vitest-environment jsdom
// Undo from the command bar, the palette, and menus reaches the shown page, not the tree (Beta 8 walk A-A05-10).
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../../../commands/types';
import { shownQueue } from '../sync/shown';
import type { SyncQueue } from '../sync/queue';
import { pageHasUndo } from './sync';

const queue = (canUndo: boolean, canRedo = false) =>
  ({ canUndo: () => canUndo, canRedo: () => canRedo }) as unknown as SyncQueue;
const ctx = (source: CommandContext['source'], focusZone: CommandContext['focusZone']) =>
  ({ source, focusZone }) as CommandContext;

afterEach(() => shownQueue.set(null));

describe('pageHasUndo', () => {
  it('is true from the command bar when the page can undo, and false when it cannot', () => {
    shownQueue.set(queue(true));
    expect(pageHasUndo(ctx('commandBar', 'commandBar'))).toBe(true);
    shownQueue.set(queue(false));
    expect(pageHasUndo(ctx('commandBar', 'commandBar'))).toBe(false);
  });

  it('leaves Undo to the tree when focus was in the tree, and checks redo for redo', () => {
    shownQueue.set(queue(true, false));
    expect(pageHasUndo(ctx('palette', 'notebooks'))).toBe(false);
    expect(pageHasUndo(ctx('palette', 'none'), 'redo')).toBe(false);
    expect(pageHasUndo(ctx('palette', 'none'))).toBe(true);
  });
});
