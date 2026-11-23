// The Cell styles dialog: the built-in and custom styles with a sample of each, Apply to the selected cells, and
// edit of the chosen style's fill, text color, bold, and italic (every cell that uses it follows, as one change).
// "New style from the selected cell" keeps the cell's formatting under a name.
import { useId, useState } from 'react';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { Dialog } from '../../../../ui/Dialog';
import { ColorPalette } from '../../../../ui/color';
import type { ColorPick } from '../../../../ui/color';
import type { Scheme } from '../../../../ui/color/parse';
import type { StyleChange } from '../../sheet/model';
import { previewCss } from '../formatCells/preview';
import type { NamedStyle } from './named';
import { validName } from './named';
import formats from '../formatCells/formatCells.module.css';
import styles from './styles.module.css';

export interface CellStylesProps {
  list: readonly NamedStyle[];
  uses(key: string): number;
  /** False when no cells are selected, so Apply and New are not offered. */
  hasSelection: boolean;
  scheme: Scheme;
  notebookId: string;
  /** A name for a new style, free of the names taken. */
  suggestName: string;
  onApply(key: string): void;
  onChange(key: string, change: StyleChange): void;
  onAdd(name: string): void;
  onRemove(key: string): void;
  onClose(): void;
}

/** The name shown for a style: the built-in's own, or the custom name. */
export const labelOf = (item: { key: string; builtin: boolean }): string =>
  item.builtin ? t(`sheetFormat.styles.builtin.${item.key}` as MessageKey) : item.key;

type Pen = 'fill' | 'text' | null;

interface ListProps {
  list: readonly NamedStyle[];
  chosen: string;
  scheme: Scheme;
  onChoose(key: string): void;
  onApply(key: string): void;
}

/** One sample button per style, drawn in the style. A double click applies it. */
function StyleList({ list, chosen, scheme, onChoose, onApply }: ListProps) {
  return (
    <ul className={styles.list} aria-label={t('sheetFormat.styles.list')}>
      {list.map((one) => (
        <li key={one.key}>
          <button
            type="button"
            className={styles.sample}
            aria-pressed={one.key === chosen}
            style={previewCss(one.style, one.style.border ?? {}, scheme)}
            onClick={() => onChoose(one.key)}
            onDoubleClick={() => onApply(one.key)}
          >
            {labelOf(one)}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface EditorProps {
  item: NamedStyle;
  uses: number;
  scheme: Scheme;
  notebookId: string;
  onChange(change: StyleChange): void;
  onRemove(): void;
}

/** Fill, text color, bold, and italic of the chosen style, and the way back to the original or out of the list. */
function StyleEditor({ item, uses, scheme, notebookId, onChange, onRemove }: EditorProps) {
  const [pen, setPen] = useState<Pen>(null);
  const { style } = item;
  const pick = (kind: 'fill' | 'text') => (choice: ColorPick) => {
    const value = choice.kind === 'color' ? choice.value : null;
    onChange(kind === 'fill' ? { fill: value } : { font: { color: value } });
    setPen(null);
  };
  const toggle = (which: 'fill' | 'text', label: MessageKey) => (
    <button
      type="button"
      className={formats.preset}
      aria-expanded={pen === which}
      onClick={() => setPen(pen === which ? null : which)}
    >
      {t(label)}
    </button>
  );
  const flag = (key: 'bold' | 'italic', label: MessageKey) => (
    <label className={formats.check}>
      <input
        type="checkbox"
        checked={style.font?.[key] === true}
        onChange={(e) => onChange({ font: { [key]: e.target.checked ? true : null } })}
      />
      {t(label)}
    </label>
  );
  return (
    <>
      <p className={formats.help}>{t('sheetFormat.styles.uses', { count: uses })}</p>
      {item.builtin ? <p className={formats.help}>{t('sheetFormat.styles.builtinNote')}</p> : null}
      <div className={styles.row}>
        {toggle('fill', 'sheetFormat.styles.fillLabel')}
        {toggle('text', 'sheetFormat.styles.fontColor')}
        {flag('bold', 'sheetFormat.styles.bold')}
        {flag('italic', 'sheetFormat.styles.italic')}
      </div>
      {pen ? (
        <div className={formats.palette}>
          <ColorPalette
            scheme={scheme}
            notebookId={notebookId}
            automatic={pen === 'text'}
            noColor={pen === 'fill'}
            current={pen === 'fill' ? (typeof style.fill === 'string' ? style.fill : undefined) : style.font?.color}
            onPick={pick(pen)}
          />
        </div>
      ) : null}
      {item.stored ? (
        <div className={styles.row}>
          <button type="button" className={formats.preset} onClick={onRemove}>
            {item.builtin ? t('sheetFormat.styles.revert') : t('sheetFormat.styles.remove')}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** The name field and the button that keeps the selected cell's formatting under that name. */
function NewStyle(props: { suggest: string; enabled: boolean; onAdd(name: string): void }) {
  const [name, setName] = useState(props.suggest);
  const id = useId();
  const valid = validName(name);
  return (
    <div className={formats.field}>
      <label htmlFor={id}>{t('sheetFormat.styles.name')}</label>
      <input
        id={id}
        className={formats.input}
        value={name}
        maxLength={60}
        aria-invalid={!valid}
        onChange={(e) => setName(e.target.value)}
      />
      {!valid ? <p className={formats.error}>{t('sheetFormat.styles.nameInvalid')}</p> : null}
      <button
        type="button"
        className={formats.preset}
        disabled={!props.enabled || !valid}
        onClick={() => props.onAdd(name.trim())}
      >
        {t('sheetFormat.styles.add')}
      </button>
    </div>
  );
}

export function CellStyles(props: CellStylesProps) {
  const { list, hasSelection, scheme, notebookId, onClose } = props;
  const [chosen, setChosen] = useState(list.find((s) => s.key === 'good')?.key ?? list[0].key);
  const item = list.find((s) => s.key === chosen) ?? list[0];
  return (
    <Dialog
      title={t('sheetFormat.styles.title')}
      size="large"
      onDismiss={onClose}
      actions={[
        { id: 'close', label: t('sheetFormat.styles.close'), variant: 'secondary', onPress: onClose },
        {
          id: 'apply',
          label: t('sheetFormat.styles.apply'),
          variant: 'primary',
          disabled: !hasSelection,
          onPress: () => props.onApply(item.key),
        },
      ]}
    >
      <div className={styles.layout}>
        <StyleList
          list={list}
          chosen={item.key}
          scheme={scheme}
          onChoose={setChosen}
          onApply={(key) => hasSelection && props.onApply(key)}
        />
        <div className={styles.details}>
          <h3 className={styles.heading}>{t('sheetFormat.styles.editing', { name: labelOf(item) })}</h3>
          <StyleEditor
            key={item.key}
            item={item}
            uses={props.uses(item.key)}
            scheme={scheme}
            notebookId={notebookId}
            onChange={(change) => props.onChange(item.key, change)}
            onRemove={() => props.onRemove(item.key)}
          />
          <NewStyle suggest={props.suggestName} enabled={hasSelection} onAdd={props.onAdd} />
        </div>
      </div>
    </Dialog>
  );
}
