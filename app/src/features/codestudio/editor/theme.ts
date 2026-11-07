// The editor's look, from the app's tokens: the --color-code-* syntax colors and the surface, text, and focus
// tokens. Light, dark, and forced colors all come from tokens.css (forced colors maps them to system colors), so one
// theme serves all three. Animations stop under reduced motion.

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const highlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword],
    color: 'var(--color-code-keyword)',
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character], color: 'var(--color-code-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--color-code-number)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: 'var(--color-code-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName],
    color: 'var(--color-code-function)',
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName)],
    color: 'var(--color-code-type)',
  },
  {
    tag: [tags.variableName, tags.propertyName, tags.attributeName, tags.labelName],
    color: 'var(--color-code-variable)',
  },
  { tag: [tags.punctuation, tags.bracket, tags.operator, tags.separator], color: 'var(--color-code-punctuation)' },
  { tag: tags.invalid, textDecoration: 'underline wavy' },
]);

const base = EditorView.theme({
  '&': {
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-surface-page)',
    fontSize: 'calc(var(--type-body-size) * var(--code-zoom, 1))',
    height: '100%',
  },
  '&.cm-focused': { outline: 'var(--size-focus-ring-width) solid var(--color-focus-ring)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5', touchAction: 'pan-x pan-y' },
  '.cm-content': { caretColor: 'var(--color-text-primary)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-text-primary)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--color-surface-selected)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--color-surface-hover)' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface-sunken)',
    color: 'var(--color-text-muted)',
    borderRight: '1px solid var(--color-border-subtle)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' },
  '.cm-matchingBracket': { outline: '1px solid var(--color-border-control)' },
  '.cm-searchMatch': { backgroundColor: 'var(--color-selection-highlight)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--color-accent-primary-subtle)' },
  '.cm-indent-guide': {
    backgroundImage: 'linear-gradient(to right, var(--color-border-subtle) 1px, transparent 1px)',
    backgroundSize: 'var(--code-indent-width, 4ch) 100%',
    backgroundRepeat: 'repeat-x',
  },
  '.cm-ghost-text': { color: 'var(--color-text-muted)', whiteSpace: 'pre', fontStyle: 'italic' },
  '.cm-ghost-accept': {
    minWidth: 'var(--size-target-touch)',
    minHeight: 'var(--size-target-touch)',
    marginInlineStart: 'var(--space-1)',
    verticalAlign: 'middle',
    border: '1px solid var(--color-border-control)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-surface-raised)',
    color: 'var(--color-text-primary)',
    cursor: 'pointer',
  },
  '.cm-ghost-accept[hidden]': { display: 'none' },
  '.cm-ghost-menu': {
    position: 'absolute',
    zIndex: '10',
    display: 'flex',
    flexDirection: 'column',
    padding: 'var(--space-1)',
    border: '1px solid var(--color-border-control)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface-raised)',
  },
  '.cm-ghost-menu button': {
    minHeight: 'var(--size-target-touch)',
    textAlign: 'start',
    border: 'none',
    background: 'transparent',
    color: 'var(--color-text-primary)',
  },
  '.cm-thinking': { color: 'var(--color-text-muted)', animation: 'cm-thinking 1s steps(3) infinite' },
  '@keyframes cm-thinking': { from: { opacity: '0.4' }, to: { opacity: '1' } },
  '@media (prefers-reduced-motion: reduce)': { '.cm-thinking': { animation: 'none' } },
  '.cm-breakpoint-gutter .cm-gutterElement': { cursor: 'pointer', minWidth: '1.2em' },
  '.cm-breakpoint': { color: 'var(--color-status-danger)' },
  '.cm-current-line-arrow': { color: 'var(--color-status-warning)' },
  '.cm-current-line': { backgroundColor: 'var(--color-accent-candle-subtle)' },
  '.cm-inline-value': { color: 'var(--color-text-secondary)', marginInlineStart: '2ch', fontStyle: 'italic' },
  '.cm-diff-inserted': { backgroundColor: 'var(--color-accent-primary-subtle)' },
  '.cm-diff-deleted': { backgroundColor: 'var(--color-accent-candle-subtle)', textDecoration: 'line-through' },
  '.cm-diff-deleted-block': { color: 'var(--color-text-secondary)', whiteSpace: 'pre', textDecoration: 'line-through' },
});

/** The theme and the syntax colors. */
export function codeTheme(): Extension {
  return [base, syntaxHighlighting(highlight)];
}
