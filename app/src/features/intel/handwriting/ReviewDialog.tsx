// The review of recognized handwriting: the words as text, with the words the recognizer was unsure of underlined.
// Choosing an unsure word shows its other readings, and picking one replaces it. Nothing is added to the page until
// the person chooses Insert.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { Dialog, openMenu } from '../../../ui';
import { openModal } from '../modal';
import styles from '../plus.module.css';
import { chooseReading, reviewText, unsureCount } from './extras';
import type { ReviewLine } from './extras';

function Review(props: { initial: readonly ReviewLine[]; onDone(lines: string[] | null): void }) {
  const [lines, setLines] = useState<readonly ReviewLine[]>(props.initial);
  const left = unsureCount(lines);
  const pick = async (anchor: HTMLElement, line: number, word: number) => {
    const target = lines[line]?.[word];
    if (!target) return;
    const choice = await openMenu({
      label: t('intelPlus.handwriting.alternatives'),
      anchor,
      items: [target.text, ...target.alternatives].map((text, index) => ({
        id: String(index),
        label: text,
        kind: 'radio' as const,
        checked: index === 0,
      })),
    });
    if (choice === null) return;
    const text = [target.text, ...target.alternatives][Number(choice)];
    if (text !== undefined) setLines((current) => chooseReading(current, { line, word }, text));
  };
  return (
    <Dialog
      title={t('intelPlus.handwriting.reviewTitle')}
      description={t('intelPlus.handwriting.reviewBody', { count: left })}
      size="medium"
      initialFocus="first"
      onDismiss={() => props.onDone(null)}
      actions={[
        {
          id: 'cancel',
          label: t('intelPlus.handwriting.cancel'),
          variant: 'secondary',
          onPress: () => props.onDone(null),
        },
        {
          id: 'insert',
          label: t('intelPlus.handwriting.insert'),
          variant: 'primary',
          onPress: () => props.onDone(reviewText(lines)),
        },
      ]}
    >
      <div className={styles.stack}>
        {lines.map((line, lineIndex) => (
          <p key={lineIndex} className={styles.line}>
            {line.map((word, wordIndex) => (
              <span key={wordIndex}>
                {wordIndex > 0 && ' '}
                {word.unsure && word.alternatives.length > 0 ? (
                  <button
                    type="button"
                    className={styles.unsure}
                    aria-haspopup="menu"
                    aria-label={t('intelPlus.handwriting.unsureWord', { word: word.text })}
                    onClick={(event) => void pick(event.currentTarget, lineIndex, wordIndex)}
                  >
                    {word.text}
                  </button>
                ) : (
                  word.text
                )}
              </span>
            ))}
          </p>
        ))}
        <p className={styles.help}>{t('intelPlus.handwriting.reviewHelp')}</p>
      </div>
    </Dialog>
  );
}

/** Shows the review. Resolves with the tidied lines when the person inserts them, and null when they cancel. */
export function reviewRecognizedLines(lines: readonly ReviewLine[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    openModal((close) => (
      <Review
        initial={lines}
        onDone={(result) => {
          resolve(result);
          close();
        }}
      />
    ));
  });
}
