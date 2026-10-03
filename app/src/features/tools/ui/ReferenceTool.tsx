// Reference tables (Productivity and study tools): the periodic table, physical constants, metric prefixes, and Greek
// letters. An element's family shows as a color and as a label in words. Choosing Insert puts an entry at the
// caret of the page that is open.
import { useMemo, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { formatNumber } from '../calculator';
import { ELEMENTS, GREEK, PHYSICAL_CONSTANTS, PREFIXES, matches } from '../reference/data';
import { insertIntoPage } from './CalculatorTool';
import extra from './extra.module.css';
import styles from './tools.module.css';

type Tab = 'elements' | 'constants' | 'prefixes' | 'greek';
const TABS: readonly Tab[] = ['elements', 'constants', 'prefixes', 'greek'];

function InsertButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      variant="quiet"
      aria-label={label}
      onClick={() => announce(t(insertIntoPage({ text }) ? 'study.reference.inserted' : 'study.reference.noPage'))}
    >
      {t('study.reference.insert')}
    </Button>
  );
}

export function ReferenceTool() {
  const [tab, setTab] = useState<Tab>('elements');
  const [query, setQuery] = useState('');
  const elements = useMemo(
    () =>
      ELEMENTS.filter((element) =>
        matches(
          `${element.name} ${element.symbol} ${element.number} ${t(`study.reference.groups.${element.group}`)}`,
          query,
        ),
      ),
    [query],
  );
  const constants = PHYSICAL_CONSTANTS.filter((one) => matches(`${one.name} ${one.symbol}`, query));
  const prefixes = PREFIXES.filter((one) => matches(`${one.name} ${one.symbol} ${one.power}`, query));
  const greek = GREEK.filter((one) => matches(`${one.name} ${one.upper} ${one.lower}`, query));

  return (
    <div className={styles.tool}>
      <div className={styles.tabs} role="tablist" aria-label={t('study.reference.title')}>
        {TABS.map((one) => (
          <button
            key={one}
            type="button"
            role="tab"
            id={`reference-tab-${one}`}
            aria-selected={tab === one}
            aria-controls="reference-panel"
            className={styles.tab}
            onClick={() => setTab(one)}
          >
            {t(`study.reference.tabs.${one}`)}
          </button>
        ))}
      </div>
      <TextField label={t('study.reference.search')} value={query} onChange={setQuery} />
      <div id="reference-panel" role="tabpanel" aria-labelledby={`reference-tab-${tab}`} className={extra.scroll}>
        {tab === 'elements' ? (
          <table className={extra.table}>
            <thead>
              <tr>
                <th scope="col">{t('study.reference.number')}</th>
                <th scope="col">{t('study.reference.symbol')}</th>
                <th scope="col">{t('study.reference.name')}</th>
                <th scope="col">{t('study.reference.mass')}</th>
                <th scope="col">{t('study.reference.family')}</th>
                <th scope="col">
                  <span className={extra.hidden}>{t('study.reference.insert')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {elements.map((element) => (
                <tr key={element.number}>
                  <td>{element.number}</td>
                  <th scope="row">{element.symbol}</th>
                  <td>{element.name}</td>
                  <td>{element.mass}</td>
                  <td>
                    <span className={extra.dot} data-group={element.group} aria-hidden="true" />
                    {t(`study.reference.groups.${element.group}`)}
                  </td>
                  <td>
                    <InsertButton
                      text={element.symbol}
                      label={t('study.reference.insertNamed', { name: element.name })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {tab === 'constants' ? (
          <table className={extra.table}>
            <thead>
              <tr>
                <th scope="col">{t('study.reference.name')}</th>
                <th scope="col">{t('study.reference.symbol')}</th>
                <th scope="col">{t('study.reference.value')}</th>
                <th scope="col">
                  <span className={extra.hidden}>{t('study.reference.insert')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {constants.map((one) => {
                const text = `${one.symbol} = ${formatNumber(one.value)}${one.unit ? ` ${one.unit}` : ''}`;
                return (
                  <tr key={one.symbol}>
                    <th scope="row">{one.name}</th>
                    <td>{one.symbol}</td>
                    <td>{text.slice(one.symbol.length + 3)}</td>
                    <td>
                      <InsertButton text={text} label={t('study.reference.insertNamed', { name: one.name })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {tab === 'prefixes' ? (
          <table className={extra.table}>
            <thead>
              <tr>
                <th scope="col">{t('study.reference.name')}</th>
                <th scope="col">{t('study.reference.symbol')}</th>
                <th scope="col">{t('study.reference.factor')}</th>
                <th scope="col">
                  <span className={extra.hidden}>{t('study.reference.insert')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {prefixes.map((one) => (
                <tr key={one.symbol}>
                  <th scope="row">{one.name}</th>
                  <td>{one.symbol}</td>
                  <td>{`10^${one.power}`}</td>
                  <td>
                    <InsertButton text={one.symbol} label={t('study.reference.insertNamed', { name: one.name })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {tab === 'greek' ? (
          <table className={extra.table}>
            <thead>
              <tr>
                <th scope="col">{t('study.reference.name')}</th>
                <th scope="col">{t('study.reference.upper')}</th>
                <th scope="col">{t('study.reference.lower')}</th>
                <th scope="col">
                  <span className={extra.hidden}>{t('study.reference.insert')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {greek.map((one) => (
                <tr key={one.name}>
                  <th scope="row">{one.name}</th>
                  <td>{one.upper}</td>
                  <td>{one.lower}</td>
                  <td>
                    <InsertButton text={one.lower} label={t('study.reference.insertNamed', { name: one.name })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
