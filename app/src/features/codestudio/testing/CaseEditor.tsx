// The test case editor (DESIGN 9.1): an io, call, or sql case with its expected value, how it is compared, and its
// time limit. It writes one case into the project through the controller.
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import type { RefObject } from 'react';
import { Button, announce } from '../../../ui';
import { COMPARE_MODES, TEST_DEFAULTS } from '../contracts';
import type { CompareMode, CompareSpec, TestCase, TestKind } from '../contracts';
import { parseCallArgs } from './harness';
import styles from './testing.module.css';

/** The kinds a person adds by hand; `framework` cases are found in the code. */
export const EDITABLE_KINDS = ['io', 'call', 'sql'] as const satisfies readonly TestKind[];
type EditableKind = (typeof EDITABLE_KINDS)[number];

const MODE_KEY: Record<CompareMode, MessageKey> = {
  exact: 'codeStudio.testing.mode.exact',
  trim: 'codeStudio.testing.mode.trim',
  tokens: 'codeStudio.testing.mode.tokens',
  number: 'codeStudio.testing.mode.number',
  'lines-unordered': 'codeStudio.testing.mode.unordered',
  regex: 'codeStudio.testing.mode.regex',
};

export interface Draft {
  name: string;
  kind: EditableKind;
  stdin: string;
  args: string;
  fn: string;
  callArgs: string;
  expected: string;
  mode: CompareMode;
  tolerance: string;
  seconds: string;
  rowsOrdered: boolean;
}

/** The draft of a stored case, or of a new one. */
export function draftOf(test: TestCase | null, number: number): Draft {
  const kind = test && test.kind !== 'framework' ? test.kind : 'io';
  return {
    name: test?.name ?? t('codeStudio.testing.editor.defaultName', { number }),
    kind,
    stdin: test?.stdin ?? '',
    args: (test?.args ?? []).join('\n'),
    fn: test?.fn ?? '',
    callArgs: test?.callArgs ?? '[]',
    expected: test?.expected ?? '',
    mode: test?.compare.mode ?? 'trim',
    tolerance:
      test?.compare.mode === 'number' && test.compare.tolerance !== undefined ? String(test.compare.tolerance) : '',
    seconds: test?.timeMs === undefined ? '' : String(test.timeMs / 1000),
    rowsOrdered: test?.rowsOrdered ?? false,
  };
}

const positive = (text: string): number | null => {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null;
};

/** The case a draft makes, with the ID and order it keeps or is given. */
export function caseOf(draft: Draft, id: string, order: number): TestCase {
  const tolerance = positive(draft.tolerance);
  const compare: CompareSpec =
    draft.mode === 'number' ? { mode: 'number', ...(tolerance === null ? {} : { tolerance }) } : { mode: draft.mode };
  const seconds = positive(draft.seconds);
  return {
    id,
    order,
    name: draft.name.trim() || t('codeStudio.testing.editor.defaultName', { number: order + 1 }),
    kind: draft.kind,
    expected: draft.expected,
    compare,
    ...(draft.kind === 'io' ? { stdin: draft.stdin, args: draft.args === '' ? [] : draft.args.split('\n') } : {}),
    ...(draft.kind === 'call' ? { fn: draft.fn.trim(), callArgs: draft.callArgs.trim() } : {}),
    ...(draft.kind === 'sql' ? { rowsOrdered: draft.rowsOrdered } : {}),
    ...(seconds === null ? {} : { timeMs: Math.round(seconds * 1000) }),
  };
}

type SetDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

interface FieldsProps {
  draft: Draft;
  set: SetDraft;
  base: string;
}

