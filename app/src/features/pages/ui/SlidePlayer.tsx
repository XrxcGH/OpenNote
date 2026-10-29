// Present as slides: the page's slides one at a time on a full-window stage. The slide is the page's own HTML in a
// frame the size of a slide, scaled to fit the window. Arrow keys, Page Up and Page Down, and Space move, and Escape
// leaves.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { isEnabled } from '../../../app/flags';
import { announce, Button, Switch } from '../../../ui';
import { t } from '../../../strings/t';
import { ENGLISH_LABELS, documentCss, lightTheme, strokesByBlock } from '../export';
import type { BlockContext } from '../export';
import { exportLabels } from '../host/exporter';
import { bundledFontFaces } from '../host/fonts';
import type { PageSource } from '../host/source';
import { moveSlide, slideHtml, slidesOf, slideTitles } from '../slides';
import type { Slide } from '../slides';
import { useOverlay } from './marks';
import type { Tool } from './marks';
import styles from './pagesUi.module.css';

export interface SlidePlayerProps {
  readonly source: PageSource;
  /** The block the caret is in, so the show starts at its slide. */
  readonly startBlock: string | null;
  close(): void;
}

const STAGE = { width: 1280, height: 720 } as const;

/** The CSS of a slide document: the page's own styles, set large enough to read from a distance. */
function slideStyles(): string {
  return [
    documentCss(lightTheme(bundledFontFaces())),
    'html,body{margin:0;height:100%}',
    'body{display:grid;align-items:center;padding:56px 96px;box-sizing:border-box;font-size:30px;line-height:1.5}',
    'h1{font-size:64px;line-height:1.15}h2{font-size:48px;line-height:1.2}h3{font-size:38px}',
    'img,svg{max-width:100%;max-height:520px}',
  ].join('\n');
}

interface Show {
  readonly slides: readonly Slide[];
  readonly index: number;
  readonly srcDoc: string;
  readonly headings: boolean;
  setHeadings(on: boolean): void;
  go(delta: number): void;
  goTo(index: number): void;
}

/** The slides of a page, which one is showing, and the document that draws it. */
function useShow(source: PageSource, startBlock: string | null): Show {
  const [headings, setHeadings] = useState(true);
  const [chosen, setChosen] = useState<number | null>(null);
  const slides = useMemo(
    () => slidesOf(source.page, { split: headings ? 'both' : 'dividers' }),
    [source.page, headings],
  );
  const first = Math.max(0, startBlock ? slides.findIndex((slide) => slide.blocks.includes(startBlock)) : 0);
  // An empty deck stays at 0: moveSlide answers -1 there, which would show "0 / 1".
  const index = Math.max(0, Math.min(chosen ?? first, slides.length - 1));
  const titles = useMemo(() => slideTitles(slides, (n) => t('pageViews.slides.untitled', { n })), [slides]);
  const css = useMemo(() => slideStyles(), []);
  const cx: BlockContext = useMemo(
    () => ({
      page: source.page,
      assetUrl: (asset) => source.assetUrls[asset.id] ?? null,
      labels: { ...ENGLISH_LABELS, ...exportLabels() },
      strokes: strokesByBlock(source.page.strokes),
    }),
    [source],
  );
  const body = slides[index] ? slideHtml(slides[index], cx, titles[index]) : '';
  const head = `<meta charset="utf-8"><style>${css}</style>`;
  const lang = source.page.language;
  const srcDoc = `<!doctype html><html lang="${lang}"><head>${head}</head><body><main>${body}</main></body></html>`;
  useEffect(() => {
    if (slides.length > 0) announce(t('pageViews.slides.gone', { n: index + 1, title: titles[index] }));
  }, [index, slides.length, titles]);
  return {
    slides,
    index,
    srcDoc,
    headings,
    setHeadings,
    go: (delta) => setChosen(moveSlide(index, delta, slides.length)),
    goTo: setChosen,
  };
}

/** Focuses the stage, goes full screen, and puts focus back where it was when the show ends. */
function useStage(stage: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const element = stage.current;
    const opener = document.activeElement as HTMLElement | null;
    element?.focus();
    void element?.requestFullscreen?.().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      opener?.focus?.();
    };
  }, [stage]);
}

/** The scale that fits a slide to the room the stage has. */
function useFit(view: RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = view.current;
    if (!element) return;
    const fit = () => setScale(Math.min(element.clientWidth / STAGE.width, element.clientHeight / STAGE.height));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view]);
  return scale;
}

interface Marking {
  readonly tool: Tool;
  choose(tool: Tool): void;
  clear(): void;
}

