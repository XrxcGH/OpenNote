// Code highlighting that never runs in a keystroke's task (ARCHITECTURE.md section 14.2; owner: WP6). The plugin
// is small and comes with code blocks; the highlighter (engine.ts) is the lazy chunk, loaded the first time a block
// with a language needs colors. The plugin keeps a DecorationSet. A transaction only maps the decorations through the change, so
// colors move with the text and never flicker, and marks the code blocks it touched as dirty. An idle callback
// then highlights one dirty block and swaps its decorations in a transaction that only carries META_HIGHLIGHT.
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { AttrStep } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorHost } from '../host';
import { META_HIGHLIGHT } from '../meta';
import type { Token, TokenKind } from './engine';
import styles from './code.module.css';
import { findLanguage } from './languages';

type Engine = typeof import('./engine');

let loaded: Engine | null = null;
let loading: Promise<Engine> | null = null;

/** Loads the highlighter chunk once. */
export function loadEngine(): Promise<Engine> {
  loading ??= import('./engine').then((module) => (loaded = module));
  return loading;
}

/** The decoration class of a token kind. */
export function tokenClass(kind: TokenKind): string {
  return styles[kind];
}

/** Blocks longer than this highlight in slices of idle time. */
export const SLICE_LINES = 2000;
/** Blocks longer than this stay plain. */
export const MAX_LINES = 10_000;
/** A highlight slower than this turns highlighting off for the block, for the session. */
export const SLOW_MS = 20;
const IDLE_TIMEOUT_MS = 500;
const CHUNK_LINES = 500;

interface Deadline {
  timeRemaining(): number;
}

/** requestIdleCallback with a 500 ms timeout, or a short timer where there is none. */
function whenIdle(callback: (deadline: Deadline) => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(() => {
    const end = performance.now() + 10;
    callback({ timeRemaining: () => Math.max(0, end - performance.now()) });
  }, 1);
  return () => clearTimeout(id);
}

/** Highlights `text` in chunks of lines, so a long block's work splits across idle callbacks. */
function chunksOf(text: string): { from: number; text: string }[] {
  const lines = text.split('\n');
  if (lines.length <= SLICE_LINES) return [{ from: 0, text }];
  const chunks: { from: number; text: string }[] = [];
  let from = 0;
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const piece = lines.slice(i, i + CHUNK_LINES).join('\n');
    chunks.push({ from, text: piece });
    from += piece.length + 1;
  }
  return chunks;
}

/** One timed highlight, or null when it took too long to trust. */
function timedHighlight(engine: Engine, grammar: string, text: string): Token[] | null {
  const started = performance.now();
  const tokens = engine.engine.highlight(grammar, text);
  return performance.now() - started > SLOW_MS ? null : tokens;
}

interface HighlightState {
  readonly set: DecorationSet;
  /** Positions before code blocks whose colors are stale, oldest first. */
  readonly dirty: readonly number[];
  /** Positions before code blocks that were too slow to highlight. */
  readonly off: readonly number[];
}

interface HighlightMeta {
  readonly pos: number;
  readonly from: number;
  readonly to: number;
  readonly decorations: readonly Decoration[];
  readonly done: boolean;
  readonly off?: boolean;
}

const key = new PluginKey<HighlightState>('opennote.codeHighlight');

/** The code blocks in or around [from, to], as positions before them. */
function codeBlocksIn(doc: PMNode, from: number, to: number, into: Set<number>): void {
  doc.nodesBetween(Math.max(0, from), Math.min(to, doc.content.size), (node, pos) => {
    if (node.type.name === 'codeBlock') into.add(pos);
    return !node.isTextblock;
  });
}

/** The code blocks a transaction changed, in the new document. Only the changed ranges are visited. */
function touched(tr: Transaction): Set<number> {
  const found = new Set<number>();
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1);
    if (step instanceof AttrStep && step.attr === 'language') {
      const pos = rest.mapResult(step.pos);
      if (!pos.deleted) found.add(pos.pos);
      return;
    }
    step.getMap().forEach((_oldStart, _oldEnd, start, end) => {
      codeBlocksIn(tr.doc, rest.map(start, -1), rest.map(end, 1), found);
    });
  });
  return found;
}

function mapPositions(positions: readonly number[], tr: Transaction): number[] {
  const mapped: number[] = [];
  for (const pos of positions) {
    const result = tr.mapping.mapResult(pos, 1);
    if (!result.deleted && !mapped.includes(result.pos)) mapped.push(result.pos);
  }
  return mapped;
}

/** The code blocks that have a language, for the first pass. */
function codeWithLanguage(doc: PMNode): number[] {
  const found = new Set<number>();
  codeBlocksIn(doc, 0, doc.content.size, found);
  return [...found].filter((pos) => Boolean(doc.nodeAt(pos)?.attrs.language));
}

function apply(tr: Transaction, value: HighlightState): HighlightState {
  const meta = tr.getMeta(key) as HighlightMeta | undefined;
  if (!tr.docChanged && !meta) return value;
  let { set, dirty, off } = value;
  if (tr.docChanged) {
    set = set.map(tr.mapping, tr.doc);
    dirty = mapPositions(dirty, tr);
    off = mapPositions(off, tr);
    for (const pos of touched(tr)) if (!dirty.includes(pos)) dirty = [...dirty, pos];
  }
  if (meta) {
    if (meta.to > meta.from) set = set.remove(set.find(meta.from, meta.to));
    set = set.add(tr.doc, [...meta.decorations]);
    if (meta.done) dirty = dirty.filter((pos) => pos !== meta.pos);
    if (meta.off) off = [...off, meta.pos];
  }
  return { set, dirty, off };
}

