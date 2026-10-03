// Settings, then Editing, then Page extras: the caret, typewriter scrolling, pasted images, link titles, and what
// shows under the page. These choices belong to this PC, so they are kept on the device (qol/prefs.ts).
import { useState } from 'react';
import { useFlag } from '../../../app/flags';
import { t } from '../../../strings/t';
import { RadioCard, RadioGroup, Switch, TextField } from '../../../ui';
import { setPrefs, usePrefs } from '../qol/prefs';
import type { PasteSize } from '../qol/prefs';
import styles from '../spelling/parts.module.css';

/** A whole number in a range, kept as text while the person types. */
function NumberField(props: {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  const { label, help, value, min, max, onChange } = props;
  const [text, setText] = useState(String(value));
  // A value that changed elsewhere replaces the text; typing a valid number changes the value to match it.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  const parsed = Number(text);
  const valid = /^\d+$/.test(text.trim()) && parsed >= min && parsed <= max;
  return (
    <TextField
      label={label}
      help={help}
      value={text}
      error={valid ? undefined : `${min} to ${max}`}
      onChange={(next) => {
        setText(next);
        const number = Number(next);
        if (/^\d+$/.test(next.trim()) && number >= min && number <= max) onChange(number);
      }}
    />
  );
}

function CaretPart() {
  const prefs = usePrefs((value) => value);
  return (
    <>
      <h3>{t('pageExtras.caret.title')}</h3>
      <Switch
        label={t('pageExtras.caret.windows')}
        checked={prefs.caretFollowsWindows}
        onChange={(caretFollowsWindows) => setPrefs({ caretFollowsWindows })}
      />
      <p className={styles.help}>{t('pageExtras.caret.windowsHelp')}</p>
      {!prefs.caretFollowsWindows && (
        <NumberField
          label={t('pageExtras.caret.width')}
          help={t('pageExtras.caret.widthHelp')}
          value={prefs.caretWidth}
          min={1}
          max={6}
          onChange={(caretWidth) => setPrefs({ caretWidth })}
        />
      )}
      <Switch
        label={t('pageExtras.caret.steady')}
        checked={prefs.caretSteady}
        onChange={(caretSteady) => setPrefs({ caretSteady })}
      />
      <p className={styles.help}>{t('pageExtras.caret.steadyHelp')}</p>
    </>
  );
}

function TypewriterPart() {
  const prefs = usePrefs((value) => value);
  return (
    <>
      <h3>{t('pageExtras.typewriter.title')}</h3>
      <Switch
        label={t('pageExtras.typewriter.on')}
        checked={prefs.typewriter}
        onChange={(typewriter) => setPrefs({ typewriter })}
      />
      <p className={styles.help}>{t('pageExtras.typewriter.help')}</p>
      {prefs.typewriter && (
        <NumberField
          label={t('pageExtras.typewriter.at')}
          help={t('pageExtras.typewriter.atHelp')}
          value={prefs.typewriterAt}
          min={20}
          max={80}
          onChange={(typewriterAt) => setPrefs({ typewriterAt })}
        />
      )}
    </>
  );
}

function PasteSizePart() {
  const size = usePrefs((value) => value.pasteSize);
  return (
    <>
      <h3>{t('pageExtras.pasteSize.title')}</h3>
      <RadioGroup<PasteSize>
        label={t('pageExtras.pasteSize.title')}
        value={size}
        onChange={(pasteSize) => setPrefs({ pasteSize })}
      >
        <RadioCard<PasteSize> value="fit" label={t('pageExtras.pasteSize.fit')} />
        <RadioCard<PasteSize> value="actual" label={t('pageExtras.pasteSize.actual')} />
        <RadioCard<PasteSize> value="ask" label={t('pageExtras.pasteSize.ask')} />
      </RadioGroup>
      <p className={styles.help}>{t('pageExtras.pasteSize.help')}</p>
    </>
  );
}

function LinkTitlesPart() {
  const on = usePrefs((value) => value.linkTitles);
  return (
    <>
      <h3>{t('pageExtras.linkTitles.title')}</h3>
      <Switch label={t('pageExtras.linkTitles.on')} checked={on} onChange={(linkTitles) => setPrefs({ linkTitles })} />
      <p className={styles.help}>{t('pageExtras.linkTitles.help')}</p>
    </>
  );
}

export default function EditingExtras() {
  const caret = useFlag('page.thickCaret');
  const typewriter = useFlag('page.typewriter');
  const pasteSize = useFlag('page.pasteSize');
  const linkTitles = useFlag('page.linkTitles');
  const checklist = useFlag('page.checklistExtras');
  const words = useFlag('page.wordCount');
  const series = useFlag('page.series');
  const prefs = usePrefs((value) => value);
  return (
    <section className={styles.part} aria-labelledby="editing-extras">
      <h2 id="editing-extras">{t('pageExtras.settings.title')}</h2>
      {caret && <CaretPart />}
      {typewriter && <TypewriterPart />}
      {pasteSize && <PasteSizePart />}
      {linkTitles && <LinkTitlesPart />}
      {checklist && (
        <Switch
          label={t('pageExtras.settings.doneCount')}
          checked={prefs.doneCount}
          onChange={(doneCount) => setPrefs({ doneCount })}
        />
      )}
      {series && (
        <Switch
          label={t('pageExtras.settings.seriesCarry')}
          checked={prefs.seriesCarry}
          onChange={(seriesCarry) => setPrefs({ seriesCarry })}
        />
      )}
      {words && (
        <Switch
          label={t('pageExtras.settings.wordCount')}
          checked={prefs.wordCount}
          onChange={(wordCount) => setPrefs({ wordCount })}
        />
      )}
    </section>
  );
}
