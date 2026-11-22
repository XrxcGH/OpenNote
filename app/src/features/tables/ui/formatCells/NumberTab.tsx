// The Number tab: the category list, the options of the chosen category, and for Custom a code field that says
// where a code breaks. The codes and the checks are numberTab.ts; this file draws them.
import { t } from '../../../../strings/t';
import type { Locale } from '../../engine/locale';
import { localizeCode } from '../../engine/numfmt';
import { Field, NumberInput, Select } from './controls';
import {
  CATEGORIES,
  DEFAULT_OPTIONS,
  FRACTION_PATTERNS,
  MAX_DECIMALS,
  SPECIAL_LABELS,
  TIME_PATTERNS,
  checkCode,
  MAX_CODE,
  codeFor,
  datePatterns,
  previewCode,
  regionSymbol,
} from './numberCodes';
import type { Category, CodeCheck, Negative, NumberOptions } from './numberCodes';
import styles from './formatCells.module.css';

const NEGATIVES: readonly Negative[] = ['minus', 'red', 'paren', 'redParen'];
const WITH_DECIMALS: readonly Category[] = ['number', 'currency', 'accounting', 'percent', 'scientific'];

/** What the tab edits: the category, its options, and the typed code of Custom. */
export interface NumberFormat {
  category: Category;
  options: NumberOptions;
  custom: string;
}

export interface NumberTabProps {
  format: NumberFormat;
  setFormat(next: NumberFormat): void;
  locale: Locale;
  usedCodes: readonly string[];
  sample: number;
  initialCode: string | undefined;
}

/** The patterns a list category offers. */
function patternsOf(category: Category, locale: Locale): readonly string[] {
  if (category === 'date') return datePatterns(locale);
  if (category === 'time') return TIME_PATTERNS;
  return category === 'fraction' ? FRACTION_PATTERNS : [];
}

/** The sentence for a bad code: what is wrong and, where known, the position (counted from 1). */
function problemText(checked: CodeCheck | null): string | undefined {
  if (!checked || checked.ok || !checked.error) return undefined;
  const problem = t(`sheetFormat.number.error.${checked.error}`);
  if (checked.at === undefined) return t('sheetFormat.number.errorPlain', { problem });
  return t('sheetFormat.number.errorAt', { problem, position: checked.at + 1 });
}

type Change = (next: Partial<NumberOptions>) => void;

function Options({ category, options, change }: { category: Category; options: NumberOptions; change: Change }) {
  return (
    <>
      {WITH_DECIMALS.includes(category) ? (
        <NumberInput
          label={t('sheetFormat.number.decimals')}
          value={options.decimals}
          min={0}
          max={MAX_DECIMALS}
          onChange={(n) => change({ decimals: n ?? DEFAULT_OPTIONS.decimals })}
        />
      ) : null}
      {category === 'number' ? (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={options.thousands}
            onChange={(e) => change({ thousands: e.target.checked })}
          />
          {t('sheetFormat.number.thousands')}
        </label>
      ) : null}
      {category === 'currency' || category === 'accounting' ? (
        <Field label={t('sheetFormat.number.symbol')}>
          {(id) => (
            <input
              id={id}
              className={styles.input}
              value={options.symbol}
              maxLength={8}
              placeholder={t('sheetFormat.number.noSymbol')}
              onChange={(e) => change({ symbol: e.target.value })}
            />
          )}
        </Field>
      ) : null}
      {category === 'number' || category === 'currency' ? (
        <Select
          label={t('sheetFormat.number.negative')}
          value={options.negative}
          values={NEGATIVES}
          name={(v) => t(`sheetFormat.number.neg.${v}`)}
          onChange={(v) => change({ negative: v })}
        />
      ) : null}
    </>
  );
}

interface PatternsProps {
  category: Category;
  options: NumberOptions;
  locale: Locale;
  sample: number;
  change: Change;
}

