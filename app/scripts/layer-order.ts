// The app's style sheets rely on one cascade layer order (styles/layers.css, ARCHITECTURE.md section 4.6). A browser
// fixes that order the first time it meets each layer name. A build splits the CSS into one file per chunk. It links
// the shared chunks' files before the entry's own, so a sheet that opens with @layer components loaded before
// layers.css. Base rules then beat components, states, and forced colors.
//
// This build plugin starts every emitted style sheet with the order statement from layers.css. The order is then
// the same whichever file loads first, including sheets that lazy chunks add later. Repeating the statement once
// the order is set changes nothing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** The style sheet that declares the layer order. */
export const LAYERS_CSS = join(import.meta.dirname, '..', 'src', 'styles', 'layers.css');

/** The `@layer a, b, c;` order statement in `css`, on one line. Throws when there is none. */
export function layerOrderStatement(css: string): string {
  const match = /@layer\s+[\w-]+(?:\s*,\s*[\w-]+)+\s*;/.exec(css);
  if (!match) throw new Error('styles/layers.css has no @layer order statement.');
  return match[0].replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ');
}

/** `css` with the order statement in front, unless it already starts with it. */
export function withLayerOrder(css: string, statement: string): string {
  return css.startsWith(statement) ? css : `${statement}${css}`;
}

export function layerOrder(source = LAYERS_CSS): Plugin {
  return {
    name: 'opennote:layer-order',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const statement = layerOrderStatement(readFileSync(source, 'utf8'));
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue;
        const css = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
        file.source = withLayerOrder(css, statement);
      }
    },
  };
}
