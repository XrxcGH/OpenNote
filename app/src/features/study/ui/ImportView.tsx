// Importing cards from a file or pasted text (Study tools). The cards are read first and shown as counts: how many
// are new, how many repeat a card that is already in a deck, and which lines were skipped. Only then is a deck made.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { useStore } from '../../../state/store';
import { cardsFromText, parseCards, planImport } from '../deck/exchange';
import type { ImportPlan, Skipped } from '../deck/exchange';
import { createDeck, decksStore } from '../deck/library';
import type { Card } from '../deck/types';
import styles from './study.module.css';

interface Read {
  plan: ImportPlan;
  skipped: Skipped[];
  media: number;
  name: string;
}

export function ImportView({ onDone }: { onDone(deckId: string | null): void }) {
  const decks = useStore(decksStore, (current) => current);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [read, setRead] = useState<Read | null>(null);
  const [withRepeats, setWithRepeats] = useState(false);
  const [problem, setProblem] = useState('');
  const everyCard = decks.flatMap((deck) => deck.cards);

  const show = (cards: Card[], skipped: Skipped[], media: number, deckName: string) => {
    setProblem('');
    setName(deckName);
    setRead({ plan: planImport(cards, everyCard), skipped, media, name: deckName });
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    const base = file.name.replace(/\.[^.]+$/, '');
    try {
      if (/\.(apkg|colpkg)$/i.test(file.name)) {
        const { readAnkiPackage } = await import('../io/anki');
        const result = await readAnkiPackage(new Uint8Array(await file.arrayBuffer()));
        return show(result.cards, result.skipped, result.media, result.name || base);
      }
      const parsed = parseCards(await file.text(), file.name);
      show(parsed.cards, parsed.skipped, 0, base);
    } catch (error) {
      setRead(null);
      setProblem(
        error instanceof Error && error.message === 'newer' ? t('study.io.unsupported') : t('study.io.failed'),
      );
    }
  };

  const add = () => {
    if (!read) return;
    const cards = [...read.plan.fresh, ...(withRepeats ? read.plan.duplicates : [])];
    const deck = createDeck(name.trim() || read.name, cards);
    announce(t('study.io.imported', { count: cards.length, name: deck.name }));
    onDone(deck.id);
  };

  return (
    <div className={styles.form}>
      <div className={styles.bar}>
        <h3 className={styles.title}>{t('study.io.import')}</h3>
        <Button variant="quiet" onClick={() => onDone(null)}>
          {t('study.edit.cancel')}
        </Button>
      </div>
      <label className={styles.field}>
        {t('study.io.file')}
        <input
          type="file"
          accept=".csv,.tsv,.txt,.apkg,.colpkg"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
      </label>
      <label className={styles.field}>
        {t('study.io.paste')}
        <textarea value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <div className={styles.buttons}>
        <Button
          disabled={text.trim() === ''}
          onClick={() => {
            const parsed = cardsFromText(text);
            show(parsed.cards, parsed.skipped, 0, name || t('study.deck.untitled', { number: decks.length + 1 }));
          }}
        >
          {t('study.io.read')}
        </Button>
      </div>
      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
      {read ? (
        <div className={styles.form} role="status">
          <p>{t('study.io.summary', { count: read.plan.fresh.length })}</p>
          {read.plan.duplicates.length > 0 ? (
            <>
              <p className={styles.note}>{t('study.io.duplicates', { count: read.plan.duplicates.length })}</p>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={withRepeats}
                  onChange={(event) => setWithRepeats(event.target.checked)}
                />
                {t('study.io.addDuplicates')}
              </label>
            </>
          ) : null}
          {read.media > 0 ? <p className={styles.note}>{t('study.io.media', { count: read.media })}</p> : null}
          {read.skipped.length > 0 ? (
            <>
              <p className={styles.note}>{t('study.io.skipped', { count: read.skipped.length })}</p>
              <ul className={styles.list}>
                {read.skipped.slice(0, 20).map((one) => (
                  <li key={one.line} className={styles.muted}>
                    {t('study.io.skippedLine', { line: one.line, reason: t(`study.io.reasons.${one.reason}`) })}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <label className={styles.field}>
            {t('study.io.deckNamed')}
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <Button
            variant="primary"
            disabled={read.plan.fresh.length + (withRepeats ? read.plan.duplicates.length : 0) === 0}
            onClick={add}
          >
            {t('study.io.addDeck')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
