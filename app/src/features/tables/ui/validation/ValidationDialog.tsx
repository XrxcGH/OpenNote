// The Data validation dialog: pick what a cell may hold, the values it is compared with, an input message, and what
// happens on a value that does not fit. Saving gives the rule to the caller, which writes it to data.sheet.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../../../strings/t';
import { Dialog } from '../../../../ui/Dialog';
import type { JsonObject } from '../../sheet/model';
import { COMPARES, KINDS, OPS, draftOf, ruleOf } from './draft';
import type { Draft, Problem } from './draft';
import styles from './validation.module.css';

export interface ValidationDialogProps {
  /** The ranges the rule covers, as `data.sheet` writes them, and how to say them ("B2:B20"). */
  ranges: readonly JsonObject[];
  rangeLabel: string;
  /** The rule there now, if any. */
  current?: JsonObject;
  onSave(rule: JsonObject): void;
  /** Removes the rule from these cells. */
  onClear?(): void;
  onCancel(): void;
}

const PROBLEM_KEY = {
  ranges: 'sheetValidation.problemRanges',
  items: 'sheetValidation.problemItems',
  operand: 'sheetValidation.problemOperand',
  order: 'sheetValidation.problemOrder',
  formula: 'sheetValidation.problemFormula',
} as const;

/** What each section of the form reads and writes. */
interface Part {
  d: Draft;
  set<K extends keyof Draft>(key: K, value: Draft[K]): void;
  text(key: keyof Draft): (e: { target: { value: string } }) => void;
}

function Field(props: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={styles.row}>
      <label htmlFor={id} className={styles.label}>
        {props.label}
      </label>
      {props.children(id)}
    </div>
  );
}

function Check(props: { label: string; checked: boolean; onChange(on: boolean): void }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

function Input(props: { label: string; field: keyof Draft; part: Part; max?: number; hint?: string }) {
  const { label, field, part, max, hint } = props;
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          className={styles.control}
          maxLength={max}
          placeholder={hint}
          value={String(part.d[field])}
          onChange={part.text(field)}
        />
      )}
    </Field>
  );
}

function Area(props: { label: string; field: keyof Draft; part: Part; rows: number; max?: number }) {
  const { label, field, part, rows, max } = props;
  return (
    <Field label={label}>
      {(id) => (
        <textarea
          id={id}
          className={styles.control}
          rows={rows}
          maxLength={max}
          value={String(part.d[field])}
          onChange={part.text(field)}
        />
      )}
    </Field>
  );
}

