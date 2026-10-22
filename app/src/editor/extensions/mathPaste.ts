// Pasting LaTeX makes equations. Text that holds $x^2$, $$…$$, \(…\), \[…\], or a \begin{equation} block becomes
// equations between the words around it, and a paste of nothing but LaTeX (\frac{a}{b}) becomes one equation. Plain
// words and prices such as "$5 and $6" are left alone. The splitting is pure so the Insert LaTeX window shares it.
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { META_COMMAND } from '../meta';

export type LatexPiece = { kind: 'text'; text: string } | { kind: 'math'; source: string; display: boolean };

const ENVIRONMENTS = 'equation|equation\\*|align|align\\*|gather|gather\\*|multline|multline\\*|eqnarray|displaymath';

const ENV_ESCAPED = ENVIRONMENTS.replaceAll('*', String.raw`\*`);

/**
 * Delimited math, tried in this order at each position. Inline dollars cannot start or end with a space (so
 * "$5 and $6" is text).
 */
const DELIMITED = new RegExp(
  [
    String.raw`\$\$([\s\S]+?)\$\$`,
    String.raw`\\\[([\s\S]+?)\\\]`,
    String.raw`(\\begin\{(?:${ENV_ESCAPED})\}[\s\S]+?\\end\{(?:${ENV_ESCAPED})\})`,
    String.raw`\\\(([\s\S]+?)\\\)`,
    String.raw`(?<![$\w\\])\$([^$\s](?:[^$]*[^$\s])?)\$(?!\d)`,
  ].join('|'),
  'g',
);

const COMMAND = /\\[A-Za-z]+/g;

/** Commands only LaTeX has, so a pasted \name that is not one of these (such as a Windows path) stays text. */
const KNOWN_WORDS = [
  'd?frac|sqrt|sum|prod|int|oint|lim|alpha|beta|gamma|delta|epsilon',
  'varepsilon|theta|lambda|mu|pi|rho|sigma|tau|phi|varphi|omega|Delta',
  'Sigma|Omega|Gamma|Theta|Lambda|Phi|Psi|cdot|cdots|times|pm|mp',
  'infty|approx|neq|leq|geq|le|ge|to|rightarrow|Rightarrow|vec|hat',
  'bar|partial|nabla|mathrm|mathbf|mathbb|text|left|right|begin|sin|cos',
  'tan|log|ln|exp|binom|over',
].join('|');
const KNOWN_COMMAND = new RegExp(String.raw`\\(?:${KNOWN_WORDS})\b`);

/** True for text that is LaTeX with no words around it, such as `\frac{a}{b}` or `x^{2}+y_{1}`. */
export function looksLikeLatex(text: string): boolean {
  const body = text.trim();
  if (body === '' || body.length > 4000) return false;
  if (/^[A-Za-z]:\\/.test(body)) return false;
  if (!KNOWN_COMMAND.test(body) && !/[\^_]\{/.test(body)) return false;
  // Words left after the commands are taken away mean this is a sentence, not an equation.
  const rest = body.replace(/\\(?:text|mathrm|mathbf|operatorname)\{[^}]*\}/g, '').replace(COMMAND, ' ');
  return !/[A-Za-z]{4,}/.test(rest) && !/\w\s+\w{2,}\s+\w/.test(rest.replace(/[{}^_]/g, ' ').trim());
}

/**
 * Splits text into words and equations. Null when it holds no LaTeX at all. A paste that is only LaTeX comes back as
 * one equation, displayed when it spans lines or uses \\ or an environment.
 */
export function splitLatex(text: string): LatexPiece[] | null {
  const pieces: LatexPiece[] = [];
  let last = 0;
  for (const match of text.matchAll(DELIMITED)) {
    const index = match.index ?? 0;
    const [whole, doubled, bracket, environment, paren, single] = match;
    const source = (doubled ?? bracket ?? environment ?? paren ?? single ?? '').trim();
    if (source === '') continue;
    if (index > last) pieces.push({ kind: 'text', text: text.slice(last, index) });
    const display = doubled !== undefined || bracket !== undefined || environment !== undefined;
    pieces.push({ kind: 'math', source: environment !== undefined ? whole.trim() : source, display });
    last = index + whole.length;
  }
  if (pieces.length > 0) {
    if (last < text.length) pieces.push({ kind: 'text', text: text.slice(last) });
    return pieces;
  }
  if (looksLikeLatex(text)) {
    const source = text.trim();
    return [{ kind: 'math', source, display: /\n|\\\\|\\begin\{/.test(source) }];
  }
  return null;
}

/** The nodes for pieces: words and inline equations, or a single display equation in place of an empty line. */
function nodesFor(schema: Schema, pieces: readonly LatexPiece[], emptyLine: boolean): PMNode[] | 'block' | null {
  const inline = schema.nodes.mathInline;
  const block = schema.nodes.mathBlock;
  if (!inline) return null;
  if (emptyLine && block && pieces.length === 1 && pieces[0].kind === 'math' && pieces[0].display) return 'block';
  const out: PMNode[] = [];
  for (const piece of pieces) {
    if (piece.kind === 'math') {
      out.push(inline.create({ source: piece.source.replace(/\s*\n\s*/g, ' ') }));
    } else {
      const lines = piece.text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (index > 0) out.push(schema.nodes.hardBreak ? schema.nodes.hardBreak.create() : schema.text(' '));
        if (line !== '') out.push(schema.text(line));
      });
    }
  }
  return out;
}

const key = new PluginKey('opennoteMathPaste');

export function mathPastePlugin(): Plugin {
  return new Plugin({
    key,
    props: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (!view.editable || text === '' || text.length > 100_000) return false;
        const { state } = view;
        const { $from } = state.selection;
        if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
        const pieces = splitLatex(text);
        if (pieces === null || !pieces.some((piece) => piece.kind === 'math')) return false;
        const emptyLine =
          state.selection.empty && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
        const made = nodesFor(state.schema, pieces, emptyLine);
        if (made === null) return false;
        const { tr } = state;
        if (made === 'block') {
          const piece = pieces[0] as Extract<LatexPiece, { kind: 'math' }>;
          const node = state.schema.nodes.mathBlock.create({ source: piece.source });
          tr.replaceWith($from.before(), $from.after(), node);
          const after = $from.before() + node.nodeSize;
          tr.insert(after, state.schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, after + 1));
        } else {
          tr.replaceSelection(new Slice(Fragment.from(made), 0, 0));
        }
        view.dispatch(tr.setMeta(META_COMMAND, true).scrollIntoView());
        return true;
      },
    },
  });
}
