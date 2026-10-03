// The page view's Phase 6 side (loaded when a page is mounted): the page's view settings (mode, paper, margins, and
// background), the sheets drawn under a paginated page, and the paper under an infinite one. Every change goes to the
// page as one setPage merge patch, so it is one undo step. The paginated flow itself is in paginate.ts.
import { isEnabled } from '../../../app/flags';
import { announce } from '../../../ui';
import { t } from '../../../strings/t';
import type { MountedPage } from '../../page';
import {
  pageLayout,
  readView,
  setBackground as withBackground,
  setMargins as withMargins,
  setMode as withMode,
  setOrientation as withOrientation,
  setPaperSize,
  viewPatch,
} from '../layout';
import type { PageLayout, PageViewSpec } from '../layout';
import { GAP_HALF, MARGIN_PRESETS, MAX_SHEETS } from '../pagination';
import { PRESETS, TEMPLATE_IDS, infinitePaths, paperPaths, paperSvg } from '../paper';
import type { PageBackground } from '../paper';
import { lightTheme } from '../export/style';
import { paperStyle } from '../print/css';
import { currentSheet, fitSheet, openingZoom } from '../zoom';
import { createPaginator } from './paginate';
import { attachReading } from './reading';
import type { Paginator } from './paginate';
import styles from './live.module.css';
import { applyNotebookDefault } from './notebookDefault';
import { pagesViewEpoch, shownPagesView } from './shown';
import type { MarginName, PagesViewApi, PagesViewState, PaperName } from './shown';

const STYLE = paperStyle(lightTheme()).style;
/** Paper that may be on screen while the infinite canvas is drawn: more sheets than this draw nothing. */
const MAX_PAPER_SIDE = 40_000;

/** The preset a background stands for, or 'custom'. */
function presetOf(background: PageViewSpec['background']): string {
  if (background.pattern === 'template') {
    return Object.entries(TEMPLATE_IDS).find(([, id]) => id === background.template)?.[0] ?? 'custom';
  }
  for (const [id, preset] of Object.entries(PRESETS) as [string, PageBackground][]) {
    if (preset.pattern !== background.pattern) continue;
    if (preset.spacing === undefined || Math.abs(preset.spacing - background.spacing) < 0.05) return id;
  }
  return 'custom';
}

function marginName(margins: readonly number[]): MarginName | 'custom' {
  for (const [name, preset] of Object.entries(MARGIN_PRESETS) as [string, readonly number[]][]) {
    if (preset.every((value, i) => Math.abs(value - margins[i]) < 0.5)) return name as MarginName;
  }
  return 'custom';
}

function paperName(view: PageViewSpec): PaperName | 'custom' {
  const size: string = view.paper.size;
  return size === 'letter' || size === 'a4' || size === 'a5' || size === 'legal' || size === 'tabloid'
    ? size
    : 'custom';
}

class PagesView {
  private spec: PageViewSpec;
  private layout: PageLayout;
  private readonly sheetsLayer: HTMLElement;
  private readonly paperLayer: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly paginator: Paginator;
  private reading: ReturnType<typeof attachReading> | null = null;
  private readonly stops: (() => void)[] = [];
  private sheets = 1;
  private frame = 0;
  private paperKey = '';
  private lastMode: 'infinite' | 'paginated' | null = null;
  /** Set when the person switches to the paginated view, which fits a sheet wider than the window. */
  private fitOnEnter = false;

  constructor(private readonly mounted: MountedPage) {
    const { viewport } = mounted.viewport;
    this.spec = readView(mounted.layout.view()).view;
    this.layout = pageLayout(this.spec);
    this.sheetsLayer = this.layer(styles.sheets);
    this.paperLayer = this.layer(styles.paper);
    this.counter = document.createElement('div');
    this.counter.className = styles.counter;
    this.counter.setAttribute('aria-hidden', 'true');
    this.counter.hidden = true;
    viewport.parentElement?.append(this.counter);
    this.paginator = createPaginator(mounted, {
      layout: () => this.layout,
      onSheets: (count) => this.setSheets(count),
    });
  }

  private layer(className: string): HTMLElement {
    const element = document.createElement('div');
    element.className = className;
    element.setAttribute('aria-hidden', 'true');
    this.mounted.viewport.world.prepend(element);
    return element;
  }

