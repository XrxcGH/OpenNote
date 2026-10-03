// Element tags and links in the text editor (Phase 8). A paragraph, heading, or list item can carry a tag such as
// "To do" and an ID that a link points at. The page editor keeps these as node attributes, but it writes only the
// Markdown. So this plugin loads the attributes from the block data and shows each tag as a badge with an icon and a
// name. After a change it writes the IDs, tags, and checked boxes back with `patchBlock`. A block that has no IDs,
// tags, or links stays as it was, because the plugin writes nothing for it.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { getLocation } from '../../../app/location';
import type { EditorHost } from '../../../editor/host';
import { newId } from '../../../editor/ids';
import { META_HIGHLIGHT } from '../../../editor/meta';
import { t } from '../../../strings/t';
import { shownMounted } from '../../page';
import { copyLinkText } from '../deeplink/copy';
import { formatLink } from '../deeplink/url';
import { KNOWN_TAGS, TODO, isKnownTag, normalizeTag, tagIcon, tagName } from '../lineTags/defs';
import styles from './elements.module.css';
import { ELEMENT_EVENT } from './events';
import type { ElementAction } from './events';
import {
  applyLineData,
  elementsBetween,
  emptyLineData,
  ensureIds,
  findById,
  hasLineData,
  lineDataOf,
  listElements,
  patchFor,
  readLineData,
  textStart,
} from './model';
import type { LineData } from './model';

export interface ElementOptions {
  tags: boolean;
  links: boolean;
}

const key = new PluginKey<DecorationSet>('opennoteElements');
const REFRESH = 'opennote.elementsRefresh';
const SAVE_DELAY_MS = 600;
const FRAME_DELAY_MS = 40;

/** What this window last knew of each block's line data, so an editor that mounts again shows its tags. */
const known = new Map<string, { base: unknown; data: LineData }>();

const layers = new WeakMap<EditorView, ElementLayer>();

function pageOf(): { id: string; send: (patch: Record<string, unknown>, block: string) => Promise<unknown> } | null {
  const mounted = shownMounted.get();
  if (!mounted) return null;
  return {
    id: mounted.page.id,
    send: (data, block) => mounted.page.send({ edits: [{ edit: 'patchBlock', block, data }] }),
  };
}

function badges(state: EditorState, view: () => EditorView): DecorationSet {
  const decorations: Decoration[] = [];
  for (const ref of listElements(state.doc)) {
    const tags = (ref.node.attrs.tags as readonly string[] | undefined) ?? [];
    const id = (ref.node.attrs.id as string | null) ?? null;
    if (tags.length === 0 || id === null) continue;
    const checked = Boolean(ref.node.attrs.tagChecked);
    decorations.push(
      Decoration.widget(textStart(ref), () => badge(view, id, tags, checked), {
        side: -1,
        ignoreSelection: true,
        key: `${id}|${tags.join(',')}|${checked}`,
      }),
    );
  }
  return DecorationSet.create(state.doc, decorations);
}

function badge(view: () => EditorView, id: string, tags: readonly string[], checked: boolean): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = styles.badges;
  wrap.contentEditable = 'false';
  for (const tag of tags) {
    if (tag === TODO) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = styles.todo;
      box.checked = checked;
      box.setAttribute('aria-label', t('qolSearch.lineTags.todoBox'));
      box.addEventListener('change', () => toggleChecked(view(), id));
      wrap.append(box);
      continue;
    }
    const chip = document.createElement('span');
    chip.className = styles.chip;
    chip.append(tagIcon(tag), document.createTextNode(tagName(tag)));
    chip.setAttribute('role', 'img');
    chip.setAttribute('aria-label', t('qolSearch.lineTags.chipLabel', { tag: tagName(tag) }));
    wrap.append(chip);
  }
  return wrap;
}

