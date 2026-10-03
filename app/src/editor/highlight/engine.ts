// The highlighter (ARCHITECTURE.md section 14.2; owner: WP6), the lazy chunk of highlighting. It is lowlight with
// only the grammars a page uses, and it turns lowlight's output into flat tokens in OpenNote's code colors. It
// imports nothing the page shares, so the chunk is only lowlight and highlight.js's core. Tests spy on
// `engine.highlight` to prove that no highlighting runs inside a transaction.
import type { Element, Root, RootContent } from 'hast';
import { createLowlight } from 'lowlight';
import { GRAMMARS } from './grammars';

export type TokenKind =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'type'
  | 'variable'
  | 'punctuation'
  | 'deletion'
  | 'emphasis'
  | 'strong';

/** A colored run of a code block's text, in UTF-16 offsets from the block's start. */
export interface Token {
  readonly from: number;
  readonly to: number;
  readonly kind: TokenKind;
}

/** highlight.js scopes and the colors they take. `meta` takes punctuation's, as WP0's notes say. */
const KINDS: Readonly<Record<string, TokenKind>> = {
  keyword: 'keyword',
  literal: 'keyword',
  'selector-tag': 'keyword',
  doctag: 'keyword',
  name: 'keyword',
  'template-tag': 'keyword',
  string: 'string',
  regexp: 'string',
  char: 'string',
  symbol: 'string',
  link: 'string',
  addition: 'string',
  number: 'number',
  bullet: 'number',
  comment: 'comment',
  quote: 'comment',
  title: 'function',
  section: 'function',
  'selector-id': 'function',
  'selector-class': 'function',
  type: 'type',
  class: 'type',
  built_in: 'type',
  variable: 'variable',
  params: 'variable',
  attr: 'variable',
  attribute: 'variable',
  property: 'variable',
  'template-variable': 'variable',
  'selector-attr': 'variable',
  'selector-pseudo': 'variable',
  punctuation: 'punctuation',
  operator: 'punctuation',
  meta: 'punctuation',
  tag: 'punctuation',
  subst: 'punctuation',
  deletion: 'deletion',
  emphasis: 'emphasis',
  strong: 'strong',
};

/** The color of one highlight.js span, from its classes such as ["hljs-title", "class_"]. */
export function kindOf(classNames: readonly string[]): TokenKind | null {
  const scope = classNames[0]?.replace(/^hljs-/, '') ?? '';
  const modifier = classNames[1] ?? '';
  if (scope === 'title' && modifier.startsWith('class')) return 'type';
  if (scope === 'variable' && modifier.startsWith('language')) return 'keyword';
  return KINDS[scope] ?? null;
}

function flatten(tree: Root): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  const walk = (nodes: readonly RootContent[], kind: TokenKind | null) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const end = offset + node.value.length;
        const last = tokens.at(-1);
        if (kind && last && last.kind === kind && last.to === offset) tokens[tokens.length - 1] = { ...last, to: end };
        else if (kind && end > offset) tokens.push({ from: offset, to: end, kind });
        offset = end;
      } else if (node.type === 'element') {
        const classes = ((node as Element).properties.className ?? []) as string[];
        walk(node.children, kindOf(classes) ?? kind);
      }
    }
  };
  walk(tree.children, null);
  return tokens;
}

const lowlight = createLowlight();
const loads = new Map<string, Promise<boolean>>();

export const engine = {
  /** Colors `text` with a grammar that has loaded. */
  highlight(grammar: string, text: string): Token[] {
    return flatten(lowlight.highlight(grammar, text));
  },
};

export function grammarReady(grammar: string): boolean {
  return lowlight.registered(grammar);
}

/** Loads a grammar from languages.ts once. False when it can't load, and the block stays plain. */
export function loadGrammar(grammar: string): Promise<boolean> {
  let load = loads.get(grammar);
  if (!load) {
    const loader = GRAMMARS[grammar];
    load = loader
      ? loader().then(
          (module) => {
            lowlight.register(grammar, module.default);
            // highlight.js compiles a grammar on first use. Doing it here keeps that cost out of the 20 ms guard.
            lowlight.highlight(grammar, 'x');
            return true;
          },
          () => false,
        )
      : Promise.resolve(false);
    loads.set(grammar, load);
  }
  return load;
}