  start(): void {
    const { mounted } = this;
    this.stops.push(
      mounted.layout.onView((raw) => {
        this.spec = readView(raw).view;
        this.layout = pageLayout(this.spec);
        this.apply();
        pagesViewEpoch.set((n) => n + 1);
      }),
      mounted.viewport.onCamera(() => this.updateCounter()),
    );
    this.reading = attachReading(mounted, () => this.spec.mode === 'paginated');
    this.apply();
    if (isEnabled('pages.layouts')) {
      applyNotebookDefault(
        mounted,
        () => this.spec,
        (next) => this.change(next),
      );
    }
  }

  stop(): void {
    this.reading?.stop();
    this.stops.forEach((stop) => stop());
    cancelAnimationFrame(this.frame);
    this.paginator.stop();
    this.sheetsLayer.remove();
    this.paperLayer.remove();
    this.counter.remove();
  }

  state(): PagesViewState {
    const { paper } = this.spec;
    return {
      mode: this.spec.mode === 'paginated' ? 'paginated' : 'infinite',
      layout: this.spec.layout === 'flow' ? 'flow' : 'freeform',
      paper: paperName(this.spec),
      orientation: paper.width > paper.height ? 'landscape' : 'portrait',
      margins: marginName(paper.margins),
      background: presetOf(this.spec.background),
      sheets: this.sheets,
    };
  }

  /** Sends the change from the current view to `next` as one merge patch. */
  private change(next: PageViewSpec, announcement?: string): void {
    const patch = viewPatch(this.spec, next);
    if (!patch) return;
    // The first change of the view keeps what the page showed: a mode switch never moves the content under the pointer.
    this.mounted.layout.patchView(patch);
    if (announcement) announce(announcement);
  }

  readonly api: PagesViewApi = {
    state: () => this.state(),
    setMode: (mode) => {
      if (this.spec.mode === mode) return;
      this.paginator.rememberAnchor();
      this.fitOnEnter = mode === 'paginated';
      this.change(
        withMode(this.spec, mode),
        t(mode === 'paginated' ? 'pageViews.status.nowPages' : 'pageViews.status.nowCanvas', { sheets: this.sheets }),
      );
    },
    setLayout: (layout) => {
      if (this.state().layout === layout) return;
      this.mounted.layout.setLayout(layout);
    },
    setPaper: (size) => {
      this.change(
        setPaperSize(this.spec, size),
        t('pageViews.status.paperSet', { paper: t(`pageViews.paper.size.${size}`) }),
      );
    },
    setOrientation: (orientation) => this.change(withOrientation(this.spec, orientation)),
    setMargins: (margins) => this.change(withMargins(this.spec, margins)),
    setBackground: (preset) => {
      const found = (PRESETS as Record<string, PageBackground>)[preset];
      if (!found) return;
      const { spacing, pattern } = found;
      this.change(
        withBackground(this.spec, { pattern, spacing: spacing ?? this.spec.background.spacing }),
        t('pageViews.status.backgroundSet', {
          background: t(`pageViews.background.${preset as keyof typeof PRESETS}`),
        }),
      );
    },
    view: () => this.spec,
    edit: (change, announcement) => this.change(change(this.spec), announcement),
    fitSheet: () => {
      const { viewport } = this.mounted;
      const rect = viewport.camera().viewport;
      const { sheet } = this.layout;
      const camera = viewport.camera();
      const view = { zoom: camera.zoom, left: camera.scrollX / camera.zoom, top: camera.scrollY / camera.zoom };
      const at = currentSheet(sheet, view, { width: rect.w, height: rect.h }, this.sheets);
      const zoom = fitSheet({ width: rect.w, height: rect.h }, sheet.width, sheet.height);
      viewport.setZoom(zoom);
      viewport.scrollTo(0, at * sheet.height * zoom);
    },
    readingAids: () => void import('../ui/readingCommands').then((m) => m.openReadingAids()),
  };

  private setSheets(count: number): void {
    if (count === this.sheets) return;
    this.sheets = count;
    if (this.spec.mode === 'paginated') this.drawSheets();
    this.updateCounter();
    pagesViewEpoch.set((n) => n + 1);
  }

