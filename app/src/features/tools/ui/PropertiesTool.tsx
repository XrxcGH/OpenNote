// Property tables: saturated steam, ideal-gas specific heats, and engineering materials. Each is searchable, each row
// names its source, and a row or a whole table can be inserted at the caret of the page that is open. Steam and gas
// values can be read at any point by interpolating between rows.
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Button, TextField, announce } from '../../../ui';
import { GAS_TEMPS, gasProperties, gases, steamAt, steamRows } from '../chem/data/lookup';
import type { Steam, SteamColumn } from '../chem/data/lookup';
import { STEAM_COLUMNS } from '../chem/data/lookup';
import { MATERIALS, MATERIAL_SOURCES, searchMaterials } from '../chem/data/materials';
import type { Material, MaterialGroup } from '../chem/data/materials';
import { insertIntoPage } from './CalculatorTool';
import styles from './chem.module.css';
import extra from './extra.module.css';
import { loadStored, saveStored } from './storage';
import tools from './tools.module.css';

type Tab = 'steam' | 'gases' | 'materials';
const TABS: readonly Tab[] = ['steam', 'gases', 'materials'];
const STORE = 'properties';

function insertRow(line: string): void {
  announce(t(insertIntoPage({ text: line }) ? 'chem.inserted' : 'chem.noPage'));
}

function insertTableOf(header: string[], rows: string[][]): void {
  announce(t(insertIntoPage({ table: { header, rows } }) ? 'chem.tableInserted' : 'chem.noPage'));
}

interface Column<R> {
  key: string;
  head: string;
  text(row: R): string;
  numeric?: boolean;
}

