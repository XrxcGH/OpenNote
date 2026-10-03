// Reviewing a deck (Study tools): one card at a time, the answer on request, then how it went in plain words. There
// is no score, streak, or badge: the panel says how many cards are left and, at the end, when the next one is due.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { splitBlanks } from '../deck/cloze';
import { dayKey } from '../deck/dates';
import { recordReview, statesOf } from '../deck/library';
import { todaysQueue } from '../deck/schedule';
import type { Card, Deck, Grade } from '../deck/types';
import styles from './study.module.css';

interface FaceProps {
  card: Card;
  /** The answer is showing. */
  shown: boolean;
  picked: number | null;
  onPick(index: number): void;
}

function Pictures({ list }: { list: readonly string[] | undefined }) {
  return list && list.length > 0 ? (
    <div>
      {list.map((src, index) => (
        <img key={index} src={src} alt="" className={styles.inlineImage} />
      ))}
    </div>
  ) : null;
}

/** What a card looks like, with its answer hidden or shown. */
export function CardFace(props: FaceProps) {
  const { card, shown, picked } = props;
  return (
    <>
      <Face {...props} />
      {shown && picked === null && card.images?.back.length ? <Pictures list={card.images.back} /> : null}
    </>
  );
}

function Face({ card, shown, picked, onPick }: FaceProps) {
  if (card.kind === 'cloze') {
    return (
      <div className={styles.face}>
        <div>
          {splitBlanks(card.front).map((part, index) =>
            part.blank ? (
              <span key={index} className={styles.blank} aria-label={shown ? undefined : t('study.review.blank')}>
                {shown ? part.text : '[...]'}
              </span>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </div>
        {shown && card.back ? <div className={styles.answer}>{card.back}</div> : null}
      </div>
    );
  }
  if (card.kind === 'choice') {
    return (
      <div className={styles.face}>
        <div>{card.front}</div>
        <ul className={styles.choices}>
          {(card.choices ?? []).map((choice, index) => {
            const state =
              picked === null ? undefined : index === card.answer ? 'right' : index === picked ? 'wrong' : undefined;
            return (
              <li key={index}>
                <Button
                  className={styles.choice}
                  data-state={state}
                  disabled={picked !== null}
                  aria-pressed={picked === index}
                  onClick={() => onPick(index)}
                >
                  {choice}
                </Button>
              </li>
            );
          })}
        </ul>
        {picked !== null && card.back ? <div className={styles.answer}>{card.back}</div> : null}
      </div>
    );
  }
  if (card.kind === 'occlusion' && card.image) {
    return (
      <div className={styles.face}>
        <div>{card.front}</div>
        <div className={styles.picture}>
          <img src={card.image.src} alt={card.image.alt} />
          {card.image.boxes.map((box, index) => (
            <span
              key={index}
              className={styles.box}
              data-open={shown ? '' : undefined}
              style={{
                insetInlineStart: `${box.x}%`,
                insetBlockStart: `${box.y}%`,
                inlineSize: `${box.w}%`,
                blockSize: `${box.h}%`,
              }}
            />
          ))}
        </div>
        {shown && card.back ? <div className={styles.answer}>{card.back}</div> : null}
      </div>
    );
  }
  return (
    <div className={styles.face}>
      <div>{card.front}</div>
      <Pictures list={card.images?.front} />
      {shown ? <div className={styles.answer}>{card.back}</div> : null}
    </div>
  );
}

function nextDue(deck: Deck, today: string): string | null {
  const states = statesOf(deck.id);
  const days = deck.cards
    .map((card) => states[card.id]?.due)
    .filter((day): day is string => Boolean(day) && day! > today);
  return days.length > 0 ? days.sort()[0] : null;
}

const GRADES: readonly Grade[] = ['again', 'hard', 'good', 'easy'];

export function Review({ deck }: { deck: Deck }) {
  const [queue, setQueue] = useState<Card[]>(() => todaysQueue(deck, statesOf(deck.id), dayKey()));
  const [shown, setShown] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const card = queue[0];
  const revealed = card?.kind === 'choice' ? picked !== null : shown;

  useEffect(() => area.current?.querySelector<HTMLElement>('[data-primary]')?.focus(), [card?.id, revealed]);

  if (!card) {
    const next = nextDue(deck, dayKey());
    return (
      <div className={styles.form}>
        <p role="status">{deck.cards.length === 0 ? t('study.review.emptyDeck') : t('study.review.done')}</p>
        {next ? (
          <p className={styles.note}>
            {t('study.review.nextDue', {
              date: new Date(`${next}T00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' }),
            })}
          </p>
        ) : null}
      </div>
    );
  }

  const grade = (result: Grade) => {
    recordReview(deck.id, card.id, result);
    setQueue((current) => (result === 'again' ? [...current.slice(1), current[0]] : current.slice(1)));
    setShown(false);
    setPicked(null);
  };
  const pick = (index: number) => {
    setPicked(index);
    announce(t(index === card.answer ? 'study.review.right' : 'study.review.wrong'));
  };
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select') || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = Number(event.key) - 1;
    if (revealed && card.kind !== 'choice' && index >= 0 && index < GRADES.length) grade(GRADES[index]);
  };

  return (
    <div ref={area} className={styles.form} onKeyDown={onKey}>
      <p className={styles.note} role="status">
        {t('study.review.left', { count: queue.length })}
      </p>
      <CardFace card={card} shown={revealed} picked={picked} onPick={pick} />
      {card.kind === 'choice' ? (
        picked !== null ? (
          <Button data-primary variant="primary" onClick={() => grade(picked === card.answer ? 'good' : 'again')}>
            {t('study.review.next')}
          </Button>
        ) : (
          <p className={styles.note}>{t('study.review.pickOne')}</p>
        )
      ) : shown ? (
        <>
          <div className={styles.buttons} role="group" aria-label={t('study.review.gradeHelp')}>
            {GRADES.map((one) => (
              <Button
                key={one}
                variant={one === 'good' ? 'primary' : 'secondary'}
                onClick={() => grade(one)}
                {...(one === 'good' ? { 'data-primary': true } : {})}
              >
                {t(`study.review.${one}`)}
              </Button>
            ))}
          </div>
          <p className={styles.note}>{t('study.review.gradeHelp')}</p>
        </>
      ) : (
        <Button data-primary variant="primary" onClick={() => setShown(true)}>
          {t('study.review.show')}
        </Button>
      )}
    </div>
  );
}
