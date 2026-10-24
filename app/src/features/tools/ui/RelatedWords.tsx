// The related words of the full dictionary's thesaurus: a short list at first, and all of them on request.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import styles from './tools.module.css';

const FIRST = 24;

export function RelatedWords(props: {
  words: readonly string[];
  onInsert: (word: string) => void;
  onLookUp: (word: string) => void;
}) {
  const { words, onInsert, onLookUp } = props;
  const [all, setAll] = useState(false);
  const shown = all ? words : words.slice(0, FIRST);
  return (
    <div className={styles.group}>
      <h4 className={styles.groupTitle}>{t('study.dictionary.related')}</h4>
      <ul className={styles.items}>
        {shown.map((word) => (
          <li key={word} className={styles.item}>
            <span className={styles.itemTitle}>{word}</span>
            <Button
              variant="quiet"
              aria-label={t('study.dictionary.insertNamed', { word })}
              onClick={() => onInsert(word)}
            >
              {t('study.dictionary.insert')}
            </Button>
            <Button
              variant="quiet"
              aria-label={t('study.dictionary.lookUpNamed', { word })}
              onClick={() => onLookUp(word)}
            >
              {t('study.dictionary.lookUp')}
            </Button>
          </li>
        ))}
      </ul>
      {words.length > FIRST ? (
        <Button variant="quiet" onClick={() => setAll((current) => !current)}>
          {all ? t('study.dictionary.relatedLess') : t('study.dictionary.relatedMore', { count: words.length })}
        </Button>
      ) : null}
    </div>
  );
}
