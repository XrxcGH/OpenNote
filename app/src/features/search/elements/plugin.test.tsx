// T3-3: a right-click moves the caret to the clicked line, and inside a multi-line selection the link and tag commands
// narrow to the clicked line while the selection stays for copy and cut until a command runs.
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHost } from '../../../editor/host';
import { actOnClickedLine, elementExtensions } from './plugin';

let editor: Editor | null = null;
afterEach(() => {
  const host = editor?.view.dom.parentElement;
  editor?.destroy();
  host?.remove();
  editor = null;
});

function make(): Editor {
  const element = document.body.appendChild(document.createElement('div'));
  element.style.width = '400px';
  editor = new Editor({
    element,
    extensions: [StarterKit, elementExtensions({} as EditorHost, { tags: false, links: true })],
    content: '<p>Alpha one</p><p>Bravo two</p><p>Charlie three</p><p>Delta four</p>',
  });
  return editor;
}

/** The document position inside the nth paragraph, from where the browser lays it out. */
function insideParagraph(ed: Editor, n: number): { pos: number; x: number; y: number } {
  const node = ed.view.dom.children[n] as HTMLElement;
  const rect = node.getBoundingClientRect();
  const x = rect.left + 6;
  const y = rect.top + rect.height / 2;
  return { pos: ed.view.posAtCoords({ left: x, top: y })!.pos, x, y };
}

const rightClick = (ed: Editor, x: number, y: number) =>
  ed.view.dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));

describe('right-click on typed text', () => {
  it('moves the caret to the clicked line when it is outside the selection', () => {
    const ed = make();
    ed.commands.setTextSelection(insideParagraph(ed, 0).pos);
    const fifth = insideParagraph(ed, 3);
    rightClick(ed, fifth.x, fifth.y);
    expect(ed.state.selection.$from.parent.textContent).toBe('Delta four');
  });

  it('keeps a multi-line selection for copy, then narrows to the clicked line for a link or tag command', () => {
    const ed = make();
    const first = insideParagraph(ed, 0);
    const last = insideParagraph(ed, 3);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, first.pos, last.pos)));
    const middle = insideParagraph(ed, 1);
    rightClick(ed, middle.x, middle.y);
    expect(ed.state.selection.from).toBe(first.pos);
    expect(ed.state.selection.to).toBe(last.pos);
    actOnClickedLine(ed.view);
    expect(ed.state.selection.empty).toBe(true);
    expect(ed.state.selection.$from.parent.textContent).toBe('Bravo two');
  });

  it('does not narrow after the selection has moved on', () => {
    const ed = make();
    const first = insideParagraph(ed, 0);
    const last = insideParagraph(ed, 3);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, first.pos, last.pos)));
    const middle = insideParagraph(ed, 1);
    rightClick(ed, middle.x, middle.y);
    ed.commands.setTextSelection(insideParagraph(ed, 2).pos);
    actOnClickedLine(ed.view);
    expect(ed.state.selection.$from.parent.textContent).toBe('Charlie three');
  });
});
