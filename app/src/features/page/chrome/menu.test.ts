import { afterEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import { shownImageIds } from '../images/shown';
import { selectOnPage } from '../seams/selectionStore';
import type { Objects } from '../objects/objects';
import { objectMenuItems } from './menu';

function objects(disabled: readonly string[]): Objects {
  return { enabled: (command: string) => !disabled.includes(command) } as unknown as Objects;
}

afterEach(() => {
  shownImageIds.clear();
  selectOnPage({ blocks: [], strokes: [] });
});

describe('the object right-click menu', () => {
  it('says Already in front once, not for both front items', () => {
    const items = objectMenuItems(objects(['bringToFront', 'bringForward']));
    expect(items.filter((item) => item.disabled && item.id.startsWith('bring'))).toHaveLength(1);
  });

  it('adds Alt text and Copy text right after Edit for one picture', () => {
    initFlags('dev', { 'intel.ocr': true });
    shownImageIds.add('pic');
    selectOnPage({ blocks: ['pic'], strokes: [] });
    const ids = objectMenuItems(objects([])).map((item) => item.id);
    expect(ids.slice(0, 3)).toEqual(['edit', 'altText', 'copyText']);
  });

  it('leaves Copy text out when text reading is off, and both out for a non-picture', () => {
    initFlags('dev', { 'intel.ocr': false });
    shownImageIds.add('pic');
    selectOnPage({ blocks: ['pic'], strokes: [] });
    expect(objectMenuItems(objects([])).map((item) => item.id)).not.toContain('copyText');
    selectOnPage({ blocks: ['text'], strokes: [] });
    expect(objectMenuItems(objects([])).map((item) => item.id)).not.toContain('altText');
  });
});
