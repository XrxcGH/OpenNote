// The facts about one element: the numbers that name it, its place in the table, and its physical properties, with
// buttons that insert the symbol, the electron configuration, or the facts as a line of text.
import { t } from '../../../strings/t';
import { formatNumber } from '../calculator';
import type { Element } from '../reference/data';
import { elementSummary, kelvinToCelsius } from '../reference/summary';
import grid from './elements.module.css';
import { InsertButton } from './InsertButton';

function temperature(kelvin: number | null): string {
  if (kelvin === null) return t('study.reference.unknown');
  return t('study.reference.temperature', {
    kelvin: formatNumber(kelvin),
    celsius: formatNumber(kelvinToCelsius(kelvin)),
  });
}

function factRows(element: Element): [string, string][] {
  const unknown = t('study.reference.unknown');
  const rows: [string, string][] = [
    [t('study.reference.number'), String(element.number)],
    [t('study.reference.mass'), `${formatNumber(element.mass)} u`],
    [t('study.reference.family'), t(`study.reference.groups.${element.group}`)],
    [t('study.reference.period'), String(element.period)],
    [
      t('study.reference.groupNumber'),
      element.groupNumber === null ? t('study.reference.noGroup') : String(element.groupNumber),
    ],
    [t('study.reference.configuration'), element.configuration],
    [t('study.reference.density'), element.density === null ? unknown : `${formatNumber(element.density)} g/cm³`],
    [t('study.reference.melting'), temperature(element.melting)],
    [t('study.reference.boiling'), temperature(element.boiling)],
    [
      t('study.reference.electronegativity'),
      element.electronegativity === null ? unknown : formatNumber(element.electronegativity),
    ],
    [t('study.reference.oxidation'), element.oxidation === '' ? unknown : element.oxidation],
    [t('study.reference.isotopes'), element.isotopes === '' ? unknown : element.isotopes],
  ];
  return rows;
}

/** The summary above the table: name, number, mass, family, and the Insert actions. */
export function ElementCard({ element }: { element: Element }) {
  const rows = factRows(element);
  // The name, number, mass, and family come first, with the actions, above the table so they never fall below the fold.
  // The rest of the facts follow the table.
  const head = rows.slice(0, 3);
  return (
    <section className={grid.card} aria-labelledby="element-card-title" data-group={element.group}>
      <h3 id="element-card-title" className={grid.cardTitle}>
        <span className={grid.big} aria-hidden="true">
          {element.symbol}
        </span>
        {element.name}
      </h3>
      <dl className={grid.summary}>
        {head.map(([label, value]) => (
          <div key={label} className={grid.fact}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={grid.actions}>
        <InsertButton
          flush
          text={element.symbol}
          label={t('study.reference.insertNamed', { name: element.name })}
          caption={t('study.reference.insertSymbolShort')}
        />
        <InsertButton
          text={`${element.symbol}: ${element.configuration}`}
          label={t('study.reference.insertConfiguration', { name: element.name })}
          caption={t('study.reference.insertConfigurationShort')}
        />
        <InsertButton
          text={elementSummary(element)}
          label={t('study.reference.insertData', { name: element.name })}
          caption={t('study.reference.insertDataShort')}
        />
      </div>
    </section>
  );
}

/** The rest of the facts, below the table. */
export function ElementFacts({ element }: { element: Element }) {
  const more = factRows(element).slice(3);
  return (
    <section aria-label={t('study.reference.moreFacts', { name: element.name })}>
      <dl className={grid.facts}>
        {more.map(([label, value]) => (
          <div key={label} className={grid.fact}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
