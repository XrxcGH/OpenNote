// The format target seam: with no target, formatting commands act on the text exactly as before; a target that
// claims the selection gets the command instead.
import { AllSelection, EditorState, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { formatTargetFor, registerFormatTarget } from './formatTarget';
import type { FormatRequest } from './formatTarget';
import { clearFormatting, setHighlight, setTextColor, stepTextSize, toggleHighlight, toggleMark } from './marks';
import { applyTo, marked, markdownOf } from './testing';

const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

/** A target that claims the whole-document selection, standing in for a range of table cells. */
function fakeTarget(received: FormatRequest[]) {
  stops.push(
    registerFormatTarget({
      id: 'test.allSelection',
      claims: (state) => state.selection instanceof AllSelection,
      apply: (request, _state, dispatch) => {
        if (dispatch) received.push(request);
        return true;
      },
    }),
  );
}

function withSelectAll(source: string): EditorState {
  const { doc } = marked(source).state;
  return EditorState.create({ doc, selection: new AllSelection(doc) });
}

describe('the format target seam', () => {
  it('leaves Bold on a text selection exactly as it was with no target', () => {
    expect(applyTo('[a **b**] c', toggleMark('bold'))).toBe('**a b** c');
    expect(applyTo('**[ab]** c', toggleMark('bold'))).toBe('ab c');
  });

  it('leaves text selections to the text when a target claims only its own selections', () => {
    const received: FormatRequest[] = [];
    fakeTarget(received);
    expect(applyTo('[a **b**] c', toggleMark('bold'))).toBe('**a b** c');
    expect(received).toEqual([]);
  });

  it('sends the command to the target that claims the selection, and leaves the text alone', () => {
    const received: FormatRequest[] = [];
    fakeTarget(received);
    const state = withSelectAll('a b');
    expect(formatTargetFor(state)?.id).toBe('test.allSelection');
    let after: EditorState | null = null;
    for (const command of [toggleMark('bold'), setTextColor('fern'), stepTextSize(1), clearFormatting()]) {
      expect(command(state, (tr) => (after = state.apply(tr)))).toBe(true);
    }
    expect(received).toEqual([
      { format: 'bold', toggle: true },
      { format: 'textColor', color: 'fern' },
      { format: 'textSizeStep', direction: 1 },
      { format: 'clear' },
    ]);
    expect(after).toBeNull();
    expect(markdownOf(state)).toBe('a b');
  });

  it('tells the target whether a highlight toggles, sets a color, or comes off', () => {
    const received: FormatRequest[] = [];
    fakeTarget(received);
    const state = withSelectAll('a b');
    const commands = [
      toggleHighlight(),
      toggleHighlight('mint'),
      setHighlight('rose'),
      setHighlight(null),
      setHighlight('none'),
    ];
    for (const command of commands) expect(command(state, () => {})).toBe(true);
    expect(received).toEqual([
      { format: 'highlight', color: null, toggle: true },
      { format: 'highlight', color: 'mint', toggle: true },
      { format: 'highlight', color: 'rose', toggle: false },
      { format: 'highlight', color: null, toggle: false },
      { format: 'highlight', color: 'none', toggle: false },
    ]);
  });

  it('asks the target without dispatching when a command only checks', () => {
    const received: FormatRequest[] = [];
    fakeTarget(received);
    expect(toggleMark('italic')(withSelectAll('a'))).toBe(true);
    expect(received).toEqual([]);
  });

  it('stops asking a target once it is removed', () => {
    const received: FormatRequest[] = [];
    fakeTarget(received);
    stops.splice(0).forEach((stop) => stop());
    const { doc } = marked('ab').state;
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 3) });
    expect(formatTargetFor(state)).toBeNull();
    expect(formatTargetFor(withSelectAll('ab'))).toBeNull();
  });
});
