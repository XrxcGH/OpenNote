// Smaller editor extensions: indent guides, expand, and shrink selection, breakpoint markers with the current-line
// arrow (for the debugger lanes), and inline values (for the trace replay).

import { selectParentSyntax } from '@codemirror/commands';
import { RangeSet, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { EditorSelection, Extension, Text } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';

// --- Indent guides: the leading whitespace of each visible line carries a ruled background, one rule per stop.

const guideMark = Decoration.mark({ class: 'cm-indent-guide' });

function guides(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const lead = /^[ \t]+/.exec(line.text)?.[0].length ?? 0;
      if (lead > 0 && lead < line.length) builder.add(line.from, line.from + lead, guideMark);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = guides(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = guides(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// --- Expand and shrink selection (Shift+Alt+Right and Left). Expanding remembers each step so shrinking walks back.

const pushSelection = StateEffect.define<EditorSelection>();
const popSelection = StateEffect.define<null>();

const selectionStack = StateField.define<readonly EditorSelection[]>({
  create: () => [],
  update(stack, tr) {
    for (const effect of tr.effects) {
      if (effect.is(pushSelection)) return [...stack, effect.value];
      if (effect.is(popSelection)) return stack.slice(0, -1);
    }
    return tr.docChanged || tr.selection ? [] : stack;
  },
});

export function expandSelection(view: EditorView): boolean {
  const before = view.state.selection;
  if (!selectParentSyntax(view)) return false;
  const after = view.state.selection;
  if (after.eq(before)) return false;
  view.dispatch({ selection: before });
  view.dispatch({ selection: after, effects: pushSelection.of(before) });
  return true;
}

export function shrinkSelection(view: EditorView): boolean {
  const stack = view.state.field(selectionStack, false) ?? [];
  const previous = stack[stack.length - 1];
  if (!previous) return false;
  view.dispatch({ selection: previous, effects: popSelection.of(null) });
  return true;
}

// --- Breakpoints and the current line, in a gutter of their own.

export const setBreakpoints = StateEffect.define<readonly number[]>();
export const setCurrentLine = StateEffect.define<number | null>();

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-breakpoint';
    span.textContent = '●';
    return span;
  }
}

class ArrowMarker extends GutterMarker {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-current-line-arrow';
    span.textContent = '▶';
    return span;
  }
}

/** Keeps the gutter one marker wide; never drawn. */
class SpacerMarker extends GutterMarker {
  toDOM() {
    const span = document.createElement('span');
    span.textContent = '●';
    return span;
  }
}

const breakpointMarker = new BreakpointMarker();
const arrowMarker = new ArrowMarker();

interface DebugMarks {
  breakpoints: readonly number[];
  current: number | null;
  /** The current line's highlight. */
  line: DecorationSet;
}

function lineDecoration(doc: Text, line: number | null): DecorationSet {
  if (line === null || line < 1 || line > doc.lines) return Decoration.none;
  return Decoration.set([Decoration.line({ class: 'cm-current-line' }).range(doc.line(line).from)]);
}

const debugMarksField = StateField.define<DebugMarks>({
  create: () => ({ breakpoints: [], current: null, line: Decoration.none }),
  update(value, tr) {
    let next = tr.docChanged ? { ...value, line: value.line.map(tr.changes) } : value;
    for (const effect of tr.effects) {
      if (effect.is(setBreakpoints)) next = { ...next, breakpoints: effect.value };
      if (effect.is(setCurrentLine))
        next = { ...next, current: effect.value, line: lineDecoration(tr.state.doc, effect.value) };
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (marks) => marks.line),
});

/** Breakpoint markers, the current-line arrow, and a click handler that toggles a breakpoint on a line. */
export function debugGutter(onToggle?: (line: number) => void): Extension {
  return [
    debugMarksField,
    gutter({
      class: 'cm-breakpoint-gutter',
      markers: (view) => {
        const { breakpoints, current } = view.state.field(debugMarksField);
        const builder = new RangeSetBuilder<GutterMarker>();
        const lines = [...new Set([...breakpoints, ...(current === null ? [] : [current])])].sort((a, b) => a - b);
        for (const n of lines) {
          if (n < 1 || n > view.state.doc.lines) continue;
          const from = view.state.doc.line(n).from;
          builder.add(from, from, n === current ? arrowMarker : breakpointMarker);
        }
        return builder.finish();
      },
      initialSpacer: () => new SpacerMarker(),
      domEventHandlers: {
        mousedown(view, block) {
          if (!onToggle) return false;
          onToggle(view.state.doc.lineAt(block.from).number);
          return true;
        },
      },
    }),
  ];
}

// --- Inline values at the end of lines (the trace replay's variables).

export interface InlineValue {
  line: number;
  text: string;
}

export const setInlineValues = StateEffect.define<readonly InlineValue[]>();

class ValueWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: ValueWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-inline-value';
    span.textContent = this.text;
    return span;
  }
}

export const inlineValuesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setInlineValues)) continue;
      const ranges = effect.value
        .filter(({ line }) => line >= 1 && line <= tr.state.doc.lines)
        .sort((a, b) => a.line - b.line)
        .map(({ line, text }) =>
          Decoration.widget({ widget: new ValueWidget(text), side: 1 }).range(tr.state.doc.line(line).to),
        );
      next = RangeSet.of(ranges);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const markExtensions: Extension = [indentGuides, selectionStack, inlineValuesField];
