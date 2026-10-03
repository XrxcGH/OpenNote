// The page gallery: a section's pages as a grid of thumbnails. Arrow keys move, Enter opens a page, Space picks it, and
// Alt with Up or Down moves the picked pages earlier or later. Dragging a thumbnail does the same with the mouse or
// touch. A move is one change to the notes service, so it is one undo step there.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, RefObject } from 'react';
import type { Location } from '../../../app/location';
import type { Platform } from '../../../platform/types';
import type { NodeId, NodeSummary, NotesService } from '../../../services/notes';
import { formatDate } from '../../../strings/format';
import { t } from '../../../strings/t';
import { announce, Button, Dialog } from '../../../ui';
import { titleOf } from '../../tree';
import { exportHtml, lightTheme, readExportPage } from '../export';
import { bundledFontFaces } from '../host/fonts';
import {
  cellRect,
  clickSelection,
  dropPages,
  dropSlot,
  gridLayout,
  moveGridFocus,
  rangeBetween,
  stepPages,
  visibleRange,
} from '../gallery';
import type { GridKey, GridLayout, Reorder } from '../gallery';
import styles from './gallery.module.css';

export interface GalleryProps {
  readonly notes: NotesService;
  readonly platform: Platform;
  readonly notebookId: NodeId | null;
  readonly sectionId: NodeId | null;
  navigate(to: Location): void;
  close(): void;
}

/** A thumbnail's page, in the frame's own width, drawn at this many CSS pixels wide. */
const PAPER_WIDTH = 640;
const ASPECT = 11 / 8.5;
const KEYS: Record<string, GridKey> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
};

// The thumbnails drawn so far, by page and the time it was last changed, and a short queue so opening many pages does
// not start many at once.
const drawn = new Map<string, string>();
let running = 0;
const waiting: (() => void)[] = [];

async function turn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((resume) => waiting.push(resume));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/** The page as a small document: its text and tables in the page's own styles. Pictures are left out. */
async function thumbnailHtml(platform: Platform, node: NodeSummary): Promise<string> {
  const key = `${node.id}:${node.modified}`;
  const known = drawn.get(key);
  if (known) return known;
  const html = await turn(async () => {
    const open = await platform.pages.open(node.id, { viewport: null });
    try {
      const page = readExportPage(open.initial, [], 'en');
      const theme = lightTheme(bundledFontFaces());
      return exportHtml(page, { assetUrl: () => null, header: false, maxWidth: PAPER_WIDTH - 96, theme }).html;
    } finally {
      await open.close().catch(() => undefined);
    }
  });
  drawn.set(key, html);
  return html;
}

function Thumbnail({ platform, node }: { platform: Platform; node: NodeSummary }) {
  const [html, setHtml] = useState<string | null>(drawn.get(`${node.id}:${node.modified}`) ?? null);
  useEffect(() => {
    let current = true;
    if (!html) {
      thumbnailHtml(platform, node)
        .then((found) => current && setHtml(found))
        .catch(() => undefined);
    }
    return () => {
      current = false;
    };
  }, [platform, node, html]);
  return (
    <div className={styles.thumb} aria-hidden="true">
      {html ? (
        <iframe
          className={styles.thumbFrame}
          title={t('pageViews.gallery.thumbnail', { title: titleOf(node) })}
          sandbox="allow-same-origin"
          srcDoc={html}
          tabIndex={-1}
          loading="lazy"
        />
      ) : null}
    </div>
  );
}

/** The pages of a section, in order, and the section's name. `reload` reads them again. */
function usePages(notes: NotesService, sectionId: NodeId | null) {
  const [pages, setPages] = useState<readonly NodeSummary[]>([]);
  const [section, setSection] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!sectionId) return;
    let current = true;
    void Promise.all([notes.listChildren(sectionId), notes.get(sectionId)]).then(([children, node]) => {
      if (!current) return;
      setPages(children.filter((child) => child.kind === 'page'));
      setSection(node ? titleOf(node) : '');
    });
    return () => {
      current = false;
    };
  }, [notes, sectionId, version]);
  return { pages, setPages, section, reload: useCallback(() => setVersion((n) => n + 1), []) };
}

/** The width and scroll position of the grid's scroller. */
function useScroller(scroller: RefObject<HTMLDivElement | null>, count: number) {
  const [width, setWidth] = useState(720);
  const [scroll, setScroll] = useState({ top: 0, height: 480 });
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      setWidth(element.clientWidth);
      setScroll({ top: element.scrollTop, height: element.clientHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroller, count]);
  return { width, scroll, setScroll };
}

interface Picks {
  readonly selected: ReadonlySet<string>;
  readonly anchor: string | null;
  readonly focus: number;
  choose(order: readonly string[], index: number, how: 'replace' | 'toggle' | 'extend'): void;
  extend(order: readonly string[], next: number): void;
  setSelected(next: ReadonlySet<string>): void;
  setFocus(index: number): void;
}