function keyHandler(show: Show, close: () => void, marking: Marking | null) {
  const last = Math.max(0, show.slides.length - 1);
  const keys: Record<string, () => void> = {
    ArrowRight: () => show.go(1),
    ArrowDown: () => show.go(1),
    PageDown: () => show.go(1),
    ' ': () => show.go(1),
    ArrowLeft: () => show.go(-1),
    ArrowUp: () => show.go(-1),
    PageUp: () => show.go(-1),
    Home: () => show.goTo(0),
    End: () => show.goTo(last),
    Escape: close,
    ...(marking
      ? {
          l: () => marking.choose('laser'),
          p: () => marking.choose('ink'),
          m: () => marking.choose('move'),
          c: marking.clear,
        }
      : {}),
  };
  return (event: KeyboardEvent) => {
    const run = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    // A focused button keeps Space and Enter for itself.
    if (!run || (event.target instanceof HTMLButtonElement && event.key === ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };
}

function MarkTools({ marking }: { marking: Marking }) {
  const tools: readonly { id: Tool; key: string }[] = [
    { id: 'laser', key: 'L' },
    { id: 'ink', key: 'P' },
    { id: 'move', key: 'M' },
  ];
  return (
    <span role="toolbar" aria-label={t('pagesPlus.present.tool')}>
      {tools.map(({ id, key }) => (
        <Button
          key={id}
          variant={marking.tool === id ? 'primary' : 'quiet'}
          aria-pressed={marking.tool === id}
          onClick={() => marking.choose(id)}
        >
          {t('pagesPlus.present.withKey', { name: t(`pagesPlus.present.tools.${id}`), key })}
        </Button>
      ))}
      <Button variant="quiet" onClick={marking.clear}>
        {t('pagesPlus.present.withKey', { name: t('pagesPlus.present.clear'), key: 'C' })}
      </Button>
    </span>
  );
}

function Controls({ show, close, marking }: { show: Show; close(): void; marking: Marking | null }) {
  const { slides, index } = show;
  return (
    <div className={styles.stageBar}>
      <Button variant="quiet" disabled={index === 0} onClick={() => show.go(-1)}>
        {t('pageViews.slides.previous')}
      </Button>
      <span>{t('pageViews.slides.counter', { n: index + 1, total: Math.max(1, slides.length) })}</span>
      <Button variant="quiet" disabled={index >= slides.length - 1} onClick={() => show.go(1)}>
        {t('pageViews.slides.next')}
      </Button>
      {marking ? <MarkTools marking={marking} /> : null}
      <Switch label={t('pageViews.slides.splitHeadings')} checked={show.headings} onChange={show.setHeadings} />
      <span className={styles.stageHelp}>{t('pageViews.slides.help')}</span>
      <Button variant="quiet" onClick={close}>
        {t('pageViews.slides.exit')}
      </Button>
    </div>
  );
}

export function SlidePlayer({ source, startBlock, close }: SlidePlayerProps) {
  const show = useShow(source, startBlock);
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const scale = useFit(view);
  useStage(stage);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useOverlay(canvas);
  const [tool, setTool] = useState<Tool>('move');
  const marked = isEnabled('pages.slideMarks');
  const marking: Marking | null = marked
    ? {
        tool,
        choose: (next) => {
          setTool(next);
          announce(t(`pagesPlus.present.tools.${next}`));
        },
        clear: () => overlay.current?.clear(),
      }
    : null;
  // A mark belongs to the slide it was made on.
  useEffect(() => overlay.current?.clear(), [show.index, overlay]);
  const offset = `translate(${(-STAGE.width * scale) / 2}px, ${(-STAGE.height * scale) / 2}px) scale(${scale})`;
  return (
    <div
      ref={stage}
      className={styles.stage}
      role="dialog"
      aria-modal="true"
      aria-label={t('pageViews.slides.title')}
      tabIndex={-1}
      onKeyDown={keyHandler(show, close, marking)}
    >
      <div ref={view} className={styles.stageView}>
        {show.slides.length === 0 ? (
          <p className={styles.stageEmpty}>{t('pageViews.slides.empty')}</p>
        ) : (
          <iframe
            className={styles.slideFrame}
            title={t('pageViews.slides.label', { n: show.index + 1, total: show.slides.length })}
            sandbox="allow-same-origin"
            srcDoc={show.srcDoc}
            tabIndex={-1}
            style={{ transform: offset }}
          />
        )}
        {marked ? (
          <canvas
            ref={canvas}
            className={styles.presentMarks}
            data-tool={tool}
            aria-hidden="true"
            onPointerDown={(event) => overlay.current?.down(event.nativeEvent, tool)}
            onPointerMove={(event) => overlay.current?.move(event.nativeEvent, tool)}
            onPointerUp={(event) => overlay.current?.up(event.nativeEvent)}
            onPointerCancel={(event) => overlay.current?.up(event.nativeEvent)}
            onPointerLeave={() => overlay.current?.leave()}
          />
        ) : null}
      </div>
      <Controls show={show} close={close} marking={marking} />
    </div>
  );
}
