// Draws a kit picture in the window. Theme tones become CSS variables, so the picture follows light, dark, and
// contrast themes; the picture is one image with a text description for screen readers.
import { createElement } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { TONE_VARS, toneOf } from '../core/svg';
import type { SvgNode } from '../core/svg';
import styles from './reasoning.module.css';

function render(node: SvgNode | string, key: number): ReactNode {
  if (typeof node === 'string') return node;
  const props: Record<string, unknown> = { key };
  const style: CSSProperties = {};
  for (const [name, value] of Object.entries(node.attrs)) {
    const tone = toneOf(value);
    if (tone && (name === 'fill' || name === 'stroke')) style[name] = `var(${TONE_VARS[tone]})`;
    else props[name] = value;
  }
  if (Object.keys(style).length) props.style = style;
  return createElement(node.tag, props, ...node.children.map((child, i) => render(child, i)));
}

export function SvgView({ svg, alt }: { svg: SvgNode; alt: string }) {
  const width = Number(svg.attrs.width) || 400;
  return (
    <figure className={styles.figure}>
      <svg role="img" aria-label={alt} viewBox={String(svg.attrs.viewBox)} style={{ maxInlineSize: `${width}px` }}>
        {svg.children.map((child, i) => render(child, i))}
      </svg>
    </figure>
  );
}
