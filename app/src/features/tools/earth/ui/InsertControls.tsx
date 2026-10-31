// Insert for an earth kit result: the answer line goes in with one press, and a menu offers the equation, the
// result table, the answer with its worked steps, and each picture as an SVG image. What happened is announced,
// and a miss (no caret in a page) also shows as a note under the buttons so a sighted user sees why nothing changed.
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, announce, openMenu } from '../../../../ui';
import type { MenuItemSpec } from '../../../../ui';
import { insertIntoPage } from '../../ui/insert';
import { figureSvg } from '../core/figure';
import type { Outcome } from './form';
import styles from './earth.module.css';

/** The answer with its steps as plain lines, for the page or for a test. */
export function stepsText(outcome: Outcome): string {
  const rows = (outcome.rows ?? []).map(([label, value]) => `${label}: ${value}`);
  const steps = (outcome.steps ?? []).map((step, i) => `${i + 1}. ${step}`);
  const source = outcome.source ? [t('kitEarth.source', { source: outcome.source })] : [];
  return [outcome.answer, ...rows, ...steps, ...source].join('\n');
}

/** The table Insert table writes: the result table, or the rows of quantities and values. */
export function tableOf(outcome: Outcome): { header: string[]; rows: string[][] } | null {
  if (outcome.table) return outcome.table;
  if (!outcome.rows?.length) return null;
  return { header: [t('kitEarth.quantity'), t('kitEarth.value')], rows: outcome.rows.map(([a, b]) => [a, b]) };
}

type Say = (handled: boolean) => void;

function menuItems(outcome: Outcome, say: Say): MenuItemSpec[] {
  const items: MenuItemSpec[] = [];
  if (outcome.latex) {
    const source = outcome.latex;
    items.push({
      id: 'equation',
      label: t('kitEarth.insertEquation'),
      onSelect: () => say(insertIntoPage({ math: { source, display: true } })),
    });
  }
  const table = tableOf(outcome);
  if (table)
    items.push({ id: 'table', label: t('kitEarth.insertTable'), onSelect: () => say(insertIntoPage({ table })) });
  items.push({
    id: 'steps',
    label: t('kitEarth.insertSteps'),
    onSelect: () => say(insertIntoPage({ text: stepsText(outcome) })),
  });
  (outcome.figures ?? []).forEach((figure, i) => {
    const bytes = new TextEncoder().encode(figureSvg(figure)).buffer as ArrayBuffer;
    items.push({
      id: `picture-${i}`,
      label: t('kitEarth.insertPicture', { name: figure.title }),
      onSelect: () =>
        say(
          insertIntoPage({
            picture: { bytes, name: `${figure.title}.svg`, alt: figure.description, mime: 'image/svg+xml' },
          }),
        ),
    });
  });
  return items;
}

export function InsertControls({ outcome }: { outcome: Outcome | null }) {
  // The note belongs to the result it was pressed for, so a new result hides it without an effect.
  const [missedFor, setMissedFor] = useState<Outcome | null>(null);
  const missed = outcome !== null && missedFor === outcome;
  const say: Say = (handled) => {
    setMissedFor(handled ? null : outcome);
    announce(t(handled ? 'kitEarth.inserted' : 'kitEarth.noPage'));
  };
  return (
    <>
      <div className={styles.buttons}>
        <Button
          variant="primary"
          disabled={!outcome}
          onClick={() => outcome && say(insertIntoPage({ text: outcome.answer }))}
        >
          {t('kitEarth.insertAnswer')}
        </Button>
        <Button
          variant="quiet"
          disabled={!outcome}
          aria-haspopup="menu"
          onClick={(event) => {
            const anchor = event.currentTarget;
            if (outcome) void openMenu({ label: t('kitEarth.insertMenu'), items: menuItems(outcome, say), anchor });
          }}
        >
          {t('kitEarth.insertMore')}
        </Button>
      </div>
      {missed ? <p className={styles.note}>{t('kitEarth.noPage')}</p> : null}
    </>
  );
}
