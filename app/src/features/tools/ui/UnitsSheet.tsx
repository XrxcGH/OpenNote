// The units sheet: SI base and derived units, 2022 CODATA constants, and formulas for math, physics, and chemistry.
// Each section is a table with a heading, and the search narrows every section at once. Insert writes a symbol, a
// constant with its unit, or a formula at the caret of the open page.
import { t } from '../../../strings/t';
import { constantLine } from '../reference/unitsSheet';
import type { Formula, SheetConstant, SheetResult, SheetSection, SheetUnit } from '../reference/unitsSheet';
import extra from './extra.module.css';
import { InsertButton } from './InsertButton';

function UnitRows({ rows }: { rows: readonly SheetUnit[] }) {
  return (
    <table className={extra.table}>
      <thead>
        <tr>
          <th scope="col">{t('study.reference.name')}</th>
          <th scope="col">{t('study.reference.symbol')}</th>
          <th scope="col">{t('study.reference.units.measures')}</th>
          <th scope="col">{t('study.reference.units.definition')}</th>
          <th scope="col">
            <span className={extra.hidden}>{t('study.reference.insert')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((one) => (
          <tr key={one.symbol}>
            <th scope="row">{one.name}</th>
            <td>{one.symbol}</td>
            <td>{one.measures}</td>
            <td>{one.definition}</td>
            <td>
              <InsertButton text={one.symbol} label={t('study.reference.insertNamed', { name: one.name })} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConstantRows({ rows }: { rows: readonly SheetConstant[] }) {
  return (
    <table className={extra.table}>
      <thead>
        <tr>
          <th scope="col">{t('study.reference.name')}</th>
          <th scope="col">{t('study.reference.symbol')}</th>
          <th scope="col">{t('study.reference.value')}</th>
          <th scope="col">{t('study.reference.units.exactness')}</th>
          <th scope="col">
            <span className={extra.hidden}>{t('study.reference.insert')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((one) => {
          const line = constantLine(one);
          return (
            <tr key={one.symbol}>
              <th scope="row">{one.name}</th>
              <td>{one.symbol}</td>
              <td>{line.slice(one.symbol.length + 3)}</td>
              <td>{one.exact ? t('study.reference.units.exact') : t('study.reference.units.measured')}</td>
              <td>
                <InsertButton text={line} label={t('study.reference.insertNamed', { name: one.name })} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FormulaRows({ rows }: { rows: readonly Formula[] }) {
  return (
    <table className={extra.table}>
      <thead>
        <tr>
          <th scope="col">{t('study.reference.name')}</th>
          <th scope="col">{t('study.reference.units.formula')}</th>
          <th scope="col">{t('study.reference.units.where')}</th>
          <th scope="col">
            <span className={extra.hidden}>{t('study.reference.insert')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((one) => (
          <tr key={one.name}>
            <th scope="row">{one.name}</th>
            <td>{one.text}</td>
            <td>{one.where}</td>
            <td>
              <InsertButton text={one.text} label={t('study.reference.insertNamed', { name: one.name })} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UnitsSheet({ result, sections }: { result: SheetResult; sections: readonly SheetSection[] }) {
  return (
    <>
      {sections.map((section) => {
        if (result[section].length === 0) return null;
        const headingId = `units-section-${section}`;
        return (
          <section key={section} aria-labelledby={headingId}>
            <h3 id={headingId}>{t(`study.reference.units.sections.${section}`)}</h3>
            {section === 'base' || section === 'derived' ? <UnitRows rows={result[section]} /> : null}
            {section === 'constants' ? <ConstantRows rows={result.constants} /> : null}
            {section === 'math' || section === 'physics' || section === 'chemistry' ? (
              <FormulaRows rows={result[section]} />
            ) : null}
          </section>
        );
      })}
    </>
  );
}
