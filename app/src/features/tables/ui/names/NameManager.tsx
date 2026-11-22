// The Name manager: the names this table sees (its own and the page's), with conflicts and hidden page names
// flagged. It defines a name for this table or for every table on the page, deletes one, and makes names from the
// selection. Names live in the data.sheet of the table that defines them (format spec R-SHT-13).
import { useId, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, Dialog } from '../../../../ui';
import type { TableExtraHost } from '../../../page';
import { textsOf } from '../../keys/state';
import { readSheet, sheetPatch } from '../../sheet/model';
import type { Sheet } from '../../sheet/model';
import { hostsOfPage } from '../toolbar/hosts';
import type { DialogProps } from '../formulaBar/FormulaBar';
import styles from '../formulaBar/formulaBar.module.css';
import { defineName, nameRows, namesFromSelection, removeName } from './names';
import type { DefineRefusal, Definition, NameRow } from './names';

/** The hosts of the page's tables in page order, and which one is this table. */
function pageHosts(host: TableExtraHost): { hosts: TableExtraHost[]; own: number } {
  const hosts = hostsOfPage(host.page).sort((a, b) =>
    a.element === b.element ? 0 : a.element.compareDocumentPosition(b.element) & 4 ? -1 : 1,
  );
  const own = hosts.findIndex((h) => h.block === host.block);
  return own < 0 ? { hosts: [host], own: 0 } : { hosts, own };
}

const refusalText = (refused: DefineRefusal, name: string) =>
  refused === 'taken' ? t('sheetFormula.names.refused.taken', { name }) : t(`sheetFormula.names.refused.${refused}`);

function ScopeCell({ row }: { row: NameRow }) {
  return (
    <td>
      {row.scope === 'page' ? t('sheetFormula.names.scopePage') : t('sheetFormula.names.scopeTable')}
      {row.conflict ? <p className={styles.error}>{t('sheetFormula.names.conflict', { name: row.name })}</p> : null}
      {row.shadowed ? <p className={styles.detail}>{t('sheetFormula.names.shadow', { name: row.name })}</p> : null}
    </td>
  );
}

function NameTable({ rows, remove }: { rows: NameRow[]; remove(row: NameRow): void }) {
  if (rows.length === 0) return <p>{t('sheetFormula.names.empty')}</p>;
  return (
    <table aria-label={t('sheetFormula.names.list')} data-name-manager="">
      <thead>
        <tr>
          <th scope="col">{t('sheetFormula.names.name')}</th>
          <th scope="col">{t('sheetFormula.names.ref')}</th>
          <th scope="col">{t('sheetFormula.names.scope')}</th>
          <th scope="col">{t('sheetFormula.names.comment')}</th>
          <td />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.table}:${row.name}`}>
            <th scope="row">{row.name}</th>
            <td>={row.ref}</td>
            <ScopeCell row={row} />
            <td>{row.comment}</td>
            <td>
              <Button variant="quiet" onClick={() => remove(row)}>
                {t('sheetFormula.names.remove', { name: row.name })}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Field({ label, value, set }: { label: string; value: string; set(value: string): void }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} className={styles.field} value={value} onChange={(e) => set(e.currentTarget.value)} />
    </>
  );
}

/** The form that defines a name. `define` returns true when the name was stored, so the form clears. */
function DefineForm({ define }: { define(definition: Definition): Promise<boolean> }) {
  const [entry, setEntry] = useState<Definition>({ name: '', ref: '', scope: 'table', comment: '' });
  const set = (key: keyof Definition) => (value: string) => setEntry((old) => ({ ...old, [key]: value }));
  const scope = useId();
  const submit = async () => {
    if (await define(entry)) setEntry({ name: '', ref: '', scope: entry.scope, comment: '' });
  };
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label={t('sheetFormula.names.name')} value={entry.name} set={set('name')} />
      <Field label={t('sheetFormula.names.ref')} value={entry.ref} set={set('ref')} />
      <label htmlFor={scope}>{t('sheetFormula.names.scope')}</label>
      <select
        id={scope}
        className={styles.field}
        value={entry.scope}
        onChange={(e) => set('scope')(e.currentTarget.value)}
      >
        <option value="table">{t('sheetFormula.names.scopeTable')}</option>
        <option value="page">{t('sheetFormula.names.scopePage')}</option>
      </select>
      <Field label={t('sheetFormula.names.comment')} value={entry.comment ?? ''} set={set('comment')} />
      <Button variant="primary" type="submit">
        {t('sheetFormula.names.define')}
      </Button>
    </form>
  );
}

export default function NameManager({ host, active, onClose }: DialogProps) {
  const [, setVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const { hosts, own } = pageHosts(host);
  const sheets: Sheet[] = hosts.map((h) => readSheet(h.data()));

  /** Stores a table's new sheet as one undo step. */
  const write = async (target: TableExtraHost, before: Sheet, after: Sheet) => {
    const patch = sheetPatch(before, after);
    if (patch) await target.patch(patch);
    setVersion((v) => v + 1);
  };
  const define = async (definition: Definition) => {
    const done = defineName(sheets, own, { ...definition, scope: definition.scope === 'page' ? 'page' : 'table' });
    setMessage('refused' in done ? refusalText(done.refused, definition.name) : null);
    if ('refused' in done) return false;
    await write(host, sheets[own] ?? {}, done.sheet);
    return true;
  };
  const fromSelection = async (from: 'top' | 'left') => {
    if (!active) return;
    let sheet = sheets[own] ?? {};
    let count = 0;
    for (const definition of namesFromSelection(textsOf(host.editor.state.doc), active.box, active.header, from)) {
      const done = defineName(
        sheets.map((one, i) => (i === own ? sheet : one)),
        own,
        definition,
      );
      if ('sheet' in done) [sheet, count] = [done.sheet, count + 1];
    }
    await write(host, sheets[own] ?? {}, sheet);
    setMessage(count > 0 ? t('sheetFormula.names.created', { count }) : t('sheetFormula.names.createdNone'));
  };
  const remove = (row: NameRow) =>
    void write(hosts[row.table] ?? host, sheets[row.table] ?? {}, removeName(sheets[row.table] ?? {}, row.name));

  return (
    <Dialog
      title={t('sheetFormula.names.title')}
      size="large"
      onDismiss={onClose}
      actions={[{ id: 'close', label: t('sheetFormula.names.close'), variant: 'secondary', onPress: onClose }]}
    >
      <NameTable rows={nameRows(sheets, own)} remove={remove} />
      <DefineForm define={define} />
      <div role="group" aria-label={t('sheetFormula.names.fromSelection')} className={styles.tools}>
        <Button onClick={() => void fromSelection('top')} disabled={!active}>
          {t('sheetFormula.names.topRow')}
        </Button>
        <Button onClick={() => void fromSelection('left')} disabled={!active}>
          {t('sheetFormula.names.leftColumn')}
        </Button>
      </div>
      {message ? <p role="status">{message}</p> : null}
    </Dialog>
  );
}
