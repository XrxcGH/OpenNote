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

export function ValidationDialog(props: ValidationDialogProps) {
  const { ranges, rangeLabel, current, onSave, onClear, onCancel } = props;
  const [d, setD] = useState<Draft>(() => draftOf(current));
  const [problems, setProblems] = useState<Problem[]>([]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((was) => ({ ...was, [key]: value }));
  const text = (key: keyof Draft) => (e: { target: { value: string } }) => set(key, e.target.value as never);

  const save = () => {
    const made = ruleOf(d, ranges);
    if ('rule' in made) onSave(made.rule);
    else setProblems(made.problems);
  };
  const two = d.op === 'between' || d.op === 'notBetween';

  return (
    <Dialog
      title={t('sheetValidation.title')}
      onDismiss={onCancel}
      size="medium"
      actions={[
        ...(onClear
          ? [{ id: 'clear', label: t('sheetValidation.clearAll'), variant: 'quiet' as const, onPress: onClear }]
          : []),
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
        <Field label={t('sheetValidation.allow')}>
          {(id) => (
            <select id={id} className={styles.control} value={d.kind} onChange={text('kind')}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`sheetValidation.kind.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>

        {COMPARES.includes(d.kind) && (
          <>
            <Field label={t('sheetValidation.data')}>
              {(id) => (
                <select id={id} className={styles.control} value={d.op} onChange={text('op')}>
                  {OPS.map((o) => (
                    <option key={o} value={o}>
                      {t(`sheetValidation.op.${o}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className={styles.pair}>
              <Field label={two ? t('sheetValidation.minimum') : t('sheetValidation.value')}>
                {(id) => <input id={id} className={styles.control} value={d.a} onChange={text('a')} />}
              </Field>
              {two && (
                <Field label={t('sheetValidation.maximum')}>
                  {(id) => <input id={id} className={styles.control} value={d.b} onChange={text('b')} />}
                </Field>
              )}
            </div>
          </>
        )}

        {d.kind === 'custom' && (
          <Field label={t('sheetValidation.formula')}>
            {(id) => (
              <input
                id={id}
                className={styles.control}
                value={d.a}
                placeholder={t('sheetValidation.placeholderFormula')}
                onChange={text('a')}
              />
            )}
          </Field>
        )}

        {d.kind === 'list' && (
          <>
            <Field label={t('sheetValidation.listFrom')}>
              {(id) => (
                <select id={id} className={styles.control} value={d.listFrom} onChange={text('listFrom')}>
                  <option value="items">{t('sheetValidation.listFromItems')}</option>
                  <option value="range">{t('sheetValidation.listFromRange')}</option>
                </select>
              )}
            </Field>
            {d.listFrom === 'items' ? (
              <Field label={t('sheetValidation.listItems')}>
                {(id) => (
                  <textarea
                    id={id}
                    className={styles.control}
                    rows={5}
                    value={d.itemsText}
                    onChange={text('itemsText')}
                  />
                )}
              </Field>
            ) : (
              <Field label={t('sheetValidation.listSource')}>
                {(id) => (
                  <input
                    id={id}
                    className={styles.control}
                    value={d.source}
                    placeholder={t('sheetValidation.placeholderRange')}
                    onChange={text('source')}
                  />
                )}
              </Field>
            )}
            <Check label={t('sheetValidation.dropDown')} checked={d.dropDown} onChange={(on) => set('dropDown', on)} />
          </>
        )}

        {d.kind === 'checkbox' && (
          <div className={styles.pair}>
            <Field label={t('sheetValidation.checkedValue')}>
              {(id) => <input id={id} className={styles.control} value={d.checked} onChange={text('checked')} />}
            </Field>
            <Field label={t('sheetValidation.uncheckedValue')}>
              {(id) => <input id={id} className={styles.control} value={d.unchecked} onChange={text('unchecked')} />}
            </Field>
          </div>
        )}

        {d.kind !== 'any' && (
          <Check
            label={t('sheetValidation.ignoreBlank')}
            checked={d.ignoreBlank}
            onChange={(on) => set('ignoreBlank', on)}
          />
        )}

        <Check label={t('sheetValidation.showInput')} checked={d.showInput} onChange={(on) => set('showInput', on)} />
        {d.showInput && (
          <>
            <Field label={t('sheetValidation.inputTitle')}>
              {(id) => (
                <input
                  id={id}
                  className={styles.control}
                  maxLength={32}
                  value={d.inputTitle}
                  onChange={text('inputTitle')}
                />
              )}
            </Field>
            <Field label={t('sheetValidation.inputText')}>
              {(id) => (
                <textarea
                  id={id}
                  className={styles.control}
                  rows={2}
                  maxLength={255}
                  value={d.inputText}
                  onChange={text('inputText')}
                />
              )}
            </Field>
          </>
        )}

        <Check label={t('sheetValidation.showError')} checked={d.showError} onChange={(on) => set('showError', on)} />
        {d.showError && (
          <>
            <Field label={t('sheetValidation.alert')}>
              {(id) => (
                <select id={id} className={styles.control} value={d.alert} onChange={text('alert')}>
                  <option value="stop">{t('sheetValidation.alertStop')}</option>
                  <option value="warning">{t('sheetValidation.alertWarning')}</option>
                  <option value="information">{t('sheetValidation.alertInformation')}</option>
                </select>
              )}
            </Field>
            <Field label={t('sheetValidation.errorTitle')}>
              {(id) => (
                <input
                  id={id}
                  className={styles.control}
                  maxLength={32}
                  value={d.errorTitle}
                  onChange={text('errorTitle')}
                />
              )}
            </Field>
            <Field label={t('sheetValidation.errorText')}>
              {(id) => (
                <textarea
                  id={id}
                  className={styles.control}
                  rows={2}
                  maxLength={255}
                  value={d.errorText}
                  onChange={text('errorText')}
                />
              )}
            </Field>
          </>
        )}

        {problems.map((p) => (
          <p key={p} role="alert" className={styles.problem}>
            {t(PROBLEM_KEY[p])}
          </p>
        ))}
      </form>
    </Dialog>
  );
}
