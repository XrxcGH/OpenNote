// The page view's Phase 6 side (loaded when a page is mounted): the page's view settings (mode, paper, margins, and
// background), the sheets drawn under a paginated page, and the paper under an infinite one. Every change goes to the
// page as one setPage merge patch, so it is one undo step. The paginated flow itself is in paginate.ts.
import { isEnabled } from '../../../app/flags';
import { firstRuleBelow } from '../../../core/ruled';
import { announce } from '../../../ui';
import { t } from '../../../strings/t';
import type { MountedPage } from '../../page';
import {
  pageLayout,
  readView,
  screenLayout,
  setBackground as withBackground,
  setMargins as withMargins,
  setMode as withMode,
  setOrientation as withOrientation,
  setPaperSize,
  viewPatch,
} from '../layout';
import type { PageLayout, PageViewSpec } from '../layout';
import { GAP_HALF, MARGIN_PRESETS, MAX_SHEETS } from '../pagination';
import { PRESETS, TEMPLATE_IDS, infinitePaths, paperPaths, paperRules, paperSvg } from '../paper';
import type { PageBackground } from '../paper';
import { lightTheme } from '../export/style';
import { paperStyle } from '../print/css';
import { currentSheet, fitSheet, openingZoom } from '../zoom';
import { minSheetsOf, withMinSheets } from '../layout';
import { createStrip } from './strip';
import type { Strip } from './strip';
import { createPaginator } from './paginate';
import { attachReading } from './reading';
import type { Paginator } from './paginate';
import styles from './live.module.css';
import { applyNotebookDefault } from './notebookDefault';
import { pagesViewEpoch, shownPagesView, sheetNav } from './shown';
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
  /** The sheets the content needs. The view may ask for more (`minSheets`), and the page shows the larger. */
  private contentSheets = 1;
  private strip: Strip | null = null;
  private frame = 0;
  private paperKey = '';
  /** The y of the first rule below the page's title, on paper with rules: the header above it is left blank. */
  private headerRule: number | undefined;
  private lastMode: 'infinite' | 'paginated' | null = null;
  /** Set when the person switches to the paginated view, which fits a sheet wider than the window. */
  private fitOnEnter = false;

  constructor(private readonly mounted: MountedPage) {
    const { viewport } = mounted.viewport;
    this.spec = readView(mounted.layout.view()).view;
    this.layout = screenLayout(pageLayout(this.spec));
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
        this.layout = screenLayout(pageLayout(this.spec));
        this.sheets = this.wantedSheets();
        this.apply();
        pagesViewEpoch.set((n) => n + 1);
      }),
      mounted.viewport.onCamera(() => this.updateCounter()),
      sheetNav.subscribe(() => this.refreshStrip()),
    );
    if (isEnabled('pages.sheets')) {
      this.strip = createStrip(mounted.viewport.viewport.parentElement ?? mounted.viewport.viewport, {
        sheets: () => this.sheets,
        current: () => this.sheetIndex(),
        paper: () => this.thumbnailPaper(),
        aspect: () => this.layout.sheet.width / this.layout.sheet.height,
        goTo: (sheet) => this.api.goToSheet(sheet),
        add: () => this.api.addSheet(),
      });
      const host = mounted.viewport.viewport;
      host.addEventListener('pointerup', this.onPenUp);
      this.stops.push(() => host.removeEventListener('pointerup', this.onPenUp));
    }
    this.reading = attachReading(mounted, () => this.spec.mode === 'paginated');
    // The title can grow a line, the first line can change its size, and the fonts load after the page does.
    if (mounted.title && typeof ResizeObserver !== 'undefined') {
      const watch = new ResizeObserver(() => this.refreshHeader());
      watch.observe(mounted.title.element);
      watch.observe(mounted.flow.element);
      this.stops.push(() => watch.disconnect());
    }
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
    this.mounted.flow.setRules(null);
    delete this.mounted.viewport.world.dataset.sheets;
    this.sheetsLayer.remove();
    this.paperLayer.remove();
    this.counter.remove();
    this.strip?.destroy();
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
    sheets: () => ({ count: this.sheets, current: this.sheetIndex() }),
    goToSheet: (sheet) => this.goToSheet(sheet),
    addSheet: () => {
      if (this.spec.mode !== 'paginated' || this.sheets >= MAX_SHEETS) return;
      this.change(withMinSheets(this.spec, this.sheets + 1), t('pagesPlus.sheets.added', { n: this.sheets + 1 }));
      // The view settles on the next frame; the new sheet is the last one then.
      requestAnimationFrame(() => this.goToSheet(this.sheets - 1));
    },
  };

  /** The sheet the window is on, from 0. */
  private sheetIndex(): number {
    const camera = this.mounted.viewport.camera();
    const view = { zoom: camera.zoom, left: camera.scrollX / camera.zoom, top: camera.scrollY / camera.zoom };
    return currentSheet(this.layout.sheet, view, { width: camera.viewport.w, height: camera.viewport.h }, this.sheets);
  }

  /** Scrolls so a sheet's top is at the top of the window, or fits the whole sheet when sheets flip one at a time. */
  private goToSheet(target: number): void {
    if (this.spec.mode !== 'paginated') return;
    const sheet = Math.min(Math.max(0, target), this.sheets - 1);
    const { viewport } = this.mounted;
    const camera = viewport.camera();
    const { sheet: g } = this.layout;
    if (sheetNav.get().flip) {
      const zoom = fitSheet({ width: camera.viewport.w, height: camera.viewport.h }, g.width, g.height);
      viewport.setZoom(zoom);
      viewport.scrollTo(0, sheet * g.height * zoom);
    } else {
      viewport.scrollTo(camera.scrollX, sheet * g.height * camera.zoom);
    }
    announce(t('pagesPlus.sheets.at', { n: sheet + 1, total: this.sheets }));
  }

  /** The paper of one sheet for the strip's thumbnails. */
  private thumbnailPaper(): string {
    const { sheet, background } = this.layout;
    return paperSvg(paperPaths(background, sheet), { x: 0, y: 0, w: sheet.width, h: sheet.height }, background, STYLE);
  }

  private refreshStrip(): void {
    const { open, flip } = sheetNav.get();
    this.strip?.show(open && this.spec.mode === 'paginated', flip);
    this.strip?.refresh();
  }

  /** Writing near the bottom of the last sheet with a pen adds a sheet with the same paper. */
  private readonly onPenUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'pen' || this.spec.mode !== 'paginated' || this.spec.layout === 'flow') return;
    const { y } = this.mounted.viewport.toWorld(event.clientX, event.clientY);
    const { sheet } = this.layout;
    if (y > this.sheets * sheet.height - sheet.height * 0.1 && this.sheets < MAX_SHEETS) {
      this.change(withMinSheets(this.spec, this.sheets + 1), t('pagesPlus.sheets.added', { n: this.sheets + 1 }));
    }
  };

  /** The sheets to show: what the content needs, or more when the person added sheets. */
  private wantedSheets(): number {
    return Math.min(MAX_SHEETS, Math.max(this.contentSheets, minSheetsOf(this.spec)));
  }

  private setSheets(count: number): void {
    this.contentSheets = count;
    const wanted = this.wantedSheets();
    if (wanted === this.sheets) return;
    this.sheets = wanted;
    if (this.spec.mode === 'paginated') this.drawSheets();
    this.updateCounter();
    this.refreshStrip();
    pagesViewEpoch.set((n) => n + 1);
  }

  /** Brings the page up to date with the view: mode, paper, and background. */
  private apply(): void {
    const paginated = this.spec.mode === 'paginated';
    const { world } = this.mounted.viewport;
    if (paginated) world.dataset.sheets = '';
    else delete world.dataset.sheets;
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
    // On ruled paper the text lays out in the rules (features/page/layout/rules.ts), in either mode.
    this.mounted.flow.setRules(paperRules(this.layout.background, this.layout.sheet, paginated));
    this.refreshHeader();
    this.reading?.refresh();
    this.updateCounter();
    this.refreshStrip();
  }

  /**
   * The title and the date under it sit in an unruled header, like the top margin of a notebook page, and the first
   * sheet's rules begin below it, at the rule the page's first line sits above. When that moves, the paper is drawn
   * again. Print and export have no title band, so their paper keeps the rules from the top margin.
   */
  private refreshHeader(): void {
    const { flow, title } = this.mounted;
    const rules = flow.rules();
    const next = rules && title ? firstRuleBelow(flow.element.offsetTop, rules, this.firstLineMiddle()) : undefined;
    if (next === this.headerRule) return;
    this.headerRule = next;
    this.paperKey = '';
    if (this.spec.mode === 'paginated') this.drawSheets();
    else this.drawInfinitePaper();
  }

  /** The middle of the letters of the page's first line of text, in page units from the top of the world. */
  private firstLineMiddle(): number | undefined {
    const { flow, viewport } = this.mounted;
    const doc = flow.element.ownerDocument;
    const block = [...flow.element.children].find(
      (child) => child instanceof HTMLElement && child.dataset.ink === undefined && child.style.left === '',
    );
    if (!block) return undefined;
    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      const rect = range.getClientRects()[0];
      if (!rect || rect.height === 0) continue;
      const top = viewport.world.getBoundingClientRect().top;
      return ((rect.top + rect.bottom) / 2 - top) / viewport.camera().zoom;
    }
    return undefined;
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
    const { background } = this.layout;
    const draw = (from?: number) =>
      paperSvg(paperPaths(background, sheet, from), { x: 0, y: 0, w: sheet.width, h: sheet.height }, background, STYLE);
    const paper = draw();
    // Only the first sheet has the title: its rules begin below the header.
    const first = this.headerRule === undefined ? paper : draw(Math.min(this.headerRule, sheet.height));
    const key = `${sheet.width}x${sheet.height}:${count}:${paper.length}:${first.length}:${background.pattern}`;
    if (key === this.paperKey) return;
    this.paperKey = key;
    const parts: string[] = [];
    for (let k = 0; k < count; k += 1) {
      const box = `inset-block-start:${k * sheet.height}px;inline-size:${sheet.width}px;block-size:${sheet.height}px`;
      parts.push(`<div class="${styles.sheet}" style="${box}">${k === 0 ? first : paper}</div>`);
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
    const paths = infinitePaths(background, { x: 0, y: 0, w, h }, sheet, this.headerRule);
    this.paperLayer.innerHTML = paperSvg(paths, { x: 0, y: 0, w, h }, background, STYLE);
    this.paperLayer.style.inlineSize = `${w}px`;
    this.paperLayer.style.blockSize = `${h}px`;
  }

  private updateCounter(): void {
    this.strip?.mark();
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
