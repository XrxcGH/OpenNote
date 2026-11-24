// @vitest-environment jsdom
// The summary card of Check my work from a keyboard: focus reaches it at once, Escape works from anywhere, and focus
// goes back to the editor after.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

function setUp(results: StepResult[] = [result(0, 'ok'), result(1, 'broken')]) {
  const world = document.createElement('div');
  const editor = document.createElement('div');
  editor.tabIndex = 0;
  editor.contentEditable = 'true';
  document.body.append(world, editor);
  editor.focus();
  const lines = [0, 1].map((i) => ({ text: `line ${i}`, box: { x0: 0, y0: i * 20, x1: 50, y1: i * 20 + 16 } }));
  const mounted = { viewport: { world } } as unknown as MountedPage;
  showMarks(mounted, { lines: lines as unknown as GatheredLine[], results }, () => {});
  return { editor };
}

afterEach(() => {
  dismissMarks();
  document.body.replaceChildren();
});

describe('the Check my work card wording (walk VB-184)', () => {
  it('says a line could not be checked and separates the line name from its reason', () => {
    setUp([result(0, 'ok'), result(1, 'unchecked')]);
    const text = document.querySelector('[data-step-check-panel]')!.textContent!;
    expect(text).toContain('1 could not be checked');
    expect(text).not.toContain('I could not check');
    expect(document.querySelector('[data-step-check-panel] li strong')!.textContent).toBe('Line 2:');
  });
  it('sizes its buttons by the target token and stays off the page edge', () => {
    const css = readFileSync(join(import.meta.dirname, 'stepCheck.module.css'), 'utf8');
    expect(css).toMatch(/\.action \{\s*min-block-size: var\(--target-size\)/);
    expect(css).toMatch(/inset-block-end: 48px/);
  });
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
