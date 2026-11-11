// The studio's layout (DESIGN 5.1), top to bottom: the toolbar, the files (a tree beside the editor when the window
// is wider than 900 px, else tabs with a Files menu), the editor, the bottom panel, and the status bar.
import { useEffect, useRef, useState } from 'react';
import { BottomPanel } from './BottomPanel';
import type { StudioController } from './controller';
import { EditorPane } from './EditorPane';
import { FileTree, TabStrip } from './Files';
import { StatusBar } from './StatusBar';
import styles from './studio.module.css';
import { Toolbar } from './Toolbar';

/** Wider than this, the file tree shows beside the editor. */
export const TREE_WIDTH = 900;

function useWide(ref: React.RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(([entry]) => setWide((entry?.contentRect.width ?? 0) > TREE_WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return wide;
}

export function Studio({ controller }: { controller: StudioController }) {
  const root = useRef<HTMLDivElement>(null);
  const wide = useWide(root);
  return (
    <div ref={root} className={styles.studio} data-code-studio="" data-testid="code-studio">
      <Toolbar controller={controller} />
      <div className={styles.body}>
        {wide && <FileTree controller={controller} />}
        <div className={styles.main}>
          <TabStrip controller={controller} withFilesMenu={!wide} />
          <EditorPane controller={controller} />
        </div>
      </div>
      <BottomPanel controller={controller} />
      <StatusBar controller={controller} />
    </div>
  );
}
