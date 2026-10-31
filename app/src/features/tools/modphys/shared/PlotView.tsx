// Draws a plot tree (plot.ts) in the window with theme colors. The picture is described by its title for screen
// readers; the numbers it shows are also in the result table beside it.
import { createElement } from 'react';
import type { ReactNode } from 'react';
import chem from '../../ui/chem.module.css';
import result from './result.module.css';
import { SCREEN, plotTree } from './plot';
import type { PlotSpec, SvgNode } from './plot';

const camel = (name: string) =>
  name.includes('-') ? name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) : name;

function toReact(node: SvgNode | string, key: number): ReactNode {
  if (typeof node === 'string') return node;
  const props: Record<string, string | number> = { key };
  for (const [name, value] of Object.entries(node.attrs)) props[camel(name)] = value;
  if (node.tag === 'svg') {
    delete props.width;
    delete props.height;
    props.role = 'img';
  }
  return createElement(node.tag, props, ...(node.children ?? []).map((child, i) => toReact(child, i)));
}

export function Plot({ spec }: { spec: PlotSpec }) {
  return <figure className={`${chem.figure} ${result.plot}`}>{toReact(plotTree(spec, SCREEN), 0)}</figure>;
}
