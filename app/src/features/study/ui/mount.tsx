// How the page draws a flashcard block: a React root in the block's wrapper that shows the deck the block names.
import { createRoot } from 'react-dom/client';
import { decksStore } from '../deck/library';
import { useStore } from '../../../state/store';
import { DeckPanel } from './DeckPanel';
import { Quiz } from './Quiz';
import { TapePanel } from './TapePanel';

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

export interface TapeBlockProps {
  data: Record<string, unknown>;
  readOnly: boolean;
  patch(data: Record<string, unknown>): void;
}

export function mountTape(container: HTMLElement, props: TapeBlockProps) {
  const root = createRoot(container);
  const draw = (next: TapeBlockProps) =>
    root.render(
      <TapePanel
        hidden={next.data.hidden !== false}
        readOnly={next.readOnly}
        onToggle={(hidden) => next.patch({ hidden })}
      />,
    );
  draw(props);
  return { update: draw, destroy: () => setTimeout(() => root.unmount(), 0) };
}

export interface QuizBlockProps {
  data: Record<string, unknown>;
}

function QuizBlock({ deck, count }: { deck: string; count: number }) {
  const decks = useStore(decksStore, (current) => current);
  const found = decks.find((one) => one.id === deck);
  return found ? <Quiz key={found.id} deck={found} count={count} /> : null;
}

export function mountQuiz(container: HTMLElement, props: QuizBlockProps) {
  const root = createRoot(container);
  const draw = (next: QuizBlockProps) =>
    root.render(
      <QuizBlock
        deck={typeof next.data.deck === 'string' ? next.data.deck : ''}
        count={typeof next.data.count === 'number' ? next.data.count : 10}
      />,
    );
  draw(props);
  return { update: draw, destroy: () => setTimeout(() => root.unmount(), 0) };
}