function Table<R>({
  rows,
  columns,
  rowKey,
  label,
}: {
  rows: readonly R[];
  columns: readonly Column<R>[];
  rowKey(row: R): string;
  label: string;
}) {
  return (
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={label}>
      <table className={extra.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? styles.numeric : undefined}>
                {c.head}
              </th>
            ))}
            <th scope="col">
              <span className={extra.hidden}>{t('study.reference.insert')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.key} scope="row" className={c.numeric ? styles.numeric : undefined}>
                    {c.text(row)}
                  </th>
                ) : (
                  <td key={c.key} className={c.numeric ? styles.numeric : undefined}>
                    {c.text(row)}
                  </td>
                ),
              )}
              <td>
                <Button
                  variant="quiet"
                  aria-label={t('chem.data.insertRow', { name: columns[0].text(row) })}
                  onClick={() => insertRow(columns.map((c) => `${c.head} ${c.text(row)}`).join(', '))}
                >
                  {t('study.reference.insert')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const fmt = (n: number) => String(Number(n.toPrecision(5)));

// Steam ------------------------------------------------------------------------------------------------------------
const steamHead = (c: SteamColumn): string => t(`chem.data.steamCols.${c}` as MessageKey);

function SteamTab() {
  const [by, setBy] = useState<'T' | 'P'>('T');
  const [value, setValue] = useState('100');
  const [query, setQuery] = useState('');
  const rows = useMemo(
    () => steamRows(by).filter((r) => query.trim() === '' || String(r[by]).includes(query.trim())),
    [by, query],
  );
  const lookup: Steam | null = value.trim() === '' ? null : steamAt(by, Number(value));
  const columns: Column<Steam>[] = STEAM_COLUMNS.map((c) => ({
    key: c,
    head: steamHead(c),
    text: (r) => fmt(r[c]),
    numeric: true,
  }));
  const first = by === 'T' ? columns : [columns[1], columns[0], ...columns.slice(2)];
  const line = (r: Steam) =>
    `${t('chem.data.steamAt')} ${fmt(r.T)} °C (${fmt(r.P)} kPa): ` +
    STEAM_COLUMNS.slice(2)
      .map((c) => `${c} = ${fmt(r[c])}`)
      .join(', ');
  return (
    <>
      <div className={tools.pair}>
        <label className={extra.field}>
          {t('chem.data.orderedBy')}
          <select
            className={extra.input}
            value={by}
            onChange={(e) => {
              setBy(e.target.value as 'T' | 'P');
              setValue(e.target.value === 'T' ? '100' : '101.325');
            }}
          >
            <option value="T">{t('chem.data.byT')}</option>
            <option value="P">{t('chem.data.byP')}</option>
          </select>
        </label>
        <label className={extra.field}>
          {t(by === 'T' ? 'chem.data.atT' : 'chem.data.atP')}
          <input
            type="text"
            inputMode="decimal"
            className={extra.input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={value.trim() !== '' && !lookup ? true : undefined}
          />
        </label>
      </div>
      <div role="status" aria-live="polite">
        {lookup ? (
          <div className={styles.result}>
            <p className={styles.headline}>
              {fmt(lookup.T)} {t('chem.data.celsius')} · {fmt(lookup.P)} {t('chem.data.kpa')}
            </p>
            <p className={tools.note}>
              {STEAM_COLUMNS.slice(2)
                .map((c) => `${steamHead(c)} ${fmt(lookup[c])}`)
                .join(' · ')}
            </p>
            {lookup.interpolated ? <p className={tools.note}>{t('chem.data.interpolated')}</p> : null}
            <div className={tools.buttons}>
              <Button variant="quiet" onClick={() => insertRow(line(lookup))}>
                {t('chem.data.insertValues')}
              </Button>
            </div>
          </div>
        ) : value.trim() !== '' ? (
          <p className={tools.problem}>{t(by === 'T' ? 'chem.data.outsideT' : 'chem.data.outsideP')}</p>
        ) : null}
      </div>
      <TextField label={t('study.reference.search')} value={query} onChange={setQuery} />
      <div className={tools.buttons}>
        <Button
          variant="quiet"
          disabled={rows.length === 0}
          onClick={() =>
            insertTableOf(
              first.map((c) => c.head),
              rows.map((r) => first.map((c) => c.text(r))),
            )
          }
        >
          {t('chem.data.insertTable')}
        </Button>
      </div>
      <Table rows={rows} columns={first} rowKey={(r) => `${r.T}-${r.P}`} label={t('chem.data.steamTitle')} />
      <p className={styles.source}>
        {t('chem.data.units.steam')} {t('chem.data.source')}: {rows[0]?.source ?? steamRows('T')[0].source}
      </p>
    </>
  );
}

// Gases ------------------------------------------------------------------------------------------------------------
function GasTab() {
  const [temp, setTemp] = useState('300');
  const [query, setQuery] = useState('');
  const T = Number(temp);
  const valid = temp.trim() !== '' && T >= GAS_TEMPS[0] && T <= GAS_TEMPS[GAS_TEMPS.length - 1];
  const rows = useMemo(
    () =>
      gases()
        .filter((g) => `${g.name} ${g.formula}`.toLowerCase().includes(query.trim().toLowerCase()))
        .map((g) => ({ gas: g, p: valid ? gasProperties(g.name, T) : null })),
    [query, T, valid],
  );
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'name', head: t('chem.data.gasCols.name'), text: (r) => r.gas.name },
    { key: 'formula', head: t('chem.data.gasCols.formula'), text: (r) => r.gas.formula },
    { key: 'M', head: 'M', text: (r) => fmt(r.gas.molarMass), numeric: true },
    { key: 'R', head: 'R', text: (r) => fmt(r.gas.R), numeric: true },
    { key: 'cp', head: 'cp', text: (r) => (r.p ? fmt(r.p.cp) : '—'), numeric: true },
    { key: 'cv', head: 'cv', text: (r) => (r.p ? fmt(r.p.cv) : '—'), numeric: true },
    { key: 'k', head: 'k', text: (r) => (r.p ? fmt(r.p.k) : '—'), numeric: true },
  ];
  return (
    <>
      <label className={extra.field}>
        {t('chem.data.gasTemp', { low: GAS_TEMPS[0], high: GAS_TEMPS[GAS_TEMPS.length - 1] })}
        <input
          type="text"
          inputMode="decimal"
          className={extra.input}
          value={temp}
          aria-invalid={!valid ? true : undefined}
          onChange={(e) => setTemp(e.target.value)}
        />
      </label>
      <p className={tools.problem} role="status">
        {valid ? '' : t('chem.data.outsideGas', { low: GAS_TEMPS[0], high: GAS_TEMPS[GAS_TEMPS.length - 1] })}
      </p>
      <TextField label={t('study.reference.search')} value={query} onChange={setQuery} />
      <div className={tools.buttons}>
        <Button
          variant="quiet"
          disabled={rows.length === 0 || !valid}
          onClick={() =>
            insertTableOf(
              columns.map((c) => c.head),
              rows.map((r) => columns.map((c) => c.text(r))),
            )
          }
        >
          {t('chem.data.insertTable')}
        </Button>
      </div>
      <Table rows={rows} columns={columns} rowKey={(r) => r.gas.name} label={t('chem.data.gasTitle')} />
      <p className={styles.source}>
        {t('chem.data.units.gas', { temp: valid ? T : 300 })} {t('chem.data.source')}: {rows[0]?.gas.source}
      </p>
    </>
  );
}

