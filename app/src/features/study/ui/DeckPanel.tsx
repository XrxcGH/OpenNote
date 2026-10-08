// The Flashcards panel (Study tools): the deck list, one deck with its exam date and counts, review, card editing,
// import, and the review step for generated cards. The tool window shows it with the whole list; the flashcard
// block on a page shows it for one deck.
import { useState } from 'react';
import { useFlag } from '../../../app/flags';
import { t } from '../../../strings/t';
import { Button, announce, confirm } from '../../../ui';
import { useStore } from '../../../state/store';
import { dayKey, daysBetween, isDayKey } from '../deck/dates';
import { exportDeck } from '../io/save';
import {
  changeDeck,
  createDeck,
  decksStore,
  deleteCard,
  removeDeck,
  saveCard,
  statesOf,
  statesStore,
} from '../deck/library';
import { cardRequest } from '../deck/request';
import { counts, dailyTarget } from '../deck/schedule';
import type { Card, Deck } from '../deck/types';
import { CardEditor } from './CardEditor';
import { GenerateView } from './GenerateView';
import { ImportView } from './ImportView';
import { Quiz } from './Quiz';
import { Review } from './Review';
import styles from './study.module.css';

type View = 'deck' | 'review' | 'edit' | 'import' | 'generate' | 'quiz';

const summary = (card: Card): string =>
  (card.kind === 'occlusion' ? card.front || card.image?.alt || '' : card.front).slice(0, 120);

function ExamLine({ deck }: { deck: Deck }) {
  useStore(statesStore, (current) => current[deck.id]);
  const today = dayKey();
  const target = dailyTarget(deck, statesOf(deck.id), today);
  return (
    <div className={styles.form}>
      <label className={styles.field}>
        {t('study.exam.date')}
        <input
          type="date"
          value={deck.exam ?? ''}
          onChange={(event) =>
            changeDeck(deck.id, (current) => {
              const { exam: _old, ...rest } = current;
              return isDayKey(event.target.value) ? { ...rest, exam: event.target.value } : rest;
            })
          }
        />
      </label>
      {deck.exam && deck.exam < today ? <p className={styles.note}>{t('study.exam.past')}</p> : null}
      {deck.exam && deck.exam === today ? <p className={styles.note}>{t('study.exam.today')}</p> : null}
      {deck.exam && deck.exam > today ? (
        <p className={styles.note}>{t('study.exam.daysLeft', { count: daysBetween(today, deck.exam) })}</p>
      ) : null}
      {target ? (
        <p className={styles.note}>{t('study.exam.target', { perDay: target.perDay, daysLeft: target.daysLeft })}</p>
      ) : null}
    </div>
  );
}

