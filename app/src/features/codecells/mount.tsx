// How the page draws a code cell block: a React root in the block's wrapper. The language and the code are the
// block's data, and the same code in a fence is its fallback, so search, exports, and other apps keep it as text.
import { createRoot } from 'react-dom/client';
import { t } from '../../strings/t';
import { CodeCellPanel } from './CodeCellPanel';
import styles from './codecell.module.css';
import { isLanguage } from './sandbox/protocol';
import type { CodeLanguage } from './sandbox/protocol';

export interface CodeCellBlockProps {
  data: Record<string, unknown>;
  readOnly: boolean;
  patch(data: Record<string, unknown>, fallback?: string): void;
  announce(text: string): void;
}

/** The block's fallback text: its code in a fence with the language. */
export function fallbackOf(language: CodeLanguage, source: string): string {
  const longest = Math.max(2, ...[...source.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${source.replace(/\n$/, '')}\n${fence}`;
}

/** The newest cell format this app edits (a cell's `minEditor` above it came from a newer app). */
const KNOWN_EDITOR = 1;

/**
 * A cell from a newer app: a language this app does not run, or a format it does not know. It is shown as it is
 * stored and never changed, so an older app cannot relabel it as Python (docs/help/code-cells.md).
 */
export function needsNewerApp(data: Record<string, unknown>): boolean {
  const { language, minEditor } = data;
  if (language !== undefined && !isLanguage(language)) return true;
  return typeof minEditor === 'number' && minEditor > KNOWN_EDITOR;
}

function NewerCodeCell({ language, source }: { language: unknown; source: string }) {
  return (
    <div className={styles.root}>
      <p className={styles.help} role="status">
        {t('codeCells.newer')}
      </p>
      <p className={styles.help}>
        {t('codeCells.storedLanguage', { language: typeof language === 'string' ? language : '' })}
      </p>
      <label className={styles.field}>
        {t('codeCells.code')}
        <textarea
          className={styles.source}
          value={source}
          readOnly
          spellCheck={false}
          rows={Math.min(24, Math.max(4, source.split('\n').length + 1))}
        />
      </label>
    </div>
  );
}

export function mountCodeCell(container: HTMLElement, props: CodeCellBlockProps) {
  const root = createRoot(container);
  const draw = (next: CodeCellBlockProps) => {
    const source = typeof next.data.source === 'string' ? next.data.source : '';
    if (needsNewerApp(next.data)) {
      root.render(<NewerCodeCell language={next.data.language} source={source} />);
      return;
    }
    const language = isLanguage(next.data.language) ? next.data.language : 'python';
    root.render(
      <CodeCellPanel
        language={language}
        source={source}
        readOnly={next.readOnly}
        announce={next.announce}
        onChange={(cell) => next.patch(cell, fallbackOf(cell.language, cell.source))}
      />,
    );
  };
  draw(props);
  return { update: draw, destroy: () => setTimeout(() => root.unmount(), 0) };
}
