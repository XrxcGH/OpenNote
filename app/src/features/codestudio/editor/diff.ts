// A read-only diff view, side by side, or inline, for model-written fixes and test output (lanes code:L13b and
// code:L15). The line diff is the longest common subsequence of lines (the textbook dynamic program), which is fine
// for the file sizes the studio allows; very long inputs fall back to one replaced block.

import { EditorState, RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, lineNumbers } from '@codemirror/view';
import { codeTheme } from './theme';

export type DiffOp = { kind: 'same' | 'deleted' | 'inserted'; text: string };

/** Past this many line pairs the diff gives up on alignment and shows one replaced block. */
const MAX_CELLS = 4_000_000;

/** The line diff of two texts, in order: unchanged, deleted (from the first), and inserted (from the second) lines. */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ kind: 'deleted' as const, text })),
      ...b.map((text) => ({ kind: 'inserted' as const, text })),
    ];
  }
  // lengths[i][j]: the longest common subsequence of a[i..] and b[j..].
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      ops.push({ kind: 'deleted', text: a[i++] });
    } else {
      ops.push({ kind: 'inserted', text: b[j++] });
    }
  }
  while (i < a.length) ops.push({ kind: 'deleted', text: a[i++] });
  while (j < b.length) ops.push({ kind: 'inserted', text: b[j++] });
  return ops;
}

class DeletedLines extends WidgetType {
  constructor(readonly lines: readonly string[]) {
    super();
  }
  eq(other: DeletedLines) {
    return other.lines.join('\n') === this.lines.join('\n');
  }
  toDOM() {
    const block = document.createElement('div');
    block.className = 'cm-diff-deleted-block';
    block.textContent = this.lines.join('\n');
    return block;
  }
}

function readOnlyEditor(parent: HTMLElement, doc: string, extra: Extension, label: string): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ 'aria-label': label }),
        lineNumbers(),
        codeTheme(),
        extra,
      ],
    }),
  });
}

/** Line decorations for one side: the lines of `kind` in that side's text. */
function sideDecorations(ops: readonly DiffOp[], kind: 'deleted' | 'inserted', doc: string): Extension {
  const state = EditorState.create({ doc });
  const builder = new RangeSetBuilder<Decoration>();
  let line = 1;
  for (const op of ops) {
    if (op.kind !== 'same' && op.kind !== kind) continue;
    if (op.kind === kind)
      builder.add(state.doc.line(line).from, state.doc.line(line).from, Decoration.line({ class: `cm-diff-${kind}` }));
    line++;
  }
  return EditorView.decorations.of(builder.finish());
}

/** The inline view: the new text, inserted lines marked, deleted lines shown above as struck-through blocks. */
function inlineDecorations(ops: readonly DiffOp[], doc: string): Extension {
  const state = EditorState.create({ doc });
  const builder = new RangeSetBuilder<Decoration>();
  let line = 1;
  let deleted: string[] = [];
  const flush = (at: number, side: -1 | 1) => {
    if (deleted.length)
      builder.add(at, at, Decoration.widget({ widget: new DeletedLines(deleted), block: true, side }));
    deleted = [];
  };
  for (const op of ops) {
    if (op.kind === 'deleted') {
      deleted.push(op.text);
      continue;
    }
    const from = state.doc.line(line).from;
    flush(from, -1);
    if (op.kind === 'inserted') builder.add(from, from, Decoration.line({ class: 'cm-diff-inserted' }));
    line++;
  }
  flush(state.doc.length, 1);
  return EditorView.decorations.of(builder.finish());
}

export interface DiffViewOptions {
  original: string;
  modified: string;
  mode: 'sideBySide' | 'inline';
  /** Language support, such as the result of loadLanguage. */
  language?: Extension;
  labels: { original: string; modified: string };
}

export interface DiffView {
  readonly views: readonly EditorView[];
  destroy(): void;
}

/** A read-only diff view in `container`. */
export function createDiffView(container: HTMLElement, options: DiffViewOptions): DiffView {
  const ops = diffLines(options.original, options.modified);
  const language = options.language ?? [];
  const views: EditorView[] = [];
  if (options.mode === 'inline') {
    views.push(
      readOnlyEditor(
        container,
        options.modified,
        [language, inlineDecorations(ops, options.modified)],
        options.labels.modified,
      ),
    );
  } else {
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '1fr 1fr';
    views.push(
      readOnlyEditor(
        container,
        options.original,
        [language, sideDecorations(ops, 'deleted', options.original)],
        options.labels.original,
      ),
      readOnlyEditor(
        container,
        options.modified,
        [language, sideDecorations(ops, 'inserted', options.modified)],
        options.labels.modified,
      ),
    );
  }
  return { views, destroy: () => views.forEach((view) => view.destroy()) };
}
