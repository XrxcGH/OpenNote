// A Figure drawn in the window with the theme's colors. The description stands in for the picture for a screen
// reader, and is also shown under it in small type, so what the picture says is never in color alone.
import { createElement, useId } from 'react';
import { attributes } from '../core/figure';
import type { Figure, Mark } from '../core/figure';
import styles from './earth.module.css';

const camel = (name: string): string => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function MarkView({ mark, prefix }: { mark: Mark; prefix: string }) {
  const props: Record<string, string> = {};
  for (const [key, value] of attributes(mark, false, prefix)) props[camel(key)] = value;
  if (mark.kind === 'text') return createElement('text', props, mark.text);
  return createElement(mark.kind, props);
}

export function FigureView({ figure }: { figure: Figure }) {
  const prefix = useId().replace(/:/g, '');
  return (
    <figure className={styles.figure}>
      <svg
        viewBox={`0 0 ${figure.width} ${figure.height}`}
        width={figure.width}
        role="img"
        aria-label={figure.title}
        aria-describedby={`${prefix}-desc`}
      >
        {figure.patterns?.length ? (
          <defs>
            {figure.patterns.map((p) => (
              <pattern key={p.id} id={`${prefix}${p.id}`} width={p.size} height={p.size} patternUnits="userSpaceOnUse">
                {p.marks.map((m, i) => (
                  <MarkView key={i} mark={m} prefix={prefix} />
                ))}
              </pattern>
            ))}
          </defs>
        ) : null}
        {figure.marks.map((m, i) => (
          <MarkView key={i} mark={m} prefix={prefix} />
        ))}
      </svg>
      <figcaption id={`${prefix}-desc`} className={styles.caption}>
        {figure.description}
      </figcaption>
    </figure>
  );
}
