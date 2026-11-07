// Select text with similar formatting (owner: text:editor-commands; text DESIGN.md 4.1): every range of the block
// whose run formats equal those at the caret. The ranges become one selection of several ranges, so a format
// command that follows applies to all of them. Content and review marks (links, comments) don't count.
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { Selection, SelectionRange, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import type { Command } from './command';
import { CONTENT_MARKS } from './runFormat';

/** A selection of several text ranges. The browser draws none of it; the editor draws the ranges itself. */
export class RangesSelection extends Selection {
  constructor(ranges: readonly SelectionRange[]) {
    super(ranges[0].$from, ranges[ranges.length - 1].$to, [...ranges]);
    this.visible = false;
  }

  map(doc: PMNode, mapping: Mappable): Selection {
    const ranges = this.ranges
      .map((range) => {
        const from = mapping.map(range.$from.pos, 1);
        const to = mapping.map(range.$to.pos, -1);
        return from < to ? new SelectionRange(doc.resolve(from), doc.resolve(to)) : null;
      })
      .filter((range): range is SelectionRange => range !== null);
    return ranges.length > 0 ? new RangesSelection(ranges) : TextSelection.near(doc.resolve(mapping.map(this.from)));
  }

  eq(other: Selection): boolean {
    return (
      other instanceof RangesSelection &&
      other.ranges.length === this.ranges.length &&
      other.ranges.every(
        (range, i) => range.$from.pos === this.ranges[i].$from.pos && range.$to.pos === this.ranges[i].$to.pos,
      )
    );
  }

  toJSON(): { type: string; ranges: [number, number][] } {
    return { type: 'opennoteRanges', ranges: this.ranges.map((range) => [range.$from.pos, range.$to.pos]) };
  }

  static fromJSON(doc: PMNode, json: { ranges?: [number, number][] }): Selection {
    const ranges = (json.ranges ?? []).map(([from, to]) => new SelectionRange(doc.resolve(from), doc.resolve(to)));
    return ranges.length > 0 ? new RangesSelection(ranges) : Selection.atStart(doc);
  }
}

Selection.jsonID('opennoteRanges', RangesSelection);

/** The run formats of a set of marks, as a comparable key. */
function formatKey(marks: readonly Mark[]): string {
  return marks
    .filter((mark) => !CONTENT_MARKS.has(mark.type.name))
    .map((mark) => `${mark.type.name}${JSON.stringify(mark.attrs)}`)
    .sort()
    .join('|');
}

/** The marks at the caret, or of the selection's first character. */
function marksAtStart(state: EditorState): readonly Mark[] {
  const { selection } = state;
  if (selection.empty) return selection.$from.marks();
  return selection.$from.nodeAfter?.marks ?? selection.$from.marks();
}

/** The ranges of the document whose run formats equal those at the selection. Neighboring runs join. */
export function similarRanges(state: EditorState): { from: number; to: number }[] {
  const wanted = formatKey(marksAtStart(state));
  const found: { from: number; to: number }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (formatKey(node.marks) !== wanted) return false;
    const last = found[found.length - 1];
    if (last && last.to === pos) last.to = pos + node.nodeSize;
    else found.push({ from: pos, to: pos + node.nodeSize });
    return false;
  });
  return found;
}

/** Selects every range with the formatting at the caret. False when there is no such text. */
export function selectSimilar(): Command {
  return (state, dispatch) => {
    const found = similarRanges(state);
    if (found.length === 0) return false;
    if (dispatch) {
      const ranges = found.map(({ from, to }) => new SelectionRange(state.doc.resolve(from), state.doc.resolve(to)));
      const selection =
        ranges.length === 1 ? TextSelection.create(state.doc, found[0].from, found[0].to) : new RangesSelection(ranges);
      dispatch(state.tr.setSelection(selection));
    }
    return true;
  };
}
