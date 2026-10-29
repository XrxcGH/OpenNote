// [[Page links]] in the text editor (Phase 8). The Markdown keeps the plain text `[[Title]]` or `[[Title#Heading]]`,
// which crates/search reads, so nothing about the page's format changes. The editor draws each link with its state:
// linked, shared by several pages, found under an earlier title, or pointing at nothing. Ctrl+click follows a link, a
// resting pointer or "Preview the linked page" shows the first lines of its page, and typing "[[" lists pages.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { getLocation } from '../../../app/location';
import { parseLinks } from '../../../services/search/text';
import type { LinkRef } from '../../../services/search/types';
import { t } from '../../../strings/t';
import { hideCard, scheduleHide, scheduleShow, showCard } from './card';
import { PAGE_LINK_EVENT } from './events';
import type { PageLinkAction } from './events';
import { followLink } from './follow';
import { cachedResolution, onResolutions, requestResolutions, setLinkSource } from './resolver';
import { createSuggest, sessionAt } from './suggest';

export const pageLinkKey = new PluginKey<LinkState>('opennotePageLinks');
const REFRESH = 'opennote.pageLinksRefresh';
const LEAF = '￼';

interface LinkState {
  set: DecorationSet;
  links: LinkRef[];
}

function currentPage(): string | undefined {
  const here = getLocation();
  return here.view === 'workspace' ? (here.pageId ?? undefined) : undefined;
}

function scan(doc: PMNode): LinkState {
  const decorations: Decoration[] = [];
  const links: LinkRef[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;
    const text = node.textBetween(0, node.content.size, undefined, LEAF);
    for (const link of parseLinks(text)) {
      const from = pos + 1 + link.start;
      const to = pos + 1 + link.end;
      if (doc.rangeHasMark(from, to, doc.type.schema.marks.code)) continue;
      const ref: LinkRef = link.heading ? { title: link.title, heading: link.heading } : { title: link.title };
      links.push(ref);
      const status = cachedResolution(ref)?.status ?? 'pending';
      decorations.push(
        Decoration.inline(
          from,
          to,
          {
            class: 'on-page-link',
            'data-status': status,
            'data-title': link.title,
            'data-heading': link.heading ?? '',
            title: status === 'pending' ? '' : t(`search.links.status.${status}`),
          },
          { link: ref },
        ),
      );
    }
    return false;
  });
  return { set: DecorationSet.create(doc, decorations), links };
}

function linkAt(state: EditorState, pos: number): LinkRef | null {
  const found = pageLinkKey.getState(state)?.set.find(pos, pos) ?? [];
  const spec = found.find((decoration) => decoration.spec?.link)?.spec as { link: LinkRef } | undefined;
  return spec?.link ?? null;
}

function linkElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('.on-page-link') : null;
}

function refOf(element: HTMLElement): LinkRef {
  const heading = element.dataset.heading;
  return heading ? { title: element.dataset.title ?? '', heading } : { title: element.dataset.title ?? '' };
}

function run(view: EditorView, action: PageLinkAction): void {
  const { head } = view.state.selection;
  if (action === 'start') {
    if (!sessionAt(view.state)) view.dispatch(view.state.tr.insertText('[[').scrollIntoView());
    return;
  }
  const link = linkAt(view.state, head);
  if (!link) return;
  if (action === 'follow') {
    void followLink(link);
    return;
  }
  const at = view.coordsAtPos(head);
  void showCard(new DOMRect(at.left, at.top, 0, at.bottom - at.top), link);
}

const suggestions = new WeakMap<EditorView, ReturnType<typeof createSuggest>>();

function linkPlugin(): Plugin<LinkState> {
  return new Plugin<LinkState>({
    key: pageLinkKey,
    state: {
      init: (_config, { doc }) => scan(doc),
      apply: (tr, old) => (tr.docChanged || tr.getMeta(REFRESH) ? scan(tr.doc) : old),
    },
    props: {
      decorations: (state) => pageLinkKey.getState(state)?.set,
      handleClick(view, pos, event) {
        if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
        const link = linkAt(view.state, pos);
        if (!link) return false;
        event.preventDefault();
        void followLink(link);
        return true;
      },
      handleKeyDown(view, event) {
        const handled = suggestions.get(view)?.key(event) ?? false;
        if (handled) event.stopPropagation();
        return handled;
      },
      handleDOMEvents: {
        mouseover(_view, event) {
          const element = linkElement(event.target);
          if (element) scheduleShow(element, refOf(element));
          return false;
        },
        mouseout(_view, event) {
          if (linkElement(event.target)) scheduleHide();
          return false;
        },
        blur() {
          hideCard();
          return false;
        },
        [PAGE_LINK_EVENT](view: EditorView, event: Event) {
          run(view, (event as CustomEvent<PageLinkAction>).detail);
          return true;
        },
      },
    },
    view(view) {
      const suggest = createSuggest(view);
      suggestions.set(view, suggest);
      setLinkSource(currentPage());
      const wanted = () => requestResolutions(pageLinkKey.getState(view.state)?.links ?? []);
      wanted();
      const stop = onResolutions(() => {
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(REFRESH, true).setMeta('addToHistory', false));
      });
      return {
        update() {
          wanted();
          suggest.update();
        },
        destroy() {
          stop();
          suggest.destroy();
          suggestions.delete(view);
          hideCard();
        },
      };
    },
  });
}

/** The editor extension: the link decorations, following, previews, and completion. */
export function pageLinkExtensions(): Extension {
  return Extension.create({
    name: 'opennotePageLinks',
    addProseMirrorPlugins: () => [linkPlugin()],
  });
}