// Materials --------------------------------------------------------------------------------------------------------
const GROUPS: readonly MaterialGroup[] = ['aluminum', 'steel', 'otherMetal', 'polymer', 'ceramic', 'wood'];

function MaterialsTab() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<'all' | MaterialGroup>('all');
  const groupName = (g: MaterialGroup) => t(`chem.data.groups.${g}`);
  const rows = useMemo(
    () => searchMaterials(query, groupName).filter((m) => group === 'all' || m.group === group),
    [query, group],
  );
  const columns: Column<Material>[] = [
    { key: 'name', head: t('chem.data.matCols.name'), text: (m) => `${m.name} (${m.condition})` },
    { key: 'rho', head: 'ρ', text: (m) => String(m.density), numeric: true },
    { key: 'E', head: 'E', text: (m) => String(m.modulus), numeric: true },
    { key: 'sy', head: 'σy', text: (m) => (m.yield === null ? '—' : String(m.yield)), numeric: true },
    { key: 'k', head: 'k', text: (m) => String(m.conductivity), numeric: true },
    { key: 'cp', head: 'cp', text: (m) => String(m.specificHeat), numeric: true },
    { key: 'src', head: t('chem.data.matCols.source'), text: (m) => m.sources.join(', ') },
  ];
  const used = [...new Set(rows.flatMap((m) => m.sources))];
  let legend: ReactNode = null;
  if (used.length > 0) {
    legend = (
      <ul className={styles.source}>
        {used.map((id) => (
          <li key={id}>
            {id}: {MATERIAL_SOURCES[id].name} ({MATERIAL_SOURCES[id].license})
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      <div className={tools.pair}>
        <div className={extra.field}>
          <TextField label={t('study.reference.search')} value={query} onChange={setQuery} />
        </div>
        <label className={extra.field}>
          {t('chem.data.group')}
          <select
            className={extra.input}
            value={group}
            onChange={(e) => setGroup(e.target.value as 'all' | MaterialGroup)}
          >
            <option value="all">{t('chem.data.allGroups')}</option>
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {groupName(g)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={tools.buttons}>
        <Button
          variant="quiet"
          disabled={rows.length === 0}
          onClick={() =>
            insertTableOf(
              columns.map((c) => c.head),
              rows.map((r) => columns.map((c) => c.text(r))),
            )
          }
        >
          {t('chem.data.insertTable')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className={tools.empty} role="status">
          {t('study.reference.noMatch', { query: query.trim() })}
        </p>
      ) : (
        <Table rows={rows} columns={columns} rowKey={(m) => m.id} label={t('chem.data.matTitle')} />
      )}
      <p className={styles.source}>{t('chem.data.units.materials', { count: MATERIALS.length })}</p>
      {legend}
    </>
  );
}

export function PropertiesTool() {
  const saved = loadStored<{ tab?: Tab }>(STORE, {});
  const [tab, setTab] = useState<Tab>(TABS.includes(saved.tab as Tab) ? (saved.tab as Tab) : 'steam');
  return (
    <div className={tools.tool}>
      <div className={tools.tabs} role="tablist" aria-label={t('chem.data.title')}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`props-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="props-panel"
            className={tools.tab}
            onClick={() => {
              setTab(id);
              saveStored(STORE, { tab: id });
            }}
          >
            {t(`chem.data.tabs.${id}`)}
          </button>
        ))}
      </div>
      <div id="props-panel" role="tabpanel" aria-labelledby={`props-tab-${tab}`} className={tools.tool}>
        {tab === 'steam' ? <SteamTab /> : tab === 'gases' ? <GasTab /> : <MaterialsTab />}
      </div>
    </div>
  );
}
