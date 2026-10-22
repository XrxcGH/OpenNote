// The significant-figures helper (science helpers). Part one counts the figures of a number, rounds it to a chosen
// count, and writes it plain, in scientific notation, or in engineering notation. Part two calculates a sum by the
// classroom rules and says which rule rounded the answer.
import { useEffect, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { parseDec, roundToFigures, write } from '../science/decimal';
import { ruleText } from '../science/explain';
import { countFigures, sigFigCalculate } from '../science/sigfigs';
import type { Notation } from '../science/sigfigs';
import { insertIntoPage } from './CalculatorTool';
import { loadStored, saveStored } from './storage';
import extra from './extra.module.css';
import science from './science.module.css';
import styles from './tools.module.css';

const STORE = 'sigfigs';
const SEED_EVENT = 'opennote:sigfigs-seed';
const NOTATIONS: readonly Notation[] = ['plain', 'scientific', 'engineering'];

interface Saved {
  input: string;
  figures: string;
  notation: Notation;
  sum: string;
}

const FIRST: Saved = { input: '0.00120', figures: '', notation: 'plain', sum: '' };

/** Starts the helper on a number, such as the one selected on the page. */
export function seedSigFigs(input: string): void {
  saveStored(STORE, { ...FIRST, ...loadStored<Partial<Saved>>(STORE, {}), input: input.trim() });
  window.dispatchEvent(new Event(SEED_EVENT));
}

/** The number text rounded to a count (when given) and written in a notation. Null when it is not a number. */
export function shapeNumber(input: string, figures: string, notation: Notation): string | null {
  const d = parseDec(input);
  if (d === null) return null;
  const count = Number(figures);
  const ready = figures.trim() !== '' && Number.isInteger(count) && count >= 1 && count <= 50;
  return write(ready ? roundToFigures(d, count) : d, notation);
}

function readSaved(): Saved {
  const stored = loadStored<Partial<Saved>>(STORE, {});
  return {
    input: typeof stored.input === 'string' ? stored.input : FIRST.input,
    figures: typeof stored.figures === 'string' ? stored.figures : '',
    notation: NOTATIONS.includes(stored.notation as Notation) ? (stored.notation as Notation) : 'plain',
    sum: typeof stored.sum === 'string' ? stored.sum : '',
  };
}

export function SigFigsTool() {
  const [state, setState] = useState<Saved>(readSaved);
  // A number selected on the page is sent here, also while this window is open.
  useEffect(() => {
    const reread = () => setState(readSaved());
    window.addEventListener(SEED_EVENT, reread);
    return () => window.removeEventListener(SEED_EVENT, reread);
  }, []);
  const update = (next: Saved) => {
    setState(next);
    saveStored(STORE, next);
  };
  const counted = countFigures(state.input);
  const shaped = shapeNumber(state.input, state.figures, state.notation);
  const result = state.sum.trim() === '' ? null : sigFigCalculate(state.sum);

  const put = (text: string) => {
    const ok = insertIntoPage({ text });
    announce(ok ? t('science.sigfigs.inserted', { text }) : t('science.sigfigs.noPage'));
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      announce(t('science.sigfigs.copied'));
    } catch {
      announce(t('science.sigfigs.noPage'));
    }
  };

  return (
    <div className={styles.tool}>
      <label className={extra.field}>
        {t('science.sigfigs.number')}
        <input
          type="text"
          inputMode="decimal"
          className={extra.input}
          value={state.input}
          aria-invalid={state.input.trim() !== '' && counted === null ? true : undefined}
          aria-describedby="sigfigs-number-help"
          onChange={(event) => update({ ...state, input: event.target.value })}
        />
      </label>
      <p id="sigfigs-number-help" className={styles.note}>
        {t('science.sigfigs.numberHelp')}
      </p>
      <div className={science.result} role="status">
        {state.input.trim() === '' ? null : counted === null ? (
          <span className={styles.problem}>{t('science.sigfigs.notNumber')}</span>
        ) : (
          <>
            <span className={science.big}>{t('science.sigfigs.count', { count: counted.figures })}</span>
            {counted.ambiguous ? <span>{t('science.sigfigs.ambiguous', { example: counted.scientific })}</span> : null}
          </>
        )}
      </div>
      <label className={extra.field}>
        {t('science.sigfigs.roundTo')}
        <input
          type="number"
          min={1}
          max={50}
          inputMode="numeric"
          className={extra.input}
          value={state.figures}
          onChange={(event) => update({ ...state, figures: event.target.value })}
        />
      </label>
      <div role="group" aria-label={t('science.sigfigs.notation')} className={science.choice}>
        {NOTATIONS.map((one) => (
          <button
            key={one}
            type="button"
            className={science.toggle}
            aria-pressed={state.notation === one}
            onClick={() => update({ ...state, notation: one })}
          >
            {t(`science.sigfigs.notations.${one}`)}
          </button>
        ))}
      </div>
      {shaped === null ? null : (
        <div className={science.result} role="status">
          <span className={science.big}>{shaped}</span>
          {state.figures.trim() !== '' ? (
            <span>{t('science.sigfigs.rounded', { count: Number(state.figures) || 1 })}</span>
          ) : null}
        </div>
      )}
      <div className={styles.buttons}>
        <Button variant="primary" disabled={shaped === null} onClick={() => shaped !== null && put(shaped)}>
          {t('science.sigfigs.insert')}
        </Button>
        <Button variant="quiet" disabled={shaped === null} onClick={() => shaped !== null && void copy(shaped)}>
          {t('science.sigfigs.copy')}
        </Button>
      </div>

      <label className={extra.field}>
        {t('science.sigfigs.calculate')}
        <input
          type="text"
          className={extra.input}
          value={state.sum}
          aria-describedby="sigfigs-sum-help"
          onChange={(event) => update({ ...state, sum: event.target.value })}
        />
      </label>
      <p id="sigfigs-sum-help" className={styles.note}>
        {t('science.sigfigs.calculateHelp')}
      </p>
      <div className={science.result} role="status">
        {result === null ? (
          <span>{t('science.sigfigs.calculateEmpty')}</span>
        ) : !result.ok ? (
          <span className={styles.problem}>{t('science.sigfigs.cannot')}</span>
        ) : (
          <>
            <span className={science.big}>{result.text}</span>
            <span>{ruleText(result)}</span>
            <span>{t('science.sigfigs.middleSteps')}</span>
          </>
        )}
      </div>
      <div className={styles.buttons}>
        <Button variant="quiet" disabled={result === null || !result.ok} onClick={() => result?.ok && put(result.text)}>
          {t('science.sigfigs.insert')}
        </Button>
      </div>
    </div>
  );
}