function IoFields({ draft, set }: FieldsProps) {
  return (
    <div className={styles.row}>
      <label className={styles.field}>
        <span>{t('codeStudio.testing.editor.stdin')}</span>
        <textarea rows={3} value={draft.stdin} onChange={(event) => set('stdin', event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>{t('codeStudio.testing.editor.args')}</span>
        <textarea rows={3} value={draft.args} onChange={(event) => set('args', event.target.value)} />
      </label>
    </div>
  );
}

function CallFields({ draft, set, base, canCall }: FieldsProps & { canCall: boolean }) {
  const badArgs = parseCallArgs(draft.callArgs) === null;
  return (
    <div className={styles.row}>
      <label className={styles.field}>
        <span>{t('codeStudio.testing.editor.fn')}</span>
        <input
          value={draft.fn}
          spellCheck={false}
          aria-describedby={`${base}-fn`}
          onChange={(event) => set('fn', event.target.value)}
        />
        <small id={`${base}-fn`}>{t('codeStudio.testing.editor.fnHelp')}</small>
      </label>
      <label className={styles.field}>
        <span>{t('codeStudio.testing.editor.callArgs')}</span>
        <input
          value={draft.callArgs}
          spellCheck={false}
          aria-invalid={badArgs ? true : undefined}
          aria-describedby={`${base}-args`}
          onChange={(event) => set('callArgs', event.target.value)}
        />
        <small id={`${base}-args`} role={badArgs ? 'alert' : undefined}>
          {badArgs ? t('codeStudio.testing.editor.badJson') : t('codeStudio.testing.editor.callArgsHelp')}
        </small>
      </label>
      {!canCall && <p className={styles.note}>{t('codeStudio.testing.editor.callNeedsRuntime')}</p>}
    </div>
  );
}

function CompareFields({ draft, set, base }: FieldsProps) {
  return (
    <div className={styles.row}>
      <label className={styles.field}>
        <span>{t('codeStudio.testing.editor.compare')}</span>
        <select value={draft.mode} onChange={(event) => set('mode', event.target.value as CompareMode)}>
          {COMPARE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(MODE_KEY[mode])}
            </option>
          ))}
        </select>
      </label>
      {draft.mode === 'number' && (
        <label className={styles.field}>
          <span>{t('codeStudio.testing.editor.tolerance')}</span>
          <input
            inputMode="decimal"
            value={draft.tolerance}
            placeholder={String(TEST_DEFAULTS.tolerance)}
            aria-describedby={`${base}-tol`}
            onChange={(event) => set('tolerance', event.target.value)}
          />
          <small id={`${base}-tol`}>{t('codeStudio.testing.editor.toleranceHelp')}</small>
        </label>
      )}
      {draft.kind === 'sql' && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.rowsOrdered}
            onChange={(event) => set('rowsOrdered', event.target.checked)}
          />
          <span>{t('codeStudio.testing.editor.rowsOrdered')}</span>
        </label>
      )}
    </div>
  );
}

function HeadFields({ draft, set, nameRef }: FieldsProps & { nameRef: RefObject<HTMLInputElement | null> }) {
  return (
    <div className={styles.row}>
      <label className={styles.field}>
        <span>{t('codeStudio.testing.editor.name')}</span>
        <input ref={nameRef} value={draft.name} onChange={(event) => set('name', event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>{t('codeStudio.testing.editor.kind')}</span>
        <select value={draft.kind} onChange={(event) => set('kind', event.target.value as EditableKind)}>
          {EDITABLE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`codeStudio.testing.kind.${kind}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>{t('codeStudio.testing.editor.timeLimit')}</span>
        <input
          inputMode="decimal"
          value={draft.seconds}
          placeholder={String(TEST_DEFAULTS.timeMs / 1000)}
          onChange={(event) => set('seconds', event.target.value)}
        />
      </label>
    </div>
  );
}

const EXPECTED_LABEL: Record<EditableKind, MessageKey> = {
  io: 'codeStudio.testing.editor.expected',
  call: 'codeStudio.testing.editor.expectedCall',
  sql: 'codeStudio.testing.editor.expectedSql',
};

/** True when the draft can be saved: a function case needs a name and arguments that are a JSON list. */
export const canSave = (draft: Draft) =>
  draft.kind !== 'call' || (draft.fn.trim() !== '' && parseCallArgs(draft.callArgs) !== null);

export interface CaseEditorProps {
  draft: Draft;
  /** True when the case already exists, so it can be deleted. */
  existing: boolean;
  /** Whether the project's runtime can run function cases. */
  canCall: boolean;
  onChange(draft: Draft): void;
  onSave(): void;
  onCancel(): void;
  onDelete(): void;
}

export function CaseEditor({ draft, existing, canCall, onChange, onSave, onCancel, onDelete }: CaseEditorProps) {
  const base = useId();
  const set: SetDraft = (key, value) => onChange({ ...draft, [key]: value });
  const shared = { draft, set, base };
  const valid = canSave(draft);
  const nameRef = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => nameRef.current?.focus(), []);
  return (
    <form
      className={styles.editor}
      aria-label={t('codeStudio.testing.editor.title')}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <HeadFields {...shared} nameRef={nameRef} />
      {draft.kind === 'io' && <IoFields {...shared} />}
      {draft.kind === 'call' && <CallFields {...shared} canCall={canCall} />}
      <label className={styles.field}>
        <span>{t(EXPECTED_LABEL[draft.kind])}</span>
        <textarea
          rows={3}
          value={draft.expected}
          spellCheck={false}
          onChange={(event) => set('expected', event.target.value)}
        />
      </label>
      <CompareFields {...shared} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={!valid} aria-describedby={valid ? undefined : `${base}-why`}>
          {t('codeStudio.testing.editor.save')}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t('codeStudio.testing.editor.cancel')}
        </Button>
        {existing && (
          <Button
            variant="danger"
            onClick={() => {
              if (confirming) onDelete();
              else {
                setConfirming(true);
                announce(t('codeStudio.testing.editor.confirmDelete'));
              }
            }}
          >
            {confirming ? t('codeStudio.testing.editor.confirmDeleteButton') : t('codeStudio.testing.editor.delete')}
          </Button>
        )}
      </div>
      {!valid && (
        <p id={`${base}-why`} className={styles.note}>
          {t('codeStudio.testing.editor.saveNeeds')}
        </p>
      )}
    </form>
  );
}