/** The decorations of one chunk of a block, in document positions. */
function decorate(start: number, tokens: readonly Token[]): Decoration[] {
  return tokens.map((token) =>
    Decoration.inline(start + token.from, start + token.to, { class: tokenClass(token.kind) }),
  );
}

/** Works through dirty blocks in idle time, one block (or a few chunks of a long one) per callback. */
class IdleHighlighter {
  private cancel: (() => void) | null = null;
  private destroyed = false;
  /** A long block part way through: its node, so an edit restarts it, and the next chunk. */
  private progress: { pos: number; node: PMNode; next: number } | null = null;

  constructor(private readonly view: EditorView) {
    this.schedule();
  }

  schedule(): void {
    if (this.cancel || this.destroyed || !key.getState(this.view.state)?.dirty.length) return;
    this.cancel = whenIdle((deadline) => {
      this.cancel = null;
      this.work(deadline);
    });
  }

  private send(meta: HighlightMeta): void {
    const tr = this.view.state.tr.setMeta(key, meta).setMeta(META_HIGHLIGHT, true).setMeta('addToHistory', false);
    this.view.dispatch(tr);
  }

  private clear(pos: number, node: PMNode | null, off = false): void {
    const to = pos + (node?.nodeSize ?? 1);
    this.send({ pos, from: pos, to, decorations: [], done: true, off });
  }

  private work(deadline: Deadline): void {
    if (this.destroyed) return;
    const state = key.getState(this.view.state);
    const pos = state?.dirty[0];
    if (state === undefined || pos === undefined) return;
    const node = this.view.state.doc.nodeAt(pos);
    const language = findLanguage(node?.attrs.language as string | null);
    if (!node || node.type.name !== 'codeBlock') this.send({ pos, from: pos, to: pos, decorations: [], done: true });
    else if (!language || state.off.includes(pos) || node.textContent.split('\n').length > MAX_LINES) {
      this.clear(pos, node);
    } else if (!loaded || !loaded.grammarReady(language.grammar)) {
      void loadEngine()
        .then((engine) => engine.loadGrammar(language.grammar))
        .then((ok) => {
          if (!ok && !this.destroyed) this.clear(pos, this.view.state.doc.nodeAt(pos));
          this.schedule();
        });
      return;
    } else this.highlightBlock(loaded, pos, node, language.grammar, deadline);
    this.schedule();
  }

  private highlightBlock(engine: Engine, pos: number, node: PMNode, grammar: string, deadline: Deadline): void {
    const chunks = chunksOf(node.textContent);
    if (this.progress?.pos !== pos || this.progress.node !== node) this.progress = { pos, node, next: 0 };
    const progress = this.progress;
    do {
      const chunk = chunks[progress.next];
      const tokens = timedHighlight(engine, grammar, chunk.text);
      if (!tokens) {
        this.progress = null;
        return this.clear(pos, node, true);
      }
      const start = pos + 1 + chunk.from;
      const last = progress.next === chunks.length - 1;
      const to = last ? pos + node.nodeSize : start + chunk.text.length;
      this.send({ pos, from: progress.next === 0 ? pos : start, to, decorations: decorate(start, tokens), done: last });
      progress.next++;
    } while (progress.next < chunks.length && deadline.timeRemaining() > SLOW_MS);
    if (progress.next >= chunks.length) this.progress = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.cancel?.();
  }
}

/** The editor plugin. Every transaction is O(change); all highlighting happens in idle callbacks. */
export function highlightPlugin(_host: EditorHost): Plugin<HighlightState> {
  return new Plugin<HighlightState>({
    key,
    state: {
      init: (_config, state: EditorState) => ({
        set: DecorationSet.empty,
        dirty: codeWithLanguage(state.doc),
        off: [],
      }),
      apply: (tr, value) => apply(tr, value),
    },
    props: {
      decorations: (state) => key.getState(state)?.set ?? DecorationSet.empty,
    },
    view(view) {
      const idle = new IdleHighlighter(view);
      return { update: () => idle.schedule(), destroy: () => idle.destroy() };
    },
  });
}

/** Wraps the text of a static <code> in token spans. The text stays the same, so nothing moves. */
function paint(code: HTMLElement, text: string, tokens: readonly Token[]): void {
  const doc = code.ownerDocument;
  const parts: Node[] = [];
  let at = 0;
  for (const token of tokens) {
    if (token.from > at) parts.push(doc.createTextNode(text.slice(at, token.from)));
    const span = doc.createElement('span');
    span.className = tokenClass(token.kind);
    span.textContent = text.slice(token.from, token.to);
    parts.push(span);
    at = token.to;
  }
  if (at < text.length) parts.push(doc.createTextNode(text.slice(at)));
  code.replaceChildren(...parts);
}

/**
 * Colors the static code blocks of a block rendered with renderStatic, in idle time, one block per callback, so a
 * block looks the same before and after its editor mounts.
 */
export async function highlightStatic(root: HTMLElement, doc: PMNode): Promise<void> {
  const blocks: PMNode[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'codeBlock') blocks.push(node);
    return !node.isTextblock;
  });
  const elements = [...root.querySelectorAll<HTMLElement>('pre > code')];
  for (const [i, node] of blocks.entries()) {
    const code = elements[i];
    const language = findLanguage(node.attrs.language as string | null);
    const text = node.textContent;
    if (!code || !language || code.textContent !== text || text.split('\n').length > SLICE_LINES) continue;
    const engine = await loadEngine();
    if (!(await engine.loadGrammar(language.grammar))) continue;
    await new Promise<void>((resolve) => whenIdle(() => resolve()));
    if (!code.isConnected || code.textContent !== text) continue;
    const tokens = timedHighlight(engine, language.grammar, text);
    if (tokens) paint(code, text, tokens);
  }
}