/** The list of a date, time, fraction, or special category. Each entry shows the sample in that pattern. */
function Patterns({ category, options, locale, sample, change }: PatternsProps) {
  const patterns = patternsOf(category, locale);
  const count = category === 'special' ? SPECIAL_LABELS.length : patterns.length;
  if (count === 0) return null;
  const name = (i: number): string => {
    if (category === 'special') return t(SPECIAL_LABELS[i]);
    const code = patterns[i];
    return `${previewCode(code, sample, locale) ?? code}  (${localizeCode(code, locale)})`;
  };
  return (
    <Field label={t('sheetFormat.number.pattern')}>
      {(id) => (
        <select
          id={id}
          className={styles.input}
          size={Math.min(count, 7)}
          value={options.pattern}
          onChange={(e) => change({ pattern: Number(e.target.value) })}
        >
          {Array.from({ length: count }, (_, i) => (
            <option key={i} value={i}>
              {name(i)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

interface CustomProps {
  custom: string;
  problem: string | undefined;
  locale: Locale;
  usedCodes: readonly string[];
  onCode(code: string): void;
}

/** The code field, its error with the position, and the codes the page uses. */
function Custom({ custom, problem, locale, usedCodes, onCode }: CustomProps) {
  return (
    <>
      <Field label={t('sheetFormat.number.code')}>
        {(id) => (
          <input
            id={id}
            className={styles.input}
            value={custom}
            spellCheck={false}
            maxLength={MAX_CODE}
            aria-invalid={problem !== undefined}
            onChange={(e) => onCode(e.target.value)}
          />
        )}
      </Field>
      <p className={problem ? styles.error : styles.help} role={problem ? 'alert' : undefined}>
        {problem ?? t('sheetFormat.number.codeHelp')}
      </p>
      <div className={styles.field}>
        <span>{t('sheetFormat.number.used')}</span>
        {usedCodes.length === 0 ? (
          <p className={styles.help}>{t('sheetFormat.number.usedNone')}</p>
        ) : (
          <ul className={styles.codes}>
            {usedCodes.map((code) => (
              <li key={code}>
                <button
                  type="button"
                  className={styles.codeButton}
                  aria-label={t('sheetFormat.number.useCode', { code: localizeCode(code, locale) })}
                  onClick={() => onCode(localizeCode(code, locale))}
                >
                  {localizeCode(code, locale)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** The format the tab holds after a pick of another category: its options carry over where they mean the same. */
function picked(format: NumberFormat, next: Category, locale: Locale, initialCode: string | undefined): NumberFormat {
  const { category, options } = format;
  const here = codeFor(category, options, locale) ?? initialCode ?? '';
  const symbol = next === 'currency' || next === 'accounting' ? options.symbol || regionSymbol(locale) : options.symbol;
  const decimals =
    next === 'percent' || next === 'scientific' ? (category === next ? options.decimals : 2) : options.decimals;
  return {
    category: next,
    options: { ...options, symbol, decimals, pattern: 0 },
    custom: next === 'custom' ? localizeCode(here, locale) : format.custom,
  };
}

export function NumberTab(props: NumberTabProps) {
  const { format, setFormat, locale, usedCodes, sample, initialCode } = props;
  const { category, options, custom } = format;
  const change: Change = (next) => setFormat({ ...format, options: { ...options, ...next } });
  const checked = category === 'custom' ? checkCode(custom, locale) : null;
  const code = category === 'custom' ? (checked?.ok ? checked.code : undefined) : codeFor(category, options, locale);
  const shown = previewCode(code ?? '', sample, locale) ?? '';
  return (
    <div className={styles.numberTab}>
      <Field label={t('sheetFormat.number.category')}>
        {(id) => (
          <select
            id={id}
            size={CATEGORIES.length}
            className={styles.categories}
            value={category}
            onChange={(e) => setFormat(picked(format, e.target.value as Category, locale, initialCode))}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`sheetFormat.number.cat.${c}`)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className={styles.grid}>
        <p className={styles.sample} aria-live="polite">
          <span>{t('sheetFormat.number.sample')}</span> <output data-testid="number-sample">{shown}</output>
        </p>
        {category === 'general' ? <p>{t('sheetFormat.number.note.general')}</p> : null}
        {category === 'text' ? <p>{t('sheetFormat.number.note.text')}</p> : null}
        <Options category={category} options={options} change={change} />
        <Patterns category={category} options={options} locale={locale} sample={sample} change={change} />
        {category === 'custom' ? (
          <Custom
            custom={custom}
            problem={problemText(checked)}
            locale={locale}
            usedCodes={usedCodes}
            onCode={(next) => setFormat({ ...format, custom: next })}
          />
        ) : null}
      </div>
    </div>
  );
}