/** Adds the tag to every touched line, or takes it off when they all have it. */
function toggleTag(view: EditorView, tag: string, layer: ElementLayer): void {
  const { from, to } = view.state.selection;
  const refs = elementsBetween(view.state.doc, from, to);
  if (refs.length === 0) return;
  const all = refs.every((ref) => ((ref.node.attrs.tags as string[]) ?? []).includes(tag));
  const tr = view.state.tr;
  ensureIds(tr, newId);
  for (const ref of refs) {
    const node = tr.doc.nodeAt(ref.pos);
    if (!node) continue;
    const held = (node.attrs.tags as string[]) ?? [];
    const next = all ? held.filter((name) => name !== tag) : held.includes(tag) ? held : [...held, tag];
    const attrs = { ...node.attrs, tags: next, tagChecked: tag === TODO && all ? false : node.attrs.tagChecked };
    tr.setNodeMarkup(ref.pos, undefined, attrs);
  }
  view.dispatch(tr.setMeta(META_HIGHLIGHT, true).setMeta('addToHistory', false));
  layer.track();
  layer.saveNow();
}

function toggleChecked(view: EditorView, id: string): void {
  const ref = findById(view.state.doc, id);
  if (!ref) return;
  const attrs = { ...ref.node.attrs, tagChecked: !ref.node.attrs.tagChecked };
  const tr = view.state.tr.setNodeMarkup(ref.pos, undefined, attrs);
  view.dispatch(tr.setMeta(META_HIGHLIGHT, true).setMeta('addToHistory', false));
  layers.get(view)?.saveNow();
}

async function copyLink(view: EditorView, layer: ElementLayer): Promise<void> {
  const here = getLocation();
  const page = here.view === 'workspace' ? here.pageId : null;
  if (!page) return;
  const ref = elementsBetween(view.state.doc, view.state.selection.from, view.state.selection.to)[0];
  if (!ref) return;
  const tr = view.state.tr;
  ensureIds(tr, newId);
  const id = (tr.doc.nodeAt(ref.pos)?.attrs.id as string | null) ?? null;
  if (tr.docChanged) view.dispatch(tr.setMeta(META_HIGHLIGHT, true).setMeta('addToHistory', false));
  if (!id) return;
  layer.track();
  layer.saveNow();
  await copyLinkText(formatLink(page, id));
}

async function chooseTag(view: EditorView, host: EditorHost, layer: ElementLayer): Promise<void> {
  const at = view.coordsAtPos(view.state.selection.head);
  const items = [
    ...KNOWN_TAGS.map((tag, index) => ({ id: tag, label: tagName(tag), shortcut: `Ctrl+${index + 1}` })),
    { id: 'custom', label: t('qolSearch.lineTags.custom'), separatorBefore: true },
  ];
  const label = t('qolSearch.lineTags.menu');
  const chosen = await host.openMenu({ label, items, anchor: { x: at.left, y: at.bottom } });
  if (!chosen) return;
  if (chosen === 'custom') {
    const { askCustomTag } = await import('../lineTags/askCustomTag');
    const name = normalizeTag((await askCustomTag()) ?? '');
    if (name && !view.isDestroyed) toggleTag(view, name, layer);
    return;
  }
  if (isKnownTag(chosen)) toggleTag(view, chosen, layer);
}

/** Loads a block's line data into the editor and writes changes back. One for each text editor. */
class ElementLayer {
  private sent: LineData = emptyLineData();
  private tracked = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private suspended = false;
  private dead = false;
  private stopFrames: () => void = () => undefined;
  private lastDoc: unknown;

  constructor(
    private readonly view: EditorView,
    private readonly host: EditorHost,
  ) {
    this.lastDoc = view.state.doc;
    queueMicrotask(() => this.load());
  }

  private get block(): string | null {
    return this.view.dom.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null;
  }

  private get cacheKey(): string | null {
    const page = pageOf()?.id;
    return page && this.block ? `${page}/${this.block}` : null;
  }

