// @vitest-environment jsdom
// Outline moves, levels, and folding in a mounted editor. Moves swap items and heading sections and stop at the
// edges. Levels refuse past heading 1 and 6. Fold buttons are real buttons with aria-expanded, and folded content
// gets `hidden`. Fold keys survive a reload, and unfoldTo uncovers a position.
import { afterEach, describe, expect, it } from 'vitest';
import { foldKeysFor, foldsOf, positionsFor, setFolds, unfoldTo } from '../commands/fold';
import { runOutline } from '../commands/outlineRun';
import { mountEditor } from '../commands/testing';
import type { TestEditor } from '../commands/testing';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

function mount(source: string): TestEditor {
  mounted = mountEditor(source);
  return mounted;
}

describe('outline moves', () => {
  it('swap list items and keep the caret in the moved one', () => {
    const page = mount('- one\n- t[]wo\n- three');
    expect(runOutline(page.editor, 'outline.moveUp')).toBe(true);
    expect(page.markdown()).toBe('- two\n- one\n- three');
    expect(page.editor.state.selection.$from.parent.textContent).toBe('two');
    expect(page.host.announced).toEqual(['Moved up.']);
  });

  it('stop at the edge with an announcement', () => {
    const page = mount('- o[]ne\n- two');
    expect(runOutline(page.editor, 'outline.moveUp')).toBe(false);
    expect(page.markdown()).toBe('- one\n- two');
    expect(page.host.announced).toEqual(['Top of the text box.']);
  });

  it('move a heading with its section past the next section', () => {
    const page = mount('## A[]\n\na text\n\n## B\n\nb text');
    runOutline(page.editor, 'outline.moveDown');
    expect(page.markdown()).toBe('## B\n\nb text\n\n## A\n\na text');
  });
});

describe('outline levels', () => {
  it('demote and promote a list item with its children', () => {
    const page = mount('- one\n- t[]wo\n  - child');
    runOutline(page.editor, 'outline.demote');
    expect(page.markdown()).toBe('- one\n\n  - two\n\n    - child');
    expect(page.host.announced.at(-1)).toBe('Level 2.');
  });

  it('shift a heading and its subheadings, and refuse past heading 6', () => {
    const page = mount('## A[]\n\n### Sub\n\n## B');
    runOutline(page.editor, 'outline.demote');
    expect(page.markdown()).toBe('### A\n\n#### Sub\n\n## B');
    const deep = mount('##### A[]\n\n###### Sub');
    expect(runOutline(deep.editor, 'outline.demote')).toBe(false);
    expect(deep.host.announced).toEqual(['Heading 6 is the deepest level.']);
  });

  it('say that a paragraph has no level', () => {
    const page = mount('plain[]');
    runOutline(page.editor, 'outline.promote');
    expect(page.host.announced).toEqual(['Only list items and headings change level.']);
  });
});

describe('folding', () => {
  const buttons = (page: TestEditor) => [...page.root.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];

  it('gives headings and list items with children a named fold button, outside the Tab order', () => {
    const page = mount('## Light reactions\n\nText\n\n- item\n  - child\n- leaf');
    const found = buttons(page);
    expect(found.map((button) => [button.getAttribute('aria-label'), button.getAttribute('aria-expanded')])).toEqual([
      ['Collapse Light reactions', 'true'],
      ['Collapse item', 'true'],
    ]);
    expect(found.every((button) => button.tabIndex === -1)).toBe(true);
    expect(page.root.querySelector('h2')?.hasAttribute('aria-expanded')).toBe(false);
    expect(page.root.querySelector('li')?.hasAttribute('aria-expanded')).toBe(false);
  });

  it('hides the section when folded, announces it, and shows it again', () => {
    const page = mount('## Light reactions\n\nOne\n\nTwo\n\n## Next');
    buttons(page)[0].click();
    const hidden = [...page.root.querySelectorAll('p')].map((p) => p.hidden);
    expect(hidden).toEqual([true, true]);
    expect(buttons(page)[0].getAttribute('aria-expanded')).toBe('false');
    expect(buttons(page)[0].getAttribute('aria-label')).toBe('Expand Light reactions');
    expect(page.host.announced).toEqual(['Folded Light reactions, 2 paragraphs hidden.']);
    buttons(page)[0].click();
    expect([...page.root.querySelectorAll('p')].some((p) => p.hidden)).toBe(false);
  });

  it('folds with the commands, shows levels, and shows everything', () => {
    const page = mount('# A[]\n\n## B\n\nText\n\n## C\n\nMore');
    runOutline(page.editor, 'outline.showLevel2');
    expect(foldsOf(page.editor.state)).toHaveLength(2);
    runOutline(page.editor, 'outline.showAll');
    expect(foldsOf(page.editor.state)).toEqual([]);
    runOutline(page.editor, 'outline.fold');
    expect(foldsOf(page.editor.state)).toEqual([0]);
    runOutline(page.editor, 'outline.unfold');
    expect(foldsOf(page.editor.state)).toEqual([]);
  });

  it('keeps folds through typing, saves them as keys, and finds them again', () => {
    const page = mount('## A\n\nText\n\n## A\n\nMore');
    const second = page.editor.state.doc.child(0).nodeSize + page.editor.state.doc.child(1).nodeSize;
    page.editor.view.dispatch(setFolds(page.editor.state.tr, [second]));
    page.editor.view.dispatch(page.editor.state.tr.insertText('x', page.editor.state.doc.child(0).nodeSize + 2));
    const keys = foldKeysFor(page.editor.state.doc, 'b1');
    expect(keys).toEqual([{ block: 'b1', kind: 'heading', text: 'A', occurrence: 1 }]);
    expect(positionsFor(page.editor.state.doc, keys)).toEqual(foldsOf(page.editor.state));
  });

  it('unfolds whatever hides a position', () => {
    const page = mount('## A\n\nHidden text');
    page.editor.view.dispatch(setFolds(page.editor.state.tr, [0]));
    const inside = page.editor.state.doc.child(0).nodeSize + 2;
    expect(unfoldTo(page.editor, inside)).toBe(true);
    expect(foldsOf(page.editor.state)).toEqual([]);
    expect(unfoldTo(page.editor, inside)).toBe(false);
  });
});