/** Which pages are picked, which one has the keyboard, and where a range starts. */
function usePicks(): Picks {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  return {
    selected,
    anchor,
    focus,
    choose(order, index, how) {
      const id = order[index];
      if (id === undefined) return;
      const next = clickSelection(order, selected, anchor, id, how);
      setSelected(next.selected);
      setAnchor(next.anchor);
      setFocus(index);
    },
    extend(order, next) {
      setFocus(next);
      if (anchor) setSelected(new Set(rangeBetween(order.indexOf(anchor), next).map((i) => order[i])));
    },
    setSelected,
    setFocus,
  };
}

interface CellProps {
  readonly node: NodeSummary;
  readonly index: number;
  readonly total: number;
  readonly layout: GridLayout;
  readonly platform: Platform;
  readonly picked: boolean;
  readonly focused: boolean;
  onChoose(how: 'replace' | 'toggle' | 'extend'): void;
  onOpen(): void;
  onDragStart(event: DragEvent): void;
  onDragEnd(): void;
}

function GalleryCell(props: CellProps) {
  const { node, index, total, layout, platform, picked, focused } = props;
  const cell = cellRect(layout, index);
  const label = t('pageViews.gallery.cell', { title: titleOf(node), position: index + 1, total });
  const scale = cell.w / PAPER_WIDTH;
  return (
    <div
      id={`gallery-${node.id}`}
      role="option"
      aria-selected={picked}
      aria-label={label}
      tabIndex={focused ? 0 : -1}
      className={styles.cell}
      data-selected={picked || undefined}
      style={{ insetInlineStart: cell.x, insetBlockStart: cell.y, inlineSize: cell.w, blockSize: cell.h }}
      draggable
      onClick={(event) => {
        const how = event.shiftKey ? 'extend' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
        props.onChoose(how);
      }}
      onDoubleClick={props.onOpen}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
    >
      <div className={styles.thumbBox} style={{ blockSize: layout.thumbHeight }}>
        <div
          className={styles.thumbScale}
          style={{ transform: `scale(${scale})`, inlineSize: PAPER_WIDTH, blockSize: PAPER_WIDTH * ASPECT }}
        >
          <Thumbnail platform={platform} node={node} />
        </div>
      </div>
      <span className={styles.title}>{titleOf(node)}</span>
      <span className={styles.date}>{t('pageViews.gallery.modified', { date: formatDate(node.modified) })}</span>
    </div>
  );
}

interface ToolbarProps {
  readonly count: number;
  readonly onMove: (direction: 'up' | 'down') => void;
}

function GalleryToolbar({ count, onMove }: ToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <span className={styles.count} aria-live="polite">
        {t('pageViews.gallery.selected', { count })}
      </span>
      <Button variant="quiet" disabled={count === 0} onClick={() => onMove('up')}>
        {t('pageViews.gallery.moveUp')}
      </Button>
      <Button variant="quiet" disabled={count === 0} onClick={() => onMove('down')}>
        {t('pageViews.gallery.moveDown')}
      </Button>
    </div>
  );
}

/** Moving pages: the new order shows at once, the notes service gets one move, and the list is read again. */
function useReorder(notes: NotesService, sectionId: NodeId | null, pages: readonly NodeSummary[], more: ListActions) {
  return async (move: Reorder | null, moving: ReadonlySet<string>) => {
    if (!move || !sectionId) return;
    const byId = new Map(pages.map((page) => [page.id as string, page] as const));
    more.setPages(move.order.flatMap((id) => byId.get(id) ?? []));
    try {
      await notes.move([...moving] as NodeId[], { parentId: sectionId, beforeId: move.beforeId as NodeId | null });
      announce(t('pageViews.gallery.moved', { count: moving.size }));
    } finally {
      more.reload();
    }
  };
}

interface ListActions {
  setPages(next: readonly NodeSummary[]): void;
  reload(): void;
}

/** Dragging thumbnails to a new place: where the drop would land, and the handlers that move the pages. */
function useDrag(
  layout: GridLayout,
  order: readonly string[],
  picks: Picks,
  apply: ReturnType<typeof useReorder>,
  grid: RefObject<HTMLDivElement | null>,
) {
  const [slot, setSlot] = useState<number | null>(null);
  const dragging = useRef<ReadonlySet<string> | null>(null);
  const point = (event: DragEvent) => {
    const box = grid.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };
  return {
    slot,
    onDragOver(event: DragEvent) {
      if (!dragging.current) return;
      event.preventDefault();
      setSlot(dropSlot(layout, point(event).x, point(event).y));
    },
    onDragLeave: () => setSlot(null),
    onDrop(event: DragEvent) {
      event.preventDefault();
      const moving = dragging.current;
      dragging.current = null;
      const at = dropSlot(layout, point(event).x, point(event).y);
      setSlot(null);
      if (moving) void apply(dropPages(order, moving, at), moving);
    },
    startDrag: (node: NodeSummary) => (event: DragEvent) => {
      dragging.current = picks.selected.has(node.id) ? picks.selected : new Set([node.id]);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', titleOf(node));
    },
    endDrag() {
      dragging.current = null;
      setSlot(null);
    },
  };
}

