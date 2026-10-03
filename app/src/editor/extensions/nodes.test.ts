// @vitest-environment jsdom
// WP4's nodes in a mounted editor. Task items have real checkboxes, and Enter and Backspace work in lists.
// Adjacent lists join. Callouts are named by type and title, with a type menu and a fold button. Math has a
// source field, and image chips never load outside sources.
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { META_COMMAND } from '../meta';
import { mountEditor, testHost } from '../commands/testing';
import type { TestEditor } from '../commands/testing';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

function mount(source: string, host = testHost()): TestEditor {
  mounted = mountEditor(source, host);
  return mounted;
}

function press(editor: TestEditor['editor'], key: string, init: KeyboardEventInit = {}): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event));
}

describe('task items', () => {
  it('draw a native checkbox named by the item’s text', () => {
    const { root } = mount('- [ ] Water the plants\n- [x] Buy soil\n- plain');
    const boxes = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((box) => [box.getAttribute('aria-label'), box.checked])).toEqual([
      ['Water the plants', false],
      ['Buy soil', true],
    ]);
  });

  it('check and uncheck from the checkbox as one command', () => {
    const page = mount('- [ ] Water the plants');
    const metas: unknown[] = [];
    page.editor.on('transaction', ({ transaction }) => metas.push(transaction.getMeta(META_COMMAND)));
    const box = page.root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.click();
    expect(page.markdown()).toBe('- [x] Water the plants');
    expect(metas).toContain(true);
  });

  it('start a new unchecked task on Enter, and leave the list from an empty one', () => {
    const page = mount('- [x] Done[]');
    press(page.editor, 'Enter');
    page.editor.commands.insertContent('Next');
    expect(page.markdown()).toBe('- [x] Done\n- [ ] Next');
    press(page.editor, 'Enter');
    press(page.editor, 'Enter');
    expect(page.markdown()).toBe('- [x] Done\n- [ ] Next');
    expect(page.editor.state.doc.lastChild?.type.name).toBe('paragraph');
  });

  it('lose the checkbox, then the list, on Backspace at the start', () => {
    const page = mount('- [ ] []Task');
    press(page.editor, 'Backspace');
    expect(page.markdown()).toBe('- Task');
    press(page.editor, 'Backspace');
    expect(page.markdown()).toBe('Task');
  });
});

describe('adjacent lists', () => {
  it('join when an edit puts two lists of one kind side by side', () => {
    const page = mount('- one\n\nbetween[]\n\n- two');
    const { state } = page.editor;
    const $at = state.selection.$from;
    page.editor.view.dispatch(state.tr.delete($at.before(), $at.after()));
    expect(page.markdown()).toBe('- one\n- two');
  });

  it('stay apart when they are different kinds', () => {
    const page = mount('- one\n\nbetween[]\n\n1. two');
    const { state } = page.editor;
    const $at = state.selection.$from;
    page.editor.view.dispatch(state.tr.delete($at.before(), $at.after()));
    expect(page.markdown()).toBe('- one\n\n1. two');
  });
});

describe('callouts', () => {
  it('are notes named by their type and title', () => {
    const { root } = mount('> [!warning] Mind the gap\n> Text');
    const note = root.querySelector('[role="note"]')!;
    expect(note.getAttribute('aria-label')).toBe('Warning: Mind the gap');
    expect(root.querySelector('button[aria-label="Callout type: Warning"]')).not.toBeNull();
  });

  it('change type from the type menu', async () => {
    const host = testHost();
    host.menuAnswer = 'tip';
    const page = mount('> [!note] Title\n> Text', host);
    page.root.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(page.markdown()).toBe('> [!tip] Title\n>\n> Text');
  });

  it('fold with a real button that changes the Markdown', () => {
    const page = mount('> [!note]+ Title\n> Body');
    const fold = page.root.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(fold.getAttribute('aria-label')).toBe('Collapse Title');
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    fold.click();
    expect(page.markdown()).toBe('> [!note]- Title\n>\n> Body');
    const after = page.root.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(after.getAttribute('aria-expanded')).toBe('false');
    expect(after.getAttribute('aria-label')).toBe('Expand Title');
    expect(page.host.announced).toEqual(['Folded Note: Title.']);
  });

  it('show no fold button unless the callout folds', () => {
    const { root } = mount('> [!note] Title\n> Body');
    expect(root.querySelector<HTMLButtonElement>('button[aria-expanded]')?.hidden).toBe(true);
  });

  it('turn back into text on Backspace at the start of the title', () => {
    const page = mount('> [!note] []Title\n> Body');
    press(page.editor, 'Backspace');
    expect(page.markdown()).toBe('Title\n\nBody');
  });
});

describe('math', () => {
  it('shows its source and edits it in a field opened with Enter', () => {
    const page = mount('Area $\\pi r^2$ here');
    const atom = page.root.querySelector('[data-math]')!;
    expect(atom.textContent).toBe('$\\pi r^2$');
    const pos = page.editor.state.doc.firstChild!.child(0).nodeSize + 1;
    page.editor.view.dispatch(page.editor.state.tr.setSelection(NodeSelection.create(page.editor.state.doc, pos)));
    press(page.editor, 'Enter');
    const field = page.root.querySelector<HTMLInputElement>('input[aria-label="Math source"]')!;
    field.value = '\\tau r';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(page.markdown()).toBe('Area $\\tau r$ here');
    expect(page.editor.state.selection).toBeInstanceOf(TextSelection);
  });

  it('puts the old source back on Escape', () => {
    const page = mount('$x$');
    page.root.querySelector('[data-math]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const field = page.root.querySelector<HTMLInputElement>('input[aria-label="Math source"]')!;
    field.value = 'y';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(page.markdown()).toBe('$x$');
  });
});

describe('inline images', () => {
  it('show a chip and never load an outside source', () => {
    const { root } = mount('See ![A leaf](https://example.com/leaf.png) here');
    const chip = root.querySelector('[role="img"]')!;
    expect(chip.getAttribute('aria-label')).toBe('Image: A leaf');
    expect(root.querySelector('img')).toBeNull();
  });
});
