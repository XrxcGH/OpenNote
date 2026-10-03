// The review step for generated cards: every candidate is listed with a check box, and only the kept ones are added.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { newId, putDeck, createDeck, decksStore, deckById } from '../deck/library';
import { cardRequest } from '../deck/request';
import type { CardRequest } from '../deck/request';
import { useStore } from '../../../state/store';
import styles from './study.module.css';

const NEW = '*new';

export function GenerateView({ request, onDone }: { request: CardRequest; onDone(deckId: string | null): void }) {
  const [kept, setKept] = useState<boolean[]>(() => request.candidates.map(() => true));
  const [target, setTarget] = useState(NEW);
  const decks = useStore(decksStore, (current) => current);
  const count = kept.filter(Boolean).length;

  const add = () => {
    const cards = request.candidates
      .filter((_one, index) => kept[index])
      .map((one) => ({ id: newId('c'), origin: 'generated', ...one.card }));
    const existing = target === NEW ? undefined : deckById(target);
    const deck = existing ?? createDeck(request.source || t('study.deck.untitled', { number: decks.length + 1 }));
    putDeck({ ...deck, cards: [...deck.cards, ...cards] });
    cardRequest.set(null);
    announce(t('study.generate.added', { count: cards.length, name: deck.name }));
    onDone(deck.id);
  };

  return (
    <div className={styles.form}>
      <div className={styles.bar}>
        <h3 className={styles.title}>{t('study.generate.title', { source: request.source })}</h3>
        <Button
          variant="quiet"
          onClick={() => {
            cardRequest.set(null);
            onDone(null);
          }}
        >
          {t('study.edit.cancel')}
        </Button>
      </div>
      {request.candidates.length === 0 ? <p className={styles.muted}>{t('study.generate.none')}</p> : null}
      <ul className={styles.list}>
        {request.candidates.map((one, index) => (
          <li key={index} className={`${styles.row} ${styles.check}`}>
            <input
              type="checkbox"
              checked={kept[index]}
              aria-label={t('study.generate.keep', { question: one.card.front })}
              onChange={(event) => setKept(kept.map((value, at) => (at === index ? event.target.checked : value)))}
            />
            <div className={styles.grow}>
              <div>{one.card.front}</div>
              {one.card.back ? <div className={styles.muted}>{one.card.back}</div> : null}
              <div className={styles.tag}>{t(`study.generate.reasons.${one.reason}`)}</div>
            </div>
          </li>
        ))}
      </ul>
      {request.candidates.length > 0 ? (
        <>
          <label className={styles.field}>
            {t('study.generate.toDeck')}
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value={NEW}>{t('study.generate.newDeckNamed', { name: request.source })}</option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" disabled={count === 0} onClick={add}>
            {t('study.generate.add', { count })}
          </Button>
        </>
      ) : null}
    </div>
  );
}
