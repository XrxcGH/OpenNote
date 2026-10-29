// A quiz on a deck (Study tools): a random set of its cards, each asked once. Typed answers are checked leniently, a
// multiple choice card is checked by the option picked, and a wrong check can be counted as right by the person.
// The end says how many were right and which ones to look at again. A quiz never changes the review schedule, and it
// keeps no streak, score history, or badge.
import { useEffect, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { splitBlanks } from '../deck/cloze';
import { MAX_QUIZ, answerIsRight, choiceIsRight, expectedAnswers, pickQuestions, quizSize, score } from '../deck/quiz';
import type { Card, Deck } from '../deck/types';
import { CardFace } from './Review';
import styles from './study.module.css';

interface Asked {
  card: Card;
  right: boolean;
}

function Setup({ deck, initial, onStart }: { deck: Deck; initial: number; onStart(count: number): void }) {
  const most = Math.min(deck.cards.length, MAX_QUIZ);
  const [count, setCount] = useState(String(Math.min(initial, most)));
  if (deck.cards.length === 0) return <p className={styles.muted}>{t('study.quiz.noCards')}</p>;
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onStart(quizSize(deck.cards.length, Number(count)));
      }}
    >
      <label className={styles.field}>
        {t('study.quiz.count')}
        <input type="number" min={1} max={most} value={count} onChange={(event) => setCount(event.target.value)} />
      </label>
      <p className={styles.note}>{t('study.quiz.help', { max: most })}</p>
      <div className={styles.buttons}>
        <Button type="submit" variant="primary">
          {t('study.quiz.start')}
        </Button>
      </div>
    </form>
  );
}

/** The boxes to type into for a card: one for each blank, or one answer box. */
function Answers({ card, values, disabled, onChange }: AnswersProps) {
  const labels =
    card.kind === 'cloze'
      ? splitBlanks(card.front)
          .filter((part) => part.blank)
          .map((_, index) => t('study.quiz.blankAnswer', { number: index + 1 }))
      : [t('study.quiz.yourAnswer')];
  return (
    <>
      {labels.map((label, at) => (
        <label key={label} className={styles.field}>
          {label}
          <input
            type="text"
            value={values[at] ?? ''}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => onChange(values.map((one, index) => (index === at ? event.target.value : one)))}
            data-primary={at === 0 ? '' : undefined}
          />
        </label>
      ))}
    </>
  );
}

interface AnswersProps {
  card: Card;
  values: string[];
  disabled: boolean;
  onChange(values: string[]): void;
}

function Question({ card, onAnswered }: { card: Card; onAnswered(right: boolean): void }) {
  const boxes = card.kind === 'choice' ? 0 : expectedAnswers(card).length;
  const [values, setValues] = useState<string[]>(() => Array.from({ length: boxes }, () => ''));
  const [picked, setPicked] = useState<number | null>(null);
  const [checked, setChecked] = useState<boolean | null>(null);
  const done = card.kind === 'choice' ? picked !== null : checked !== null;
  const right = card.kind === 'choice' ? picked !== null && choiceIsRight(card, picked) : checked === true;
  const [override, setOverride] = useState(false);

  const check = () => {
    const ok = answerIsRight(card, values);
    setChecked(ok);
    announce(t(ok ? 'study.quiz.right' : 'study.quiz.notQuite'));
  };

  return (
    <div className={styles.form}>
      <CardFace
        card={card}
        shown={card.kind === 'choice' ? picked !== null : checked !== null}
        picked={picked}
        onPick={(index) => {
          setPicked(index);
          announce(t(choiceIsRight(card, index) ? 'study.quiz.right' : 'study.quiz.notQuite'));
        }}
      />
      {card.kind === 'choice' ? (
        picked === null ? (
          <p className={styles.note}>{t('study.review.pickOne')}</p>
        ) : null
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (checked === null) check();
          }}
        >
          <Answers card={card} values={values} disabled={checked !== null} onChange={setValues} />
          {checked === null ? (
            <div className={styles.buttons}>
              <Button type="submit" variant="primary">
                {t('study.quiz.check')}
              </Button>
            </div>
          ) : null}
        </form>
      )}
      {done ? (
        <>
          <p role="status">{t(right || override ? 'study.quiz.right' : 'study.quiz.notQuite')}</p>
          {!right && !override && card.kind !== 'choice' ? (
            <>
              <div className={styles.buttons}>
                <Button variant="quiet" onClick={() => setOverride(true)}>
                  {t('study.quiz.countIt')}
                </Button>
              </div>
            </>
          ) : null}
          <div className={styles.buttons}>
            <Button data-primary variant="primary" onClick={() => onAnswered(right || override)}>
              {t('study.quiz.next')}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Result({ asked, onAgain }: { asked: Asked[]; onAgain(): void }) {
  const total = score(asked.map((one) => one.right));
  const missed = asked.filter((one) => !one.right);
  useEffect(() => {
    announce(t('study.quiz.result', { right: total.right, total: total.total }));
  }, [total.right, total.total]);
  return (
    <div className={styles.form}>
      <h3 className={styles.title}>{t('study.quiz.result', { right: total.right, total: total.total })}</h3>
      {missed.length > 0 ? (
        <>
          <p className={styles.note}>{t('study.quiz.missed')}</p>
          <ul className={styles.list}>
            {missed.map((one) => (
              <li key={one.card.id} className={styles.row}>
                {one.card.front.slice(0, 120)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.note}>{t('study.quiz.allRight')}</p>
      )}
      <div className={styles.buttons}>
        <Button variant="primary" onClick={onAgain}>
          {t('study.quiz.again')}
        </Button>
      </div>
    </div>
  );
}

export function Quiz({ deck, count = 10 }: { deck: Deck; count?: number }) {
  const [questions, setQuestions] = useState<Card[] | null>(null);
  const [results, setResults] = useState<Asked[]>([]);

  if (questions === null) {
    return (
      <Setup
        deck={deck}
        initial={count}
        onStart={(size) => {
          setQuestions(pickQuestions(deck.cards, size));
          setResults([]);
        }}
      />
    );
  }
  const card = questions[results.length];
  if (!card) return <Result asked={results} onAgain={() => setQuestions(null)} />;
  return (
    <div className={styles.form}>
      <p className={styles.note} role="status">
        {t('study.quiz.progress', { number: results.length + 1, total: questions.length })}
      </p>
      <Question
        key={card.id}
        card={card}
        onAnswered={(right) => setResults((current) => [...current, { card, right }])}
      />
    </div>
  );
}
