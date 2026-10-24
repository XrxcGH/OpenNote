// A physics tool's answer: the main results in a status region a screen reader hears, a table of every result in
// the window's unit system, the governing equation, the worked steps, the figure, the assumptions, and the Insert
// buttons. A problem with the inputs shows instead, saying which field to fix.
import { useEffect, useState } from 'react';
import 'katex/dist/katex.min.css';
import { t } from '../../../../strings/t';
import { Button, announce } from '../../../../ui';
import { say, sayKey, sayText, showRow, rowText } from '../kit/say';
import type { ShownRow } from '../kit/say';
import { TOKEN_PALETTE, plotToSvg } from '../kit/svg';
import type { KitInsert, Outcome, UnitSystem } from '../kit/types';
import { currentPalette } from './insert';
import chem from '../../ui/chem.module.css';
import tools from '../../ui/tools.module.css';
import styles from './physics.module.css';

type Render = (latex: string, options?: { displayMode?: boolean }) => { ok: true; html: string } | { ok: false };

function Equation({ latex }: { latex: string }) {
  const [render, setRender] = useState<Render | null>(null);
  useEffect(() => {
    let live = true;
    void import('../../../math').then((math) => live && setRender(() => math.renderLatex as Render));
    return () => {
      live = false;
    };
  }, []);
  const drawn = render?.(latex, { displayMode: true });
  if (!drawn?.ok) return null;
  return <div className={styles.equation} dangerouslySetInnerHTML={{ __html: drawn.html }} />;
}

function ResultTable({ rows }: { rows: readonly ShownRow[] }) {
  return (
    <table className={styles.table}>
      <caption className={tools.note}>{t('kitPhysics.ui.results')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('kitPhysics.ui.quantity')}</th>
          <th scope="col">{t('kitPhysics.ui.value')}</th>
          <th scope="col">{t('kitPhysics.ui.unit')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <th scope="row">{row.symbol ? `${row.name} ${row.symbol}` : row.name}</th>
            <td className={styles.number}>{row.value}</td>
            <td>{row.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InsertButtons(props: {
  outcome: Extract<Outcome, { ok: true }>;
  shown: readonly ShownRow[];
  steps: readonly string[];
  insert: KitInsert;
}) {
  const { outcome, shown, steps, insert } = props;
  const done = (ok: boolean) => announce(t(ok ? 'kitPhysics.ui.inserted' : 'kitPhysics.ui.noPage'));
  const primary = outcome.rows.flatMap((row, i) => (row.primary ? [shown[i]] : []));
  const answer = (primary.length ? primary : shown.slice(0, 1)).map(rowText).join('; ');
  const plot = outcome.plot;
  return (
    <div className={styles.insert} role="group" aria-label={t('kitPhysics.ui.insertGroup')}>
      <span className={styles.insertLabel} aria-hidden="true">
        {t('kitPhysics.ui.insertGroup')}
      </span>
      <Button variant="quiet" onClick={() => done(insert.answer(answer))}>
        {t('kitPhysics.ui.insertAnswer')}
      </Button>
      {outcome.latex ? (
        <Button variant="quiet" onClick={() => done(insert.equation(outcome.latex!, true))}>
          {t('kitPhysics.ui.insertEquation')}
        </Button>
      ) : null}
      <Button
        variant="quiet"
        onClick={() =>
          done(
            insert.table(
              [t('kitPhysics.ui.quantity'), t('kitPhysics.ui.value'), t('kitPhysics.ui.unit')],
              shown.map((row) => [row.symbol ? `${row.name} ${row.symbol}` : row.name, row.value, row.unit]),
            ),
          )
        }
      >
        {t('kitPhysics.ui.insertTable')}
      </Button>
      <Button variant="quiet" onClick={() => done(insert.steps(steps))}>
        {t('kitPhysics.ui.insertSteps')}
      </Button>
      {plot ? (
        <Button
          variant="quiet"
          onClick={() =>
            void Promise.resolve(
              insert.picture(plotToSvg(plot, currentPalette(), say(plot.alt), sayText), say(plot.alt)),
            ).then(done)
          }
        >
          {t('kitPhysics.ui.insertPicture')}
        </Button>
      ) : null}
    </div>
  );
}

export function OutcomeView({ outcome, system, insert }: { outcome: Outcome; system: UnitSystem; insert: KitInsert }) {
  if (!outcome.ok)
    return (
      <p className={tools.problem} role="status">
        {say(outcome.problem)}
      </p>
    );
  const shown = outcome.rows.map((row) => showRow(row, system));
  const primary = outcome.rows.flatMap((row, i) => (row.primary ? [shown[i]] : []));
  const steps = outcome.steps.map(say);
  const alt = outcome.plot ? say(outcome.plot.alt) : '';
  return (
    <div className={chem.result}>
      <div role="status" aria-live="polite">
        {(primary.length ? primary : shown.slice(0, 1)).map((row, i) => (
          <p key={i} className={chem.headline}>
            {rowText(row)}
          </p>
        ))}
      </div>
      {outcome.latex ? <Equation latex={outcome.latex} /> : null}
      <ResultTable rows={shown} />
      {outcome.notes?.length ? (
        <>
          <p className={tools.note}>{t('kitPhysics.ui.assumptions')}</p>
          <ul className={chem.steps}>
            {outcome.notes.map((note, i) => (
              <li key={i}>{say(note)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {outcome.plot ? (
        <figure
          className={chem.figure}
          role="img"
          aria-label={alt}
          dangerouslySetInnerHTML={{ __html: plotToSvg(outcome.plot, TOKEN_PALETTE, alt, sayText) }}
        />
      ) : null}
      <p className={tools.note}>{t('kitPhysics.ui.steps')}</p>
      <ol className={chem.steps} aria-label={t('kitPhysics.ui.steps')}>
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <p className={tools.note}>{t('kitPhysics.ui.stepsNote')}</p>
      {outcome.source ? (
        <p className={chem.source}>{t('kitPhysics.ui.source', { name: sayKey(outcome.source) })}</p>
      ) : null}
      <InsertButtons outcome={outcome} shown={shown} steps={steps} insert={insert} />
    </div>
  );
}