function CardsView({ deck }: { deck: Deck }) {
  const [editing, setEditing] = useState<Card | 'new' | null>(null);
  if (editing) {
    return (
      <CardEditor
        card={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSave={(card) => {
          saveCard(deck.id, card);
          setEditing(null);
          announce(t('study.edit.saved'));
        }}
      />
    );
  }
  return (
    <div className={styles.form}>
      <div className={styles.bar}>
        <h3 className={styles.title}>{t('study.edit.cards')}</h3>
        <Button variant="primary" onClick={() => setEditing('new')}>
          {t('study.edit.add')}
        </Button>
      </div>
      {deck.cards.length === 0 ? <p className={styles.muted}>{t('study.edit.empty')}</p> : null}
      <ul className={styles.list}>
        {deck.cards.map((card) => (
          <li key={card.id} className={styles.row}>
            <button
              type="button"
              className={`${styles.grow} ${styles.link}`}
              onClick={() => setEditing(card)}
              aria-label={t('study.edit.cardLabel', { kind: t(`study.edit.kinds.${card.kind}`), text: summary(card) })}
            >
              {summary(card)}
            </button>
            <Button
              variant="quiet"
              aria-label={t('study.edit.remove')}
              onClick={() => {
                deleteCard(deck.id, card.id);
                announce(t('study.edit.removed'));
              }}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeckView({
  deck,
  view,
  setView,
  onBack,
}: {
  deck: Deck;
  view: View;
  setView(view: View): void;
  onBack: (() => void) | null;
}) {
  useStore(statesStore, (current) => current[deck.id]);
  const shown = counts(deck, statesOf(deck.id), dayKey());
  const [name, setName] = useState<string | null>(null);
  const canExport = useFlag('study.import');
  const remove = async () => {
    const yes = await confirm({
      title: t('study.deck.deleteTitle'),
      body: t('study.deck.deleteBody'),
      confirmLabel: t('study.deck.delete'),
      danger: true,
    });
    if (!yes) return;
    removeDeck(deck.id);
    announce(t('study.deck.deleted'));
    onBack?.();
  };
  return (
    <div className={styles.form}>
      <div className={styles.bar}>
        {onBack ? (
          <Button variant="quiet" onClick={onBack}>
            {t('study.deck.back')}
          </Button>
        ) : null}
        {name === null ? (
          <h3 className={styles.title}>{deck.name}</h3>
        ) : (
          <label className={`${styles.field} ${styles.grow}`}>
            {t('study.deck.deckName')}
            <input
              type="text"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim()) {
                  changeDeck(deck.id, (current) => ({ ...current, name: name.trim() }));
                  setName(null);
                } else if (event.key === 'Escape') setName(null);
              }}
            />
          </label>
        )}
      </div>
      <p className={styles.note}>
        {t('study.deck.cardCount', { count: deck.cards.length })}. {t('study.deck.counts', shown)}
      </p>
      <div className={styles.buttons}>
        <Button variant="primary" onClick={() => setView('review')} disabled={deck.cards.length === 0}>
          {t('study.deck.review')}
        </Button>
        <Button onClick={() => setView('quiz')} disabled={deck.cards.length === 0}>
          {t('study.quiz.open')}
        </Button>
        <Button onClick={() => setView('edit')}>{t('study.deck.edit')}</Button>
        <Button variant="quiet" onClick={() => setName(deck.name)}>
          {t('study.deck.rename')}
        </Button>
        {canExport ? (
          <>
            <Button variant="quiet" onClick={() => void exportDeck(deck, 'csv')}>
              {t('study.io.exportCsv')}
            </Button>
            <Button variant="quiet" onClick={() => void exportDeck(deck, 'apkg')}>
              {t('study.io.exportAnki')}
            </Button>
          </>
        ) : null}
        <Button variant="danger" onClick={() => void remove()}>
          {t('study.deck.delete')}
        </Button>
      </div>
      {deck.id.startsWith('page:') ? <p className={styles.note}>{t('study.deck.pageDeck')}</p> : null}
      <ExamLine deck={deck} />
      {view === 'review' ? <Review key="review" deck={deck} /> : null}
      {view === 'quiz' ? <Quiz key="quiz" deck={deck} /> : null}
      {view === 'edit' ? <CardsView deck={deck} /> : null}
    </div>
  );
}

function DeckList({ onOpen, onImport }: { onOpen(id: string): void; onImport(): void }) {
  const decks = useStore(decksStore, (current) => current);
  useStore(statesStore, (current) => current);
  const [name, setName] = useState('');
  const canImport = useFlag('study.import');
  const today = dayKey();
  const create = () => {
    const deck = createDeck(name.trim() || t('study.deck.untitled', { number: decks.length + 1 }));
    setName('');
    onOpen(deck.id);
  };
  return (
    <div className={styles.form}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label className={styles.field}>
          {t('study.deck.deckName')}
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className={styles.buttons}>
          <Button type="submit" variant="primary">
            {t('study.deck.create')}
          </Button>
          {canImport ? (
            <Button variant="quiet" onClick={onImport}>
              {t('study.io.import')}
            </Button>
          ) : null}
        </div>
      </form>
      {decks.length === 0 ? <p className={styles.muted}>{t('study.deck.none')}</p> : null}
      <ul className={styles.list}>
        {decks.map((deck) => {
          const shown = counts(deck, statesOf(deck.id), today);
          return (
            <li key={deck.id} className={styles.row}>
              <button type="button" className={`${styles.grow} ${styles.link}`} onClick={() => onOpen(deck.id)}>
                {deck.name}
              </button>
              <span className={styles.muted}>
                {t('study.deck.cardCount', { count: deck.cards.length })}. {t('study.deck.counts', shown)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface PanelProps {
  /** Shows only this deck, with no list and no way back to one. */
  deckId?: string;
}

export function DeckPanel({ deckId }: PanelProps) {
  const [open, setOpen] = useState<string | null>(deckId ?? null);
  const [view, setView] = useState<View>('deck');
  const decks = useStore(decksStore, (current) => current);
  const request = useStore(cardRequest, (current) => current);
  const canImport = useFlag('study.import');
  const deck = decks.find((one) => one.id === open) ?? null;
  const back = deckId
    ? null
    : () => {
        setOpen(null);
        setView('deck');
      };
  if (request && !deckId) {
    return (
      <div className={styles.root}>
        <GenerateView
          request={request}
          onDone={(id) => {
            setOpen(id);
            setView('deck');
          }}
        />
      </div>
    );
  }
  if (view === 'import' && !deckId && canImport) {
    return (
      <div className={styles.root}>
        <ImportView
          onDone={(id) => {
            setOpen(id);
            setView('deck');
          }}
        />
      </div>
    );
  }
  return (
    <div className={styles.root}>
      {deck ? (
        <DeckView deck={deck} view={view} setView={setView} onBack={back} />
      ) : deckId ? (
        <p className={styles.muted}>{t('study.deck.none')}</p>
      ) : (
        <DeckList
          onOpen={(id) => {
            setOpen(id);
            setView('deck');
          }}
          onImport={() => setView('import')}
        />
      )}
    </div>
  );
}
