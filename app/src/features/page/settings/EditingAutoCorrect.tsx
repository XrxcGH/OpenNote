// Settings, then Editing, then AutoCorrect (owner: WP4): the switch, and the list of replacements. The built-in
// list shows until the person changes it; their first change saves the whole list as their own.
import { useId, useState } from 'react';
import { DEFAULT_REPLACEMENTS } from '../../../editor/extensions/autocorrect';
import type { Replacement } from '../../../editor/extensions/autocorrect';
import { updateSettings, useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { Button, Switch, TextField } from '../../../ui';
import styles from './EditingTyping.module.css';

function save(entries: readonly Replacement[]): void {
  void updateSettings({ editing: { autocorrect: { entries: entries.map(({ from, to }) => ({ from, to })) } } });
}

function AddReplacement({ list }: { list: readonly Replacement[] }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const duplicate = from.trim() !== '' && list.some((entry) => entry.from === from.trim());
  const add = () => {
    if (from.trim() === '' || to === '' || duplicate) return;
    save([...list, { from: from.trim(), to }]);
    setFrom('');
    setTo('');
  };
  return (
    <form
      className={styles.add}
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <TextField
        label={t('editor.autocorrect.from')}
        value={from}
        onChange={setFrom}
        error={duplicate ? t('editor.autocorrect.duplicate', { from: from.trim() }) : undefined}
      />
      <TextField label={t('editor.autocorrect.to')} value={to} onChange={setTo} />
      <Button type="submit">{t('editor.autocorrect.add')}</Button>
    </form>
  );
}

export default function EditingAutoCorrect() {
  const autocorrect = useSettings((settings) => settings.editing.autocorrect);
  const hint = useId();
  const list: readonly Replacement[] = autocorrect.entries.length > 0 ? autocorrect.entries : DEFAULT_REPLACEMENTS;
  const custom = autocorrect.entries.length > 0;
  return (
    <section className={styles.part} aria-labelledby="editing-autocorrect">
      <h2 id="editing-autocorrect">{t('editor.autocorrect.title')}</h2>
      <Switch
        label={t('editor.autocorrect.enabled')}
        checked={autocorrect.enabled}
        describedBy={hint}
        onChange={(enabled) => void updateSettings({ editing: { autocorrect: { enabled } } })}
      />
      <p id={hint} className={styles.help}>
        {t('editor.autocorrect.enabledHint')}
      </p>
      <h3>{t('editor.autocorrect.list')}</h3>
      <table className={styles.list}>
        <thead>
          <tr>
            <th scope="col">{t('editor.autocorrect.from')}</th>
            <th scope="col">{t('editor.autocorrect.to')}</th>
            <td />
          </tr>
        </thead>
        <tbody>
          {list.map((entry) => (
            <tr key={entry.from}>
              <td>{entry.from}</td>
              <td>{entry.to}</td>
              <td>
                <Button variant="quiet" onClick={() => save(list.filter((other) => other.from !== entry.from))}>
                  {t('editor.autocorrect.remove', { from: entry.from })}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 ? <p className={styles.help}>{t('editor.autocorrect.empty')}</p> : null}
      <AddReplacement list={list} />
      {custom ? (
        <div className={styles.actions}>
          <Button onClick={() => save([])}>{t('editor.autocorrect.reset')}</Button>
        </div>
      ) : null}
    </section>
  );
}
