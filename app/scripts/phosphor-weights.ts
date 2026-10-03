// Phosphor ships each icon as one module that holds every weight (thin, light, regular, bold, fill, duotone) in a
// Map, so importing an icon brings in six drawings of it. The interface draws regular and fill (ui/icons.ts), and
// the other four weights were about two thirds of the icon code in the start-up bundle.
//
// This build plugin keeps only the weights the interface draws. It works on the module text. A Phosphor release
// that changes how those modules are laid out then fails the build and the unit test, instead of quietly shipping
// the weights again.

import type { Plugin } from 'vite';

/** The weights the interface draws. */
export const KEPT_WEIGHTS: readonly string[] = ['regular', 'fill'];

/** Phosphor's per-icon definition modules, such as .../@phosphor-icons/react/dist/defs/Moon.es.js. */
const DEFS_MODULE = /[\\/]@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/][^\\/]+\.es\.js$/;

/** Where the Map's entries start: the `[` after `new Map(`. */
const MAP_OPEN = /new Map\(\s*\[/;

/** The source text of each element of the array that opens at `open`, and the index of its closing bracket. */
function arrayItems(source: string, open: number): { items: string[]; close: number } {
  const items: string[] = [];
  let depth = 0;
  let quote = '';
  let start = open + 1;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '[' || char === '(' || char === '{') {
      depth += 1;
    } else if (char === ']' || char === ')' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        if (source.slice(start, i).trim()) items.push(source.slice(start, i).trim());
        return { items, close: i };
      }
    } else if (char === ',' && depth === 1) {
      items.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error('The Map of icon weights never closes.');
}

/** Phosphor's icon module with only the weights in `keep`. Throws when the module isn't laid out as expected. */
export function keepWeights(source: string, keep: readonly string[] = KEPT_WEIGHTS, name = 'an icon'): string {
  const found = MAP_OPEN.exec(source);
  if (!found)
    throw new Error(`Phosphor's module for ${name} has no Map of weights; update app/scripts/phosphor-weights.ts.`);
  const open = found.index + found[0].length - 1;
  const { items, close } = arrayItems(source, open);
  const weightOf = (item: string) => /^\[\s*"(\w+)"/.exec(item)?.[1];
  const kept = items.filter((item) => keep.includes(weightOf(item) ?? ''));
  const missing = keep.filter((weight) => !kept.some((item) => weightOf(item) === weight));
  if (missing.length > 0) {
    throw new Error(
      `Phosphor's module for ${name} has no ${missing.join(' or ')} weight; update app/scripts/phosphor-weights.ts.`,
    );
  }
  return `${source.slice(0, open + 1)}\n  ${kept.join(',\n  ')}\n${source.slice(close)}`;
}

/** Drops the unused weights from Phosphor's icon modules in production builds. */
export function phosphorWeights(): Plugin {
  return {
    name: 'opennote:phosphor-weights',
    apply: 'build',
    transform(code, id) {
      const path = id.split('?')[0];
      return DEFS_MODULE.test(path) ? { code: keepWeights(code, KEPT_WEIGHTS, path), map: null } : null;
    },
  };
}