  private load(): void {
    const block = this.block;
    const mounted = shownMounted.get();
    if (this.dead || !block || !mounted) return;
    const base = mounted.layer.block(block)?.data;
    const cached = this.cacheKey ? known.get(this.cacheKey) : undefined;
    this.sent = cached && cached.base === base ? cached.data : lineDataOf(base);
    this.tracked = hasLineData(this.sent);
    if (this.tracked) this.apply(this.sent);
    this.stopFrames = mounted.page.onFrame((frame) => {
      const changed = frame.blocks.find((candidate) => candidate.id === block);
      if (changed) setTimeout(() => this.reload(changed.data), FRAME_DELAY_MS);
    });
  }

  private reload(data: Record<string, unknown>): void {
    if (this.dead) return;
    this.sent = lineDataOf(data);
    this.tracked = this.tracked || hasLineData(this.sent);
    if (this.tracked) this.apply(this.sent);
  }

  private apply(data: LineData): void {
    if (this.view.isDestroyed) return;
    const tr = this.view.state.tr;
    if (!applyLineData(tr, data)) return;
    this.suspended = true;
    try {
      this.view.dispatch(tr.setMeta(META_HIGHLIGHT, true).setMeta('addToHistory', false).setMeta(REFRESH, true));
    } finally {
      this.suspended = false;
    }
  }

  /** From now on this block's IDs, tags, and checked boxes are written with its edits. */
  track(): void {
    this.tracked = true;
  }

  update(): void {
    if (this.view.state.doc === this.lastDoc) return;
    this.lastDoc = this.view.state.doc;
    if (!this.tracked || this.suspended) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
  }

  saveNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const block = this.block;
    const page = pageOf();
    if (this.dead || this.view.isDestroyed || !block || !page || !this.tracked) return;
    const tr = this.view.state.tr;
    if (ensureIds(tr, newId)) {
      this.view.dispatch(tr.setMeta(META_HIGHLIGHT, true).setMeta('addToHistory', false));
    }
    const next = readLineData(this.view.state.doc);
    const patch = patchFor(this.sent, next);
    if (!patch) return;
    this.sent = next;
    const base = shownMounted.get()?.layer.block(block)?.data;
    if (this.cacheKey) known.set(this.cacheKey, { base, data: next });
    void page.send(patch, block).catch(() => {
      // The page keeps the last data it took, so the next change sends the whole difference again.
      this.sent = emptyLineData();
    });
  }

  destroy(): void {
    this.saveNow();
    this.dead = true;
    this.stopFrames();
  }

  async run(action: ElementAction): Promise<void> {
    if (action.type === 'tag') toggleTag(this.view, action.tag, this);
    else if (action.type === 'copyLink') await copyLink(this.view, this);
    else await chooseTag(this.view, this.host, this);
  }
}

function elementsPlugin(host: EditorHost, options: ElementOptions): Plugin<DecorationSet> {
  let current: EditorView | null = null;
  const view = () => current as EditorView;
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => (options.tags ? badges(state, view) : DecorationSet.empty),
      apply: (tr, old, _before, state) =>
        options.tags && (tr.docChanged || tr.getMeta(REFRESH)) ? badges(state, view) : old,
    },
    props: {
      decorations: (state) => key.getState(state),
      handleDOMEvents: {
        [ELEMENT_EVENT](editorView: EditorView, event: Event) {
          const action = (event as CustomEvent<ElementAction>).detail;
          const allowed = action.type === 'copyLink' ? options.links : options.tags;
          if (allowed) void layers.get(editorView)?.run(action);
          return true;
        },
      },
    },
    view(editorView) {
      current = editorView;
      const layer = new ElementLayer(editorView, host);
      layers.set(editorView, layer);
      return {
        update: () => layer.update(),
        destroy() {
          layer.destroy();
          layers.delete(editorView);
        },
      };
    },
  });
}

/** The editor extension: element tags as badges, element IDs for links, and writing both back. */
export function elementExtensions(host: EditorHost, options: ElementOptions): Extension {
  const wanted = options.tags || options.links;
  return Extension.create({
    name: 'opennoteElements',
    addProseMirrorPlugins: () => (wanted ? [elementsPlugin(host, options)] : []),
  });
}
