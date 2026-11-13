// The conditional formatting rule manager: the rules of the selection, the table, or the page in priority order,
// with raise, lower, stop if true, and delete. It shows what the caller gives it and reports each change, so the
// table's editor applies the change as one undo step (manage.ts works out the patch).

import { useId } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui/Button';
import { Switch } from '../../../../ui/Switch';
import { refOf, type ManagedRule, type RuleRef, type Scope } from './manage';
import styles from './RuleManager.module.css';

export interface RuleManagerProps {
  rules: readonly ManagedRule[];
  scope: Scope;
  onScope(scope: Scope): void;
  onMove(rule: RuleRef, by: -1 | 1): void;
  onStop(rule: RuleRef, stop: boolean): void;
  onRemove(rule: RuleRef): void;
  onDone?(): void;
}

const SCOPES: readonly Scope[] = ['selection', 'table', 'page'];

export function RuleManager(props: RuleManagerProps) {
  const { rules, scope, onScope, onMove, onStop, onRemove, onDone } = props;
  const heading = useId();
  const select = useId();
  const label: Record<Scope, string> = {
    selection: t('sheetConditional.manager.scopeSelection'),
    table: t('sheetConditional.manager.scopeTable'),
    page: t('sheetConditional.manager.scopePage'),
  };
  return (
    <section className={styles.manager} aria-labelledby={heading}>
      <h2 id={heading} className={styles.title}>
        {t('sheetConditional.manager.title')}
      </h2>
      <div className={styles.scope}>
        <label htmlFor={select}>{t('sheetConditional.manager.scopeLabel')}</label>
        <select
          id={select}
          className={styles.select}
          value={scope}
          onChange={(event) => onScope(event.target.value as Scope)}
        >
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {label[s]}
            </option>
          ))}
        </select>
      </div>
      {rules.length === 0 ? (
        <p className={styles.empty}>{t('sheetConditional.manager.empty')}</p>
      ) : (
        <ol className={styles.list} aria-label={t('sheetConditional.manager.list')}>
          {rules.map((rule, i) => (
            <li key={`${rule.tableId ?? ''}:${rule.id}`} className={styles.rule}>
              <span className={styles.text}>
                {rule.summary}
                {rule.problem ? <span role="alert">{t('sheetConditional.manager.problem')}</span> : null}
                <span className={styles.ranges}>
                  {rule.tableLabel ? `${rule.tableLabel}. ` : ''}
                  {t('sheetConditional.manager.appliesTo', { ranges: rule.ranges })}
                </span>
              </span>
              <span className={styles.actions}>
                <Button
                  variant="quiet"
                  disabled={i === 0 || rules[i - 1].tableId !== rule.tableId}
                  onClick={() => onMove(refOf(rule), -1)}
                >
                  {t('sheetConditional.manager.moveUp')}
                </Button>
                <Button
                  variant="quiet"
                  disabled={i === rules.length - 1 || rules[i + 1].tableId !== rule.tableId}
                  onClick={() => onMove(refOf(rule), 1)}
                >
                  {t('sheetConditional.manager.moveDown')}
                </Button>
                <Switch
                  label={t('sheetConditional.manager.stop')}
                  checked={rule.stop}
                  onChange={(on) => onStop(refOf(rule), on)}
                />
                <Button variant="danger" onClick={() => onRemove(refOf(rule))}>
                  {t('sheetConditional.manager.remove')}
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {onDone ? (
        <Button variant="primary" onClick={onDone}>
          {t('sheetConditional.manager.done')}
        </Button>
      ) : null}
    </section>
  );
}
