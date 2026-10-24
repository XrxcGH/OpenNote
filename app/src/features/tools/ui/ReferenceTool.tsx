// Reference tables (Productivity and study tools): the periodic table, physical constants, metric prefixes, and Greek
// letters. An element's family shows as a color and as a label in words. Choosing Insert puts an entry at the
// caret of the page that is open.
import { useMemo, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, TextField } from '../../../ui';
import type { ElementGroup } from '../reference/data';
import { ELEMENTS, ELEMENT_GROUPS, GREEK, PHYSICAL_CONSTANTS, PREFIXES, matches } from '../reference/data';
import { keepTogether, displaySymbol } from '../reference/format';
import { searchSheet, countSheet, scientific, SHEET_SECTIONS } from '../reference/unitsSheet';
import type { SheetSection } from '../reference/unitsSheet';
import { ChemistryTab } from './ChemistryTab';
import { ElementsGrid } from './ElementsGrid';
import { ElementsTable } from './ElementsTable';
import { InsertButton } from './InsertButton';
import { UnitsSheet } from './UnitsSheet';
import extra from './extra.module.css';
import ref from './reference.module.css';
import styles from './tools.module.css';

type Tab = 'elements' | 'units' | 'chemistry' | 'constants' | 'prefixes' | 'greek';
const TABS: readonly Tab[] = ['elements', 'units', 'chemistry', 'constants', 'prefixes', 'greek'];

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function ReferenceTool() {
  const [tab, setTab] = useState<Tab>('elements');
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<ElementGroup | 'all'>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [section, setSection] = useState<SheetSection | 'all'>('all');
  const elements = useMemo(
    () =>
      ELEMENTS.filter(
        (element) =>
          (family === 'all' || element.group === family) &&
          matches(
            `${element.name} ${element.symbol} ${element.number} ${t(`study.reference.groups.${element.group}`)}`,
            query,
          ),
      ),
    [query, family],
  );
  const constants = PHYSICAL_CONSTANTS.filter((one) => matches(`${one.name} ${one.symbol}`, query));
  const prefixes = PREFIXES.filter((one) => matches(`${one.name} ${one.symbol} ${one.power}`, query));
  const greek = GREEK.filter((one) => matches(`${one.name} ${one.upper} ${one.lower}`, query));

  const sheet = useMemo(() => searchSheet(query, section), [query, section]);
  const shown = {
    elements: elements.length,
    units: countSheet(sheet),
    chemistry: 0,
    constants: constants.length,
    prefixes: prefixes.length,
    greek: greek.length,
  }[tab];
  const searchable = tab !== 'chemistry';

  return (
    <div className={styles.toolFill}>
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
            onClick={() => {
              // A search is for the table it was typed in: another table starts with all of its rows.
              setTab(one);
              setQuery('');
              setFamily('all');
              setSection('all');
            }}
          >
            {t(`study.reference.tabs.${one}`)}
          </button>
        ))}
      </div>
      <div className={ref.controls}>
        {searchable ? (
          <div className={ref.grow}>
            <TextField label={t('study.reference.search')} value={query} onChange={setQuery} />
          </div>
        ) : null}
        {tab === 'units' ? (
          <label className={extra.field}>
            {t('study.reference.units.section')}
            <select
              className={extra.input}
              value={section}
              onChange={(event) => setSection(event.target.value as SheetSection | 'all')}
            >
              <option value="all">{t('study.reference.units.allSections')}</option>
              {SHEET_SECTIONS.map((one) => (
                <option key={one} value={one}>
                  {t(`study.reference.units.sections.${one}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {tab === 'elements' ? (
          <>
            <label className={extra.field}>
              {t('study.reference.familyFilter')}
              <select
                className={extra.input}
                value={family}
                onChange={(event) => setFamily(event.target.value as ElementGroup | 'all')}
              >
                <option value="all">{t('study.reference.allFamilies')}</option>
                {ELEMENT_GROUPS.map((one) => (
                  <option key={one} value={one}>
                    {t(`study.reference.groups.${one}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.buttons} role="group" aria-label={t('study.reference.view')}>
              {(['grid', 'list'] as const).map((one) => (
                <Button key={one} variant="quiet" aria-pressed={view === one} onClick={() => setView(one)}>
                  {t(`study.reference.views.${one}`)}
                </Button>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div id="reference-panel" role="tabpanel" aria-labelledby={`reference-tab-${tab}`} className={extra.scroll}>
        {searchable && (query.trim() !== '' || (tab === 'units' && section !== 'all')) && shown === 0 ? (
          <p className={styles.empty} role="status">
            {t('study.reference.noMatch', { query: query.trim() })}
          </p>
        ) : null}
        {tab === 'units' ? <UnitsSheet result={sheet} sections={SHEET_SECTIONS} /> : null}
        {tab === 'chemistry' ? <ChemistryTab /> : null}
        {tab === 'elements' && view === 'grid' ? <ElementsGrid elements={elements} /> : null}
        {tab === 'elements' && view === 'list' ? <ElementsTable elements={elements} /> : null}
        {tab === 'constants' ? (
          <table className={`${ref.table} ${ref.withActions}`}>
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
                const value = `${scientific(one.value)}${one.unit ? ` ${one.unit}` : ''}`;
                const text = `${displaySymbol(one.symbol)} = ${value}`;
                return (
                  <tr key={one.symbol}>
                    <th scope="row">{one.name}</th>
                    <td>{displaySymbol(one.symbol)}</td>
                    <td className={ref.num}>{keepTogether(value)}</td>
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
          <table className={`${ref.table} ${ref.withActions}`}>
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
                  <td className={ref.num}>
                    10<sup className={ref.sup}>{one.power}</sup>
                  </td>
                  <td>
                    <InsertButton text={one.symbol} label={t('study.reference.insertNamed', { name: one.name })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {tab === 'greek' ? (
          <table className={`${ref.table} ${ref.withActions}`}>
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
