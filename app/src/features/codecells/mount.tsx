// How the page draws a code cell block: a React root in the block's wrapper. The language and the code are the
// block's data, and the same code in a fence is its fallback, so search, exports, and other apps keep it as text.
import { createRoot } from 'react-dom/client';
import { CodeCellPanel } from './CodeCellPanel';
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

export function mountCodeCell(container: HTMLElement, props: CodeCellBlockProps) {
  const root = createRoot(container);
  const draw = (next: CodeCellBlockProps) => {
    const language = isLanguage(next.data.language) ? next.data.language : 'python';
    root.render(
      <CodeCellPanel
        language={language}
        source={typeof next.data.source === 'string' ? next.data.source : ''}
        readOnly={next.readOnly}
        announce={next.announce}
        onChange={(cell) => next.patch(cell, fallbackOf(cell.language, cell.source))}
      />,
    );
  };
  draw(props);
  return { update: draw, destroy: () => setTimeout(() => root.unmount(), 0) };
}
