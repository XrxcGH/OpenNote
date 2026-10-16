// Citation and bibliography blocks that follow the chosen style. A block names its notebook's source list and the source
// (or sources) it shows, not the words, so changing the style in the Citations window changes every citation and the
// bibliography on the page, and so does changing a source. The words kept with the block for readers that do not know
// it, and for search, are those at the time it was added.
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { sourcesOf, sourcesStore, styleStore } from '../store';
import { bibliographyOrder, styleOf } from '../styles';
import type { Source } from '../model';
import styles from './citations.module.css';

/** Markdown italics and bold in an entry as elements, so no markup is ever built from text. */
export function inlineNodes(markdown: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    if (match.index > last) nodes.push(markdown.slice(last, match.index));
    nodes.push(
      match[1] !== undefined ? <strong key={match.index}>{match[1]}</strong> : <em key={match.index}>{match[2]}</em>,
    );
    last = match.index + match[0].length;
  }
  if (last < markdown.length) nodes.push(markdown.slice(last));
  return nodes;
}

function useLive(notebook: string): { style: string; sources: readonly Source[] } {
  const style = useStore(styleStore, (current) => current);
  useStore(sourcesStore, (current) => current[notebook]);
  return { style, sources: sourcesOf(notebook) };
}

export function LiveCitation({ notebook, source }: { notebook: string; source: string }) {
  const { style, sources } = useLive(notebook);
  const at = sources.findIndex((one) => one.id === source);
  if (at < 0) return <span className={styles.liveMissing}>{t('study.citations.live.missing')}</span>;
  return <span className={styles.live}>{inlineNodes(styleOf(style).inline(sources[at], at + 1))}</span>;
}

export function LiveBibliography({
  notebook,
  sources: wanted,
}: {
  notebook: string;
  sources: readonly string[] | null;
}) {
  const { style, sources } = useLive(notebook);
  const chosen = wanted === null ? sources : sources.filter((one) => wanted.includes(one.id));
  if (chosen.length === 0) return <p className={styles.muted}>{t('study.citations.live.noSources')}</p>;
  const ordered = bibliographyOrder(chosen, style);
  return (
    <ul className={styles.liveList} aria-label={t('study.citations.bibliography')}>
      {ordered.map((source, index) => (
        <li key={source.id}>{inlineNodes(styleOf(style).reference(source, index + 1))}</li>
      ))}
    </ul>
  );
}

export interface LiveBlockProps {
  data: Record<string, unknown>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function mount(container: HTMLElement, props: LiveBlockProps, draw: (data: Record<string, unknown>) => ReactNode) {
  const root = createRoot(container);
  const render = (next: LiveBlockProps) => root.render(draw(next.data));
  render(props);
  return { update: render, destroy: () => setTimeout(() => root.unmount(), 0) };
}

export function mountCitation(container: HTMLElement, props: LiveBlockProps) {
  return mount(container, props, (data) => <LiveCitation notebook={text(data.notebook)} source={text(data.source)} />);
}

export function mountBibliography(container: HTMLElement, props: LiveBlockProps) {
  return mount(container, props, (data) => (
    <LiveBibliography
      notebook={text(data.notebook)}
      sources={
        Array.isArray(data.sources) ? data.sources.filter((one): one is string => typeof one === 'string') : null
      }
    />
  ));
}
