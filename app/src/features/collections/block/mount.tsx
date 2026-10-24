// How the page draws a collection block: a React root in the block's wrapper. The rules are the block's data, and the
// fallback text is the collection's name, so a reader without the feature still sees what the block is for.
import { createRoot } from 'react-dom/client';
import { commandContext } from '../../../commands/registry';
import { openPage } from '../../search';
import { emptyCollection } from '../engine';
import type { CollectionDef } from '../engine';
import { loadCollections } from '../store';
import { CollectionBlock } from './CollectionBlock';
import { readDef } from './def';

export interface CollectionBlockProps {
  data: Record<string, unknown>;
  readOnly: boolean;
  patch(data: Record<string, unknown>, fallback?: string): void;
}

export function mountCollection(container: HTMLElement, props: CollectionBlockProps) {
  const root = createRoot(container);
  const draw = (next: CollectionBlockProps) => {
    const def = readDef(next.data, loadCollections());
    root.render(
      <CollectionBlock
        def={def}
        readOnly={next.readOnly}
        onChange={(changed: CollectionDef) => next.patch({ def: changed }, fallbackOf(changed))}
        open={(page) => void openPage(commandContext('palette').notes, page)}
      />,
    );
  };
  draw(props);
  return { update: draw, destroy: () => setTimeout(() => root.unmount(), 0) };
}

/** What a reader without the feature sees. */
export const fallbackOf = (def: CollectionDef): string => def.name || emptyCollection('', '').name;
