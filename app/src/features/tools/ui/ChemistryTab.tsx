// The chemistry tab of the reference tables: balance an equation and find the molar mass of a formula. Both answer as
// the person types, and each has an Insert button that writes the answer at the caret of the open page.
import { useState } from 'react';
import { t } from '../../../strings/t';
import { TextField } from '../../../ui';
import { balanceEquation, formatMass, molarMass, prettyFormula } from '../reference/chemistry';
import ref from './reference.module.css';
import { InsertButton } from './InsertButton';
import styles from './tools.module.css';

/** Says in words why an equation or formula was not accepted. An empty box needs no complaint. */
function problemText(failure: { reason: string; detail: string } | null): string {
  if (failure === null) return '';
  switch (failure.reason) {
    case 'no-arrow':
      return t('study.reference.chemistry.noArrow');
    case 'one-side':
      return t('study.reference.chemistry.oneSide');
    case 'cannot-balance':
      return t('study.reference.chemistry.cannotBalance');
    case 'many-ways':
      return t('study.reference.chemistry.manyWays');
    case 'unknown-element':
      return t('study.reference.chemistry.unknownElement', { detail: failure.detail });
    case 'syntax':
      return t('study.reference.chemistry.syntax', { detail: failure.detail });
    default:
      return '';
  }
}

function Balancer() {
  const [text, setText] = useState('H2 + O2 -> H2O');
  const result = balanceEquation(text);
  const problem = problemText(result.ok ? null : result);
  return (
    <section aria-labelledby="chem-balance">
      <h3 id="chem-balance">{t('study.reference.chemistry.balanceTitle')}</h3>
      <TextField label={t('study.reference.chemistry.equation')} value={text} onChange={setText} />
      <p className={styles.note}>{t('study.reference.chemistry.equationHint')}</p>
      <p role="status" className={result.ok ? undefined : styles.problem}>
        {result.ok ? t('study.reference.chemistry.balanced', { equation: result.text }) : problem}
      </p>
      {result.ok ? (
        <InsertButton
          flush
          text={result.text}
          label={t('study.reference.chemistry.insertEquation')}
          caption={t('study.reference.chemistry.insertEquationShort')}
        />
      ) : null}
    </section>
  );
}

function MolarMassCalculator() {
  const [text, setText] = useState('C6H12O6');
  const result = molarMass(text);
  const problem = problemText(result.ok ? null : result);
  const line = result.ok
    ? t('study.reference.chemistry.massLine', { formula: prettyFormula(text), mass: formatMass(result.mass) })
    : '';
  return (
    <section aria-labelledby="chem-mass">
      <h3 id="chem-mass">{t('study.reference.chemistry.massTitle')}</h3>
      <TextField label={t('study.reference.chemistry.formula')} value={text} onChange={setText} />
      <p className={styles.note}>{t('study.reference.chemistry.formulaHint')}</p>
      <p role="status" className={result.ok ? undefined : styles.problem}>
        {result.ok ? line : problem}
      </p>
      {result.ok ? (
        <>
          <table className={ref.table}>
            <thead>
              <tr>
                <th scope="col">{t('study.reference.symbol')}</th>
                <th scope="col">{t('study.reference.chemistry.atoms')}</th>
                <th scope="col">{t('study.reference.chemistry.massColumn')}</th>
                <th scope="col">{t('study.reference.chemistry.percent')}</th>
              </tr>
            </thead>
            <tbody>
              {result.parts.map((part) => (
                <tr key={part.symbol}>
                  <th scope="row">{part.symbol}</th>
                  <td>{part.count}</td>
                  <td>{formatMass(part.mass)}</td>
                  <td>{`${Math.round(part.percent * 100) / 100}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <InsertButton
            flush
            text={line}
            label={t('study.reference.chemistry.insertMass')}
            caption={t('study.reference.chemistry.insertMassShort')}
          />
        </>
      ) : null}
    </section>
  );
}

export function ChemistryTab() {
  return (
    <>
      <Balancer />
      <MolarMassCalculator />
    </>
  );
}