function Pick<T extends string>(props: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange(v: string): void;
}) {
  return (
    <Field label={props.label}>
      {(id) => (
        <select id={id} className={styles.control} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
          {props.options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function Compare({ part }: { part: Part }) {
  const two = part.d.op === 'between' || part.d.op === 'notBetween';
  return (
    <>
      <Pick
        label={t('sheetValidation.data')}
        value={part.d.op}
        options={OPS.map((o) => [o, t(`sheetValidation.op.${o}`)] as const)}
        onChange={(v) => part.set('op', v as Draft['op'])}
      />
      <div className={styles.pair}>
        <Input label={two ? t('sheetValidation.minimum') : t('sheetValidation.value')} field="a" part={part} />
        {two && <Input label={t('sheetValidation.maximum')} field="b" part={part} />}
      </div>
    </>
  );
}

function ListPart({ part }: { part: Part }) {
  const { d } = part;
  return (
    <>
      <Pick
        label={t('sheetValidation.listFrom')}
        value={d.listFrom}
        options={[
          ['items', t('sheetValidation.listFromItems')],
          ['range', t('sheetValidation.listFromRange')],
        ]}
        onChange={(v) => part.set('listFrom', v as Draft['listFrom'])}
      />
      {d.listFrom === 'items' ? (
        <Area label={t('sheetValidation.listItems')} field="itemsText" part={part} rows={5} />
      ) : (
        <Input
          label={t('sheetValidation.listSource')}
          field="source"
          part={part}
          hint={t('sheetValidation.placeholderRange')}
        />
      )}
      <Check label={t('sheetValidation.dropDown')} checked={d.dropDown} onChange={(on) => part.set('dropDown', on)} />
    </>
  );
}

function Messages({ part }: { part: Part }) {
  const { d } = part;
  return (
    <>
      <Check
        label={t('sheetValidation.showInput')}
        checked={d.showInput}
        onChange={(on) => part.set('showInput', on)}
      />
      {d.showInput && (
        <>
          <Input label={t('sheetValidation.inputTitle')} field="inputTitle" part={part} max={32} />
          <Area label={t('sheetValidation.inputText')} field="inputText" part={part} rows={2} max={255} />
        </>
      )}
      <Check
        label={t('sheetValidation.showError')}
        checked={d.showError}
        onChange={(on) => part.set('showError', on)}
      />
      {d.showError && (
        <>
          <Pick
            label={t('sheetValidation.alert')}
            value={d.alert}
            options={[
              ['stop', t('sheetValidation.alertStop')],
              ['warning', t('sheetValidation.alertWarning')],
              ['information', t('sheetValidation.alertInformation')],
            ]}
            onChange={(v) => part.set('alert', v as Draft['alert'])}
          />
          <Input label={t('sheetValidation.errorTitle')} field="errorTitle" part={part} max={32} />
          <Area label={t('sheetValidation.errorText')} field="errorText" part={part} rows={2} max={255} />
        </>
      )}
    </>
  );
}

function Fields({ part }: { part: Part }) {
  const { d } = part;
  return (
    <>
      <Pick
        label={t('sheetValidation.allow')}
        value={d.kind}
        options={KINDS.map((k) => [k, t(`sheetValidation.kind.${k}`)] as const)}
        onChange={(v) => part.set('kind', v as Draft['kind'])}
      />
      {COMPARES.includes(d.kind) && <Compare part={part} />}
      {d.kind === 'custom' && <Input label={t('sheetValidation.formula')} field="a" part={part} />}
      {d.kind === 'list' && <ListPart part={part} />}
      {d.kind === 'checkbox' && (
        <div className={styles.pair}>
          <Input label={t('sheetValidation.checkedValue')} field="checked" part={part} />
          <Input label={t('sheetValidation.uncheckedValue')} field="unchecked" part={part} />
        </div>
      )}
      {d.kind !== 'any' && (
        <Check
          label={t('sheetValidation.ignoreBlank')}
          checked={d.ignoreBlank}
          onChange={(on) => part.set('ignoreBlank', on)}
        />
      )}
      <Messages part={part} />
    </>
  );
}

export function ValidationDialog(props: ValidationDialogProps) {
  const { ranges, rangeLabel, current, onSave, onClear, onCancel } = props;
  const [d, setD] = useState<Draft>(() => draftOf(current));
  const [problems, setProblems] = useState<Problem[]>([]);
  const part: Part = {
    d,
    set: (key, value) => setD((was) => ({ ...was, [key]: value })),
    text: (key) => (e) => setD((was) => ({ ...was, [key]: e.target.value })),
  };

  const save = () => {
    const made = ruleOf(d, ranges);
    if ('rule' in made) onSave(made.rule);
    else setProblems(made.problems);
  };
  const clear = onClear
    ? [{ id: 'clear', label: t('sheetValidation.clearAll'), variant: 'quiet' as const, onPress: onClear }]
    : [];

  return (
    <Dialog
      title={t('sheetValidation.title')}
      onDismiss={onCancel}
      size="medium"
      actions={[
        ...clear,
        { id: 'cancel', label: t('sheetValidation.cancel'), variant: 'secondary', onPress: onCancel },
        { id: 'save', label: t('sheetValidation.save'), variant: 'primary', onPress: save },
      ]}
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className={styles.row}>
          <span className={styles.label}>{t('sheetValidation.applyTo')}</span>
          <span>{rangeLabel}</span>
        </div>
        <Fields part={part} />
        {problems.map((p) => (
          <p key={p} role="alert" className={styles.problem}>
            {t(PROBLEM_KEY[p])}
          </p>
        ))}
      </form>
    </Dialog>
  );
}