  /** Brings the page up to date with the view: mode, paper, and background. */
  private apply(): void {
    const paginated = this.spec.mode === 'paginated';
    const { world } = this.mounted.viewport;
    if (paginated) {
      world.style.background = 'transparent';
      this.paperLayer.replaceChildren();
      this.paperKey = '';
      this.paginator.enable();
      this.drawSheets();
      this.fitWide();
    } else {
      if (this.lastMode === 'paginated') this.paginator.disable();
      world.style.background = '';
      this.sheetsLayer.replaceChildren();
      this.paperKey = '';
      this.drawInfinitePaper();
    }
    this.lastMode = paginated ? 'paginated' : 'infinite';
    this.reading?.refresh();
    this.updateCounter();
  }

  /** A sheet wider than the window zooms out to fit its width, once, when the person switches views. */
  private fitWide(): void {
    if (!this.fitOnEnter) return;
    this.fitOnEnter = false;
    const { viewport } = this.mounted;
    const camera = viewport.camera();
    const zoom = openingZoom({ width: camera.viewport.w, height: camera.viewport.h }, this.layout.sheet.width);
    if (zoom < camera.zoom - 0.001) viewport.setZoom(zoom);
  }

  /** The stack of sheets: paper, then the gap bands over the margins at every edge between two sheets. */
  private drawSheets(): void {
    const { sheet } = this.layout;
    const count = Math.min(this.sheets, MAX_SHEETS);
    const paper = paperSvg(
      paperPaths(this.layout.background, sheet),
      { x: 0, y: 0, w: sheet.width, h: sheet.height },
      this.layout.background,
      STYLE,
    );
    const key = `${sheet.width}x${sheet.height}:${count}:${paper.length}:${this.layout.background.pattern}`;
    if (key === this.paperKey) return;
    this.paperKey = key;
    const parts: string[] = [];
    for (let k = 0; k < count; k += 1) {
      const box = `inset-block-start:${k * sheet.height}px;inline-size:${sheet.width}px;block-size:${sheet.height}px`;
      parts.push(`<div class="${styles.sheet}" style="${box}">${paper}</div>`);
    }
    for (let k = 1; k < count; k += 1) {
      const top = k * sheet.height - GAP_HALF;
      const box = `inset-block-start:${top}px;block-size:${2 * GAP_HALF}px;inline-size:${sheet.width}px`;
      parts.push(`<div class="${styles.edge}" style="${box}"></div>`);
    }
    this.sheetsLayer.innerHTML = parts.join('');
    this.sheetsLayer.style.inlineSize = `${sheet.width}px`;
    this.sheetsLayer.style.blockSize = `${count * sheet.height}px`;
    this.mounted.viewport.setContent({ w: sheet.width, h: count * sheet.height, floating: false });
  }

  /** The paper under the infinite canvas: the pattern over the page's current extent. */
  private drawInfinitePaper(): void {
    const { background, sheet } = this.layout;
    if (background.pattern === 'plain') {
      this.paperLayer.replaceChildren();
      return;
    }
    const { world } = this.mounted.viewport;
    const w = Math.min(MAX_PAPER_SIDE, Math.max(world.offsetWidth, sheet.width));
    const h = Math.min(MAX_PAPER_SIDE, Math.max(world.offsetHeight, sheet.height * 2));
    const paths = infinitePaths(background, { x: 0, y: 0, w, h }, sheet);
    this.paperLayer.innerHTML = paperSvg(paths, { x: 0, y: 0, w, h }, background, STYLE);
    this.paperLayer.style.inlineSize = `${w}px`;
    this.paperLayer.style.blockSize = `${h}px`;
  }

  private updateCounter(): void {
    const show = this.spec.mode === 'paginated' && this.sheets > 1;
    this.counter.hidden = !show;
    if (!show) return;
    const camera = this.mounted.viewport.camera();
    const view = { zoom: camera.zoom, left: camera.scrollX / camera.zoom, top: camera.scrollY / camera.zoom };
    const at = currentSheet(
      this.layout.sheet,
      view,
      { width: camera.viewport.w, height: camera.viewport.h },
      this.sheets,
    );
    this.counter.textContent = t('pageViews.status.sheetCount', { sheet: at + 1, sheets: this.sheets });
  }
}

/** Attaches the page view's Phase 6 side to a mounted page. Returns a function that detaches it again. */
export function attachPagesView(mounted: MountedPage): () => void {
  const view = new PagesView(mounted);
  view.start();
  shownPagesView.set(view.api);
  return () => {
    if (shownPagesView.get() === view.api) shownPagesView.set(null);
    view.stop();
  };
}
