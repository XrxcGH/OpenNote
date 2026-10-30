// The on-screen keyboards: choose a script, press keys to build text in the compose field, and insert it. A
// combining mark is shown on a dotted circle and joins the letter before it.
import { useState } from 'react';
import { t } from '../../../../strings/t';
import styles from '../ui/kit.module.css';
import { Choice, Field, InsertBar, Note, ht } from '../ui/parts';
import { PALETTES, codePoints, isCombining, keysOf } from './palettes';

const k = 'kitHumanities.scripts';

export function KeyboardPanel() {
  const [id, setId] = useState(PALETTES[0].id);
  const [text, setText] = useState('');
  const palette = PALETTES.find((p) => p.id === id) ?? PALETTES[0];
  const type = (key: string) => setText((before) => (before + key).normalize('NFC'));
  return (
    <>
      <Choice
        label={t(`${k}.keyboard`)}
        value={id}
        options={PALETTES.map((p) => ({ value: p.id, label: ht(`scripts.palettes.${p.id}`) }))}
        onChange={setId}
      />
      <Field label={t(`${k}.compose`)} value={text} onChange={setText} rows={2} hint={t(`${k}.composeHint`)} />
      {palette.groups.map((group) => (
        <fieldset key={group.id} className={styles.group}>
          <legend>{ht(`scripts.groups.${group.id}`)}</legend>
          <div className={styles.keys}>
            {keysOf(group.chars).map((key) => (
              <button
                key={key}
                type="button"
                className={styles.key}
                aria-label={t(`${k}.keyName`, { key, code: codePoints(key) })}
                onClick={() => type(key)}
              >
                {isCombining(key) ? `◌${key}` : key}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <Note>{t(`${k}.keyboardNote`)}</Note>
      {text ? <InsertBar payloads={{ answer: text }} /> : null}
    </>
  );
}
