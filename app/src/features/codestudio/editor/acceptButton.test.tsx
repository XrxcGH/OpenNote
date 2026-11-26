// The Accept button at the end of ghost text, for mouse, touch, and pen (DESIGN 5.3.1). It shows after a touch or
// pen press or while the mouse hovers the ghost text (the default setting), never after keyboard-only typing;
// its press keeps the caret, selection, and focus in the editor; a long-press or right-click opens its menu.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCodeEditorCommands } from './commands';
import type { CodeEditor } from './create';
import { configureTestCommands, ghostAt, mount, resetSettings, unmountAll, withCodeSettings } from './testEditor';

beforeAll(() => {
  configureTestCommands();
  registerCodeEditorCommands();
});
beforeEach(resetSettings);
afterEach(unmountAll);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pointer(target: Element, type: string, pointerType: string, init: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType,
    pointerId: 1,
    isPrimary: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function button(editor: CodeEditor): HTMLButtonElement {
  const found = editor.root.querySelector<HTMLButtonElement>('.cm-ghost-accept');
  if (!found) throw new Error('No Accept button');
  return found;
}

async function withGhost(): Promise<CodeEditor> {
  const editor = await mount({ language: 'python', text: 'pri' });
  editor.showGhost([ghostAt(editor, 'nt(total)')]);
  return editor;
}

/** A tap: press, release, click. */
function tap(target: Element, pointerType: string): void {
  pointer(target, 'pointerdown', pointerType);
  pointer(target, 'pointerup', pointerType);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('when the button shows', () => {
  it('stays hidden after keyboard-only typing', async () => {
    const editor = await withGhost();
    expect(button(editor).hidden).toBe(true);
    expect(button(editor).getAttribute('aria-label')).toBe('Accept suggestion');
    expect(button(editor).tabIndex).toBe(-1);
  });

  it('shows after a touch press and after a pen press', async () => {
    for (const type of ['touch', 'pen']) {
      const editor = await withGhost();
      pointer(editor.view.contentDOM, 'pointerdown', type);
      expect(button(editor).hidden, type).toBe(false);
      unmountAll();
    }
  });

  it('shows while the mouse hovers the ghost text', async () => {
    const editor = await withGhost();
    const ghost = editor.root.querySelector('.cm-ghost-text');
    if (!ghost) throw new Error('No ghost text');
    pointer(ghost, 'pointerover', 'mouse');
    expect(button(editor).hidden).toBe(false);
    pointer(ghost, 'pointerout', 'mouse', { relatedTarget: editor.view.contentDOM } as PointerEventInit);
    expect(button(editor).hidden).toBe(true);
  });

  it('never shows with the setting Never, and always shows with Always', async () => {
    withCodeSettings({ acceptButton: 'never' });
    const never = await withGhost();
    pointer(never.view.contentDOM, 'pointerdown', 'touch');
    expect(button(never).hidden).toBe(true);
    unmountAll();
    withCodeSettings({ acceptButton: 'always' });
    const always = await withGhost();
    expect(button(always).hidden).toBe(false);
  });
});

describe('pressing the button', () => {
  it('accepts once for a click, a touch tap, and a pen tap', async () => {
    for (const type of ['mouse', 'touch', 'pen']) {
      const editor = await withGhost();
      tap(button(editor), type);
      expect(editor.getText(), type).toBe('print(total)');
      unmountAll();
    }
  });

  it('keeps the caret, the selection, and focus in the editor', async () => {
    const editor = await withGhost();
    const down = pointer(button(editor), 'pointerdown', 'touch');
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(editor.view.contentDOM);
    expect(editor.view.state.selection.main.head).toBe(3);
    expect(editor.hasGhost()).toBe(true);
    pointer(button(editor), 'pointerup', 'touch');
  });

  it('opens the four-item menu on a long-press and on a right-click', async () => {
    const editor = await withGhost();
    pointer(button(editor), 'pointerdown', 'touch');
    await wait(650);
    const items = () => [...editor.root.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items()).toEqual(['Accept', 'Accept word', 'Accept line', 'Dismiss']);
    // The release after a long-press does not also accept.
    pointer(button(editor), 'pointerup', 'touch');
    button(editor).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(editor.getText()).toBe('pri');
    editor.root.querySelector<HTMLElement>('[data-item="word"]')?.click();
    expect(editor.getText()).toBe('print');
    expect(editor.root.querySelector('[role="menu"]')).toBeNull();

    button(editor).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(items()).toHaveLength(4);
    editor.root.querySelector<HTMLElement>('[data-item="dismiss"]')?.click();
    expect(editor.hasGhost()).toBe(false);
  });

  it('opens the menu with the pen’s barrel button', async () => {
    const editor = await withGhost();
    pointer(button(editor), 'pointerdown', 'pen', { button: 2, buttons: 2 });
    expect(editor.root.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
  });

  it('opens the menu once for a barrel press, though the browser also sends its own contextmenu', async () => {
    const editor = await withGhost();
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    pointer(button(editor), 'pointerdown', 'pen', { button: 2, buttons: 2 });
    const menu = editor.root.querySelector('.cm-ghost-menu');
    expect(menu).not.toBeNull();
    // The browser's contextmenu for the same press: the menu stays as it is, not closed and reopened.
    const echo = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button(editor).dispatchEvent(echo);
    expect(editor.root.querySelector('.cm-ghost-menu')).toBe(menu);
    expect(menu?.isConnected).toBe(true);
    // A right-click later opens the menu again.
    now.mockReturnValue(20_000);
    button(editor).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(editor.root.querySelector('.cm-ghost-menu')).not.toBe(menu);
    expect(editor.root.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
    now.mockRestore();
  });

  it('calls the editor’s context menu once for a barrel press in the text', async () => {
    const onContextMenu = vi.fn();
    const editor = await mount({ language: 'python', text: 'x = 1', onContextMenu });
    pointer(editor.view.contentDOM, 'pointerdown', 'pen', { button: 2, buttons: 2 });
    editor.view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });
});
