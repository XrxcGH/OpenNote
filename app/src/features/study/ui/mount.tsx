// How the page draws a flashcard block: a React root in the block's wrapper that shows the deck the block names.
import { createRoot } from 'react-dom/client';
import { DeckPanel } from './DeckPanel';

export interface DeckBlockProps {
  data: Record<string, unknown>;
}

const deckOf = (props: DeckBlockProps): string => (typeof props.data.deck === 'string' ? props.data.deck : '');

export function mountDeck(container: HTMLElement, props: DeckBlockProps) {
  const root = createRoot(container);
  const draw = (next: DeckBlockProps) => root.render(<DeckPanel key={deckOf(next)} deckId={deckOf(next)} />);
  draw(props);
  return {
    update: draw,
    // React warns when a root unmounts during another root's render, so it waits a task.
    destroy: () => setTimeout(() => root.unmount(), 0),
  };
}
