// Spelling squiggles (ARCHITECTURE.md section 16.3; owner: WP7). One CSS Custom Highlight named spelling-error holds
// DOM ranges over the misspelled words, so squiggles change no DOM and work on static blocks before an editor
// mounts. Text comes from the DOM the same way for static and mounted blocks, so mounting and demotion never check a
// textblock twice. In a mounted editor this plugin notices changed textblocks after the keystroke's task, keeps
// their squiggles in step until the new text is checked, and asks the page's spelling service to check it.
import { Extension } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorHost } from '../host';
import { isCheckable, spellingHighlights } from './spellingText';

export {
  HIGHLIGHT_NAME,
  isCheckable,
  rangeOver,
  SpellingHighlights,
  spellingHighlights,
  TEXTBLOCK_SELECTOR,
  textblockText,
} from './spellingText';
export type { SpellRange, TextblockText } from './spellingText';

/** Where `next` differs from `prev`, in `next`'s positions. */
function changedRange(prev: PMNode, next: PMNode): { from: number; to: number } | null {
  const start = next.content.findDiffStart(prev.content);
  if (start === null) return null;
  const end = next.content.findDiffEnd(prev.content);
  const to = Math.max(end ? end.a : start, start);
  return { from: start, to: Math.min(next.content.size, Math.max(to, start + 1)) };
}

/** Calls `visit` for each checkable textblock between `from` and `to`, with its element. */
function eachTextblock(
  view: EditorView,
  from: number,
  to: number,
  visit: (element: Element, pos: number, node: PMNode) => void,
): void {
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    const element = view.nodeDOM(pos);
    if (element instanceof Element && isCheckable(element)) visit(element, pos, node);
    return false;
  });
}

const spellingKey = new PluginKey('opennote.spelling');

function spellingPlugin(host: EditorHost): Plugin {
  return new Plugin({
    key: spellingKey,
    // WebView2's own checker knows one language and no dictionary, and would squiggle a second time (ADR 0023).
    props: { attributes: { spellcheck: 'false' } },
    view(view) {
      let base: PMNode | null = null;
      let all = true;
      let typed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const enabled = () => host.settings().spelling.enabled && host.flag('editor.spelling');
      const run = () => {
        timer = null;
        const service = host.spelling();
        if (!service || !enabled() || view.isDestroyed) return;
        const { doc, selection } = view.state;
        const range = all ? { from: 0, to: doc.content.size } : base && changedRange(base, doc);
        const head = selection.empty ? selection.head : -1;
        const block = view.dom.getAttribute('data-block') ?? '';
        if (!typed) spellingHighlights.setGuard(null);
        // Mounting in place replaced the static text's elements; their squiggles go before the new ones show.
        if (all) spellingHighlights.prune();
        if (range) {
          eachTextblock(view, range.from, range.to, (element, pos, node) => {
            if (typed && head > pos && head < pos + node.nodeSize) spellingHighlights.setGuard(element, head - pos - 1);
            spellingHighlights.refresh(element, service, true, `${block}:${pos}`);
          });
        }
        base = null;
        all = false;
        typed = false;
      };
      const schedule = () => {
        timer ??= setTimeout(run, 0);
      };
      /** The caret left the guarded word: show it. */
      const caretMoved = () => {
        const guard = spellingHighlights.guarded();
        const service = host.spelling();
        if (!guard || !service || !view.dom.contains(guard.element)) return;
        const { selection } = view.state;
        const at = selection.empty ? view.posAtDOM(guard.element, 0) : -1;
        const offset = selection.head - at;
        const entry = spellingHighlights.entry(guard.element);
        const word = entry?.errors.find(
          (error) => error.start <= guard.offset && guard.offset <= error.start + error.length,
        );
        if (at >= 0 && word && offset >= word.start && offset <= word.start + word.length) return;
        spellingHighlights.setGuard(null);
        spellingHighlights.refresh(guard.element, service, false);
      };
      schedule();
      return {
        update(next, prev) {
          if (next.state.doc !== prev.doc) {
            base ??= prev.doc;
            typed = true;
            schedule();
          } else if (next.state.selection !== prev.selection && spellingHighlights.guarded()) {
            setTimeout(caretMoved, 0);
          }
        },
        destroy() {
          if (timer) clearTimeout(timer);
          spellingHighlights.clear(view.dom);
        },
      };
    },
  });
}

export function spellingRangesExtensions(host: EditorHost): Extensions {
  return [
    Extension.create({
      name: 'spellingRanges',
      addProseMirrorPlugins: () => [spellingPlugin(host)],
    }),
  ];
}