export function Gallery({ notes, platform, notebookId, sectionId, navigate, close }: GalleryProps) {
  const { pages, setPages, section, reload } = usePages(notes, sectionId);
  const picks = usePicks();
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const { width, scroll, setScroll } = useScroller(scroller, pages.length);
  const layout = useMemo(
    () => gridLayout({ width: Math.max(160, width - 4), count: pages.length, aspect: ASPECT }),
    [width, pages.length],
  );
  const range = visibleRange(layout, scroll.top, scroll.height, 1);
  const order = useMemo(() => pages.map((page) => page.id as string), [pages]);
  const apply = useReorder(notes, sectionId, pages, { setPages, reload });
  const drag = useDrag(layout, order, picks, apply, grid);

  const step = (direction: 'up' | 'down') => {
    const moving = picks.selected.size > 0 ? picks.selected : new Set([order[picks.focus]]);
    void apply(stepPages(order, moving, direction), moving);
  };
  const open = (node: NodeSummary) => {
    close();
    navigate({ view: 'workspace', notebookId, sectionId, pageId: node.id });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return close();
    }
    if (pages.length === 0) return;
    const handled = galleryKey(event, { layout, order, picks, open: () => open(pages[picks.focus]), step });
    if (handled) event.preventDefault();
  };
  useEffect(() => {
    if (pages.length > 0) document.getElementById(`gallery-${order[Math.min(picks.focus, order.length - 1)]}`)?.focus();
  }, [picks.focus, pages.length, order]);

  const bar = dropBar(layout, drag.slot);
  return (
    <Dialog
      title={t('pageViews.gallery.title')}
      size="large"
      placement="center"
      onDismiss={close}
      actions={[{ id: 'close', label: t('pageViews.gallery.close'), variant: 'secondary', onPress: close }]}
    >
      {!sectionId || pages.length === 0 ? (
        <p className={styles.empty}>{t(sectionId ? 'pageViews.gallery.empty' : 'pageViews.gallery.noSection')}</p>
      ) : (
        <>
          <GalleryToolbar count={picks.selected.size} onMove={step} />
          <div
            ref={scroller}
            className={styles.scroller}
            onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
          >
            <div
              ref={grid}
              className={styles.grid}
              role="listbox"
              aria-multiselectable="true"
              aria-label={t('pageViews.gallery.label', { section })}
              style={{ blockSize: layout.height }}
              onKeyDown={onKeyDown}
              onDragOver={drag.onDragOver}
              onDragLeave={drag.onDragLeave}
              onDrop={drag.onDrop}
            >
              {pages.slice(range.first, range.end).map((node, offset) => (
                <GalleryCell
                  key={node.id}
                  node={node}
                  index={range.first + offset}
                  total={pages.length}
                  layout={layout}
                  platform={platform}
                  picked={picks.selected.has(node.id)}
                  focused={range.first + offset === picks.focus}
                  onChoose={(how) => picks.choose(order, range.first + offset, how)}
                  onOpen={() => open(node)}
                  onDragStart={drag.startDrag(node)}
                  onDragEnd={drag.endDrag}
                />
              ))}
              {bar ? <div className={styles.dropBar} style={bar} /> : null}
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Where the bar that shows the drop slot sits, or null while nothing is dragged. */
function dropBar(layout: GridLayout, slot: number | null) {
  if (slot === null || layout.count === 0) return null;
  const cell = cellRect(layout, Math.min(slot, layout.count - 1));
  const x = slot < layout.count ? cell.x - layout.gap / 2 : cell.x + cell.w + layout.gap / 2;
  return { insetInlineStart: x - 1, insetBlockStart: cell.y, blockSize: cell.h };
}

interface KeyContext {
  readonly layout: GridLayout;
  readonly order: readonly string[];
  readonly picks: Picks;
  open(): void;
  step(direction: 'up' | 'down'): void;
}

/** Handles a key in the grid. Returns true when the key was one of the gallery's. */
function galleryKey(event: KeyboardEvent, cx: KeyContext): boolean {
  const { layout, order, picks } = cx;
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    cx.step(event.key === 'ArrowUp' ? 'up' : 'down');
    return true;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    picks.setSelected(new Set(order));
    return true;
  }
  if (event.key === 'Enter') {
    cx.open();
    return true;
  }
  if (event.key === ' ') {
    picks.choose(order, picks.focus, 'toggle');
    return true;
  }
  const key = KEYS[event.key];
  if (!key) return false;
  const next = moveGridFocus(layout, picks.focus, key);
  if (event.shiftKey) picks.extend(order, next);
  else if (event.ctrlKey) picks.setFocus(next);
  else picks.choose(order, next, 'replace');
  document.getElementById(`gallery-${order[next]}`)?.scrollIntoView({ block: 'nearest' });
  return true;
}
