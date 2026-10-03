// The markdown-it rules that the OpenNote dialect adds to CommonMark and strikethrough (SPEC 7.3): highlights with
// `==`, inline math with `$...$`, and display math between `$$` lines. Callouts, task items, and the allowed HTML
// tags are read from the token stream in parse.ts and inline.ts instead, because they need the raw source.
import MarkdownIt from 'markdown-it';
import type { Delimiter, MarkdownIt as Md, StateBlock, StateInline } from 'markdown-it';

const { isWhiteSpace } = new MarkdownIt().utils;

const EQUALS = 0x3d;
const DOLLAR = 0x24;

function isSpaceAt(src: string, at: number): boolean {
  return at < 0 || at >= src.length || isWhiteSpace(src.charCodeAt(at));
}

/** A run of `==`. It opens when the next character is not whitespace and closes when the previous one is not. */
function highlightTokenize(state: StateInline, silent: boolean): boolean {
  const { src, pos: start } = state;
  if (silent || src.charCodeAt(start) !== EQUALS) return false;
  let end = start;
  while (end < state.posMax && src.charCodeAt(end) === EQUALS) end++;
  if (end - start < 2) return false;
  const open = !isSpaceAt(src, end);
  const close = !isSpaceAt(src, start - 1);
  let length = end - start;
  if (length % 2) {
    state.push('text', '', 0).content = '=';
    length--;
  }
  for (let i = 0; i < length; i += 2) {
    state.push('text', '', 0).content = '==';
    const delimiter: Delimiter = { marker: EQUALS, length: 0, token: state.tokens.length - 1, end: -1, open, close };
    state.delimiters.push(delimiter);
  }
  state.pos = end;
  return true;
}

function highlightPair(state: StateInline, delimiters: Delimiter[]): void {
  const lone: number[] = [];
  for (const start of delimiters) {
    if (start.marker !== EQUALS || start.end === -1) continue;
    const end = delimiters[start.end];
    Object.assign(state.tokens[start.token], { type: 'mark_open', tag: 'mark', nesting: 1, markup: '==', content: '' });
    Object.assign(state.tokens[end.token], { type: 'mark_close', tag: 'mark', nesting: -1, markup: '==', content: '' });
    const before = state.tokens[end.token - 1];
    if (before.type === 'text' && before.content === '=') lone.push(end.token - 1);
  }
  // An odd run is split as `=` then `==`. Move the lone `=` after the closers that follow it.
  for (let i = lone.pop(); i !== undefined; i = lone.pop()) {
    let j = i + 1;
    while (j < state.tokens.length && state.tokens[j].type === 'mark_close') j++;
    j--;
    if (i !== j) [state.tokens[i], state.tokens[j]] = [state.tokens[j], state.tokens[i]];
  }
}

function highlightPostProcess(state: StateInline): void {
  highlightPair(state, state.delimiters);
  for (const meta of state.tokens_meta) {
    if (meta?.delimiters) highlightPair(state, meta.delimiters);
  }
}

/** `$math$`: the opening `$` is followed by a non-space and the closing `$` is preceded by one. */
function mathInline(state: StateInline, silent: boolean): boolean {
  const { src, pos: start, posMax } = state;
  if (src.charCodeAt(start) !== DOLLAR || start + 1 >= posMax) return false;
  if (isSpaceAt(src, start + 1) || src.charCodeAt(start + 1) === DOLLAR) return false;
  let at = start + 1;
  while (at < posMax && src.charCodeAt(at) !== DOLLAR) {
    if (src[at] === '\n') return false;
    at += src[at] === '\\' ? 2 : 1;
  }
  if (at >= posMax || isSpaceAt(src, at - 1)) return false;
  if (!silent) {
    const token = state.push('math_inline', '', 0);
    token.content = src.slice(start + 1, at);
    token.markup = '$';
  }
  state.pos = at + 1;
  return true;
}

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
}

/** `$$` on its own line, the source, then `$$` on its own line. Like a code fence, it may run to the end. */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4 || lineText(state, startLine) !== '$$') return false;
  if (silent) return true;
  let next = startLine + 1;
  let closed = false;
  for (; next < endLine; next++) {
    const text = lineText(state, next);
    if (text !== '' && state.sCount[next] < state.blkIndent) break;
    if (text === '$$' && state.sCount[next] - state.blkIndent < 4) {
      closed = true;
      break;
    }
  }
  const token = state.push('math_block', 'div', 0);
  token.content = state.getLines(startLine + 1, next, state.blkIndent, false);
  state.line = next + (closed ? 1 : 0);
  token.map = [startLine, state.line];
  return true;
}

export function highlightPlugin(md: Md): void {
  md.inline.ruler.before('emphasis', 'highlight', highlightTokenize);
  md.inline.ruler2.before('emphasis', 'highlight', highlightPostProcess);
}

export function mathPlugin(md: Md): void {
  md.inline.ruler.before('emphasis', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}
