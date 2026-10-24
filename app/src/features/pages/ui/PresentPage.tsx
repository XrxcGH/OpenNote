// Present a page: the whole page full screen, with a laser pointer and ink that fades. The page is a picture made from
// the note (the same picture Export selection makes), so nothing here can change the note. Marks are drawn on a canvas
// over it and fade by themselves. A finger, a pen, and a mouse all work: a laser follows the pointer, and ink is drawn
// while it is down. The Move tool hands a touch screen back its scrolling.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { announce, Button } from '../../../ui';
import { t } from '../../../strings/t';
import type { Picture } from '../host/picture';
import { useOverlay } from './marks';
import type { Tool } from './marks';
import styles from './pagesUi.module.css';

export interface PresentPageProps {
  readonly picture: Picture;
  close(): void;
}

const TOOLS: readonly { id: Tool; label: 'laser' | 'ink' | 'move'; key: string }[] = [
  { id: 'laser', label: 'laser', key: 'L' },
  { id: 'ink', label: 'ink', key: 'P' },
  { id: 'move', label: 'move', key: 'M' },
];

/** Goes full screen when the stage shows, and puts focus back where it was when the show ends. */
function useFullScreen(stage: RefObject<HTMLDivElement | null>): void {
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

/** How wide the window is, so the page is as wide as the window. */
function useWidth(view: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = view.current;
    if (!element) return;
    const fit = () => setWidth(element.clientWidth);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view]);
  return width;
}

interface Actions {
  choose(tool: Tool): void;
  clear(): void;
  close(): void;
  scroll(screens: number): void;
  edge(where: 'top' | 'bottom'): void;
}

/** The keys of the show: a tool, clear, leave, and scrolling. */
function keyHandler(actions: Actions) {
  const keys: Record<string, () => void> = {
    l: () => actions.choose('laser'),
    p: () => actions.choose('ink'),
    m: () => actions.choose('move'),
    c: actions.clear,
    Escape: actions.close,
    PageDown: () => actions.scroll(1),
    ' ': () => actions.scroll(1),
    ArrowDown: () => actions.scroll(0.4),
    PageUp: () => actions.scroll(-1),
    ArrowUp: () => actions.scroll(-0.4),
    Home: () => actions.edge('top'),
    End: () => actions.edge('bottom'),
  };
  return (event: KeyboardEvent) => {
    // A focused button keeps Space and Enter for itself.
    if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) return;
    const run = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!run) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };
}

function Toolbar({ tool, actions }: { tool: Tool; actions: Actions }) {
  return (
    <div className={styles.stageBar} role="toolbar" aria-label={t('pagesPlus.present.tool')}>
      {TOOLS.map(({ id, label, key }) => (
        <Button
          key={id}
          variant={tool === id ? 'primary' : 'quiet'}
          aria-pressed={tool === id}
          onClick={() => actions.choose(id)}
        >
          {t('pagesPlus.present.withKey', { name: t(`pagesPlus.present.tools.${label}`), key })}
        </Button>
      ))}
      <Button variant="quiet" onClick={actions.clear}>
        {t('pagesPlus.present.withKey', { name: t('pagesPlus.present.clear'), key: 'C' })}
      </Button>
      <span className={styles.stageHelp}>{t('pagesPlus.present.help')}</span>
      <Button variant="quiet" onClick={actions.close}>
        {t('pagesPlus.present.exit')}
      </Button>
    </div>
  );
}

export function PresentPage({ picture, close }: PresentPageProps) {
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('laser');
  const overlay = useOverlay(canvas);
  const width = useWidth(view);
  useFullScreen(stage);
  const url = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}`, [picture.svg]);
  const actions: Actions = {
    choose: (next) => {
      setTool(next);
      announce(t(`pagesPlus.present.tools.${next}`));
    },
    clear: () => overlay.current?.clear(),
    close,
    scroll: (screens) =>
      view.current?.scrollBy({ top: view.current.clientHeight * 0.85 * screens, behavior: 'smooth' }),
    edge: (where) =>
      view.current?.scrollTo({ top: where === 'top' ? 0 : view.current.scrollHeight, behavior: 'smooth' }),
  };
  const scale = width > 0 ? width / picture.width : 1;
  return (
    <div
      ref={stage}
      className={styles.stage}
      role="dialog"
      aria-modal="true"
      aria-label={t('pagesPlus.present.title')}
      tabIndex={-1}
      onKeyDown={(event) => keyHandler(actions)(event)}
    >
      <div ref={view} className={styles.presentView}>
        <div className={styles.presentSheet} style={{ width: picture.width * scale, height: picture.height * scale }}>
          <img className={styles.presentPicture} src={url} alt={t('pageViews.image.preview')} draggable={false} />
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
        </div>
      </div>
      <Toolbar tool={tool} actions={actions} />
    </div>
  );
}
