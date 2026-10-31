// @vitest-environment jsdom
// The summary card of Check my work from a keyboard: focus reaches it at once, Escape works from anywhere, and focus
// goes back to the editor after.
import { afterEach, describe, expect, it } from 'vitest';
import type { StepResult } from '../../math';
import type { MountedPage } from '../mount';
import type { GatheredLine } from './gather';
import { dismissMarks, marksShown, showMarks } from './overlay';

const result = (index: number, verdict: StepResult['verdict']): StepResult => ({
  index,
  verdict,
  reason: verdict === 'ok' ? 'sameSolutions' : 'signMoved',
  params: { term: '3' },
  method: 'solutions',
  confidence: 1,
});

function setUp() {
  const world = document.createElement('div');
  const editor = document.createElement('div');
  editor.tabIndex = 0;
  editor.contentEditable = 'true';
  document.body.append(world, editor);
  editor.focus();
  const lines = [0, 1].map((i) => ({ text: `line ${i}`, box: { x0: 0, y0: i * 20, x1: 50, y1: i * 20 + 16 } }));
  const mounted = { viewport: { world } } as unknown as MountedPage;
  showMarks(
    mounted,
    { lines: lines as unknown as GatheredLine[], results: [result(0, 'ok'), result(1, 'broken')] },
    () => {},
  );
  return { editor };
}

afterEach(() => {
  dismissMarks();
  document.body.replaceChildren();
});

describe('the Check my work card from a keyboard', () => {
  it('moves focus to the card heading once the check is shown', () => {
    setUp();
    const heading = document.querySelector('[data-step-check-panel] h2');
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
  });

  it('dismisses on Escape pressed outside the card and gives focus back to the editor', () => {
    const { editor } = setUp();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(marksShown()).toBe(false);
    expect(document.querySelector('[data-step-check-panel]')).toBeNull();
    expect(document.activeElement).toBe(editor);
  });

  it('leaves focus where the person moved it when the card goes away', () => {
    setUp();
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    dismissMarks();
    expect(document.activeElement).toBe(other);
  });

  it('does not dismiss on an Escape that closes a dialog', () => {
    setUp();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(marksShown()).toBe(true);
  });
});
