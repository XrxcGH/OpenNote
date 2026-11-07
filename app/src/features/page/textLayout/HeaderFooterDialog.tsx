// The Header, footer, and page numbers dialog. It edits what the page saves for print: `view.print.header` and
// `view.print.footer` with their first-page bands (R-PRN-1), `view.text.pageNumbers` (R-VIEW-3), and
// `view.text.lineNumbers` (R-VIEW-2). Saving sends one merge patch of the view.
import { useState } from 'react';
import {
  MAX_BAND_PART,
  PAGE_NUMBER_FORMATS,
  readLineNumbers,
  readPageNumbers,
  readSavedBands,
  type BandParts,
  type BandTemplate,
  type PageNumberFormat,
} from '../../pages';
import { t } from '../../../strings/t';
import { Dialog, Switch, TextField } from '../../../ui';
import { viewPatch, type FooterForm, type HeaderFooterForm } from './viewSettings';
import styles from './dialog.module.css';

type PartKey = 'left' | 'center' | 'right';
const PARTS: readonly PartKey[] = ['left', 'center', 'right'];

function parts(band: BandParts | undefined): Record<PartKey, string> {
  return { left: band?.left ?? '', center: band?.center ?? '', right: band?.right ?? '' };
}

/** The form's first values from the page's view. */
export function formFrom(view: unknown): HeaderFooterForm {
  const saved = readSavedBands(view);
  const numbers = readPageNumbers(view);
  const lines = readLineNumbers(view);
  const band = (b: BandTemplate | undefined): FooterForm => ({
    ...parts(b),
    first: b?.firstPage ? parts(b.firstPage) : null,
  });
  return {
    header: band(saved.header),
    footer: band(saved.footer),
    format: numbers.format,
    start: String(numbers.start),
    lines: lines !== null,
    countBy: String(lines?.countBy ?? 1),
    lineStart: String(lines?.start ?? 1),
    restart: lines?.restart ?? 'page',
  };
}

const whole = (text: string, min: number, max: number): boolean => {
  const n = Number(text);
  return text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max;
};

/** Whether every field holds a value the format allows. */
export function validForm(form: HeaderFooterForm): boolean {
  const bands = [form.header, form.footer].flatMap((b) => (b.first ? [b, b.first] : [b]));
  const long = bands.some((band) => PARTS.some((key) => band[key].length > MAX_BAND_PART));
  return (
    !long &&
    whole(form.start, 0, 32767) &&
    (!form.lines || (whole(form.countBy, 1, 100) && whole(form.lineStart, 1, 32767)))
  );
}

interface BandFieldsProps {
  readonly title: string;
  readonly firstTitle: string;
  readonly band: FooterForm;
  readonly onChange: (band: FooterForm) => void;
}

function PartRow(props: {
  readonly label: string;
  readonly values: Record<PartKey, string>;
  readonly set: (key: PartKey, value: string) => void;
}) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{props.label}</legend>
      <div className={styles.row}>
        {PARTS.map((key) => (
          <TextField
            key={key}
            label={t(`textLayout.dialog.${key}`)}
            value={props.values[key]}
            onChange={(value) => props.set(key, value)}
            error={
              props.values[key].length > MAX_BAND_PART
                ? t('textLayout.dialog.tooLong', { max: MAX_BAND_PART })
                : undefined
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

function BandFields({ title, firstTitle, band, onChange }: BandFieldsProps) {
  const first = band.first;
  return (
    <>
      <PartRow label={title} values={band} set={(key, value) => onChange({ ...band, [key]: value })} />
      {first ? (
        <PartRow
          label={firstTitle}
          values={first}
          set={(key, value) => onChange({ ...band, first: { ...first, [key]: value } })}
        />
      ) : null}
    </>
  );
}

interface NumberFieldsProps {
  readonly form: HeaderFooterForm;
  readonly setForm: (form: HeaderFooterForm) => void;
}

function PageNumberFields({ form, setForm }: NumberFieldsProps) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{t('textLayout.dialog.pageNumbers')}</legend>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{t('textLayout.dialog.format')}</span>
          <select
            value={form.format}
            onChange={(event) => setForm({ ...form, format: event.target.value as PageNumberFormat })}
          >
            {PAGE_NUMBER_FORMATS.map((format) => (
              <option key={format} value={format}>
                {t(`textLayout.dialog.formats.${format}`)}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label={t('textLayout.dialog.start')}
          value={form.start}
          onChange={(start) => setForm({ ...form, start })}
          error={whole(form.start, 0, 32767) ? undefined : t('textLayout.dialog.startError')}
        />
      </div>
    </fieldset>
  );
}

function LineNumberFields({ form, setForm }: NumberFieldsProps) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{t('textLayout.dialog.lineNumbersTitle')}</legend>
      <Switch
        label={t('textLayout.dialog.lineNumbersOn')}
        checked={form.lines}
        onChange={(lines) => setForm({ ...form, lines })}
      />
      {form.lines ? (
        <div className={styles.row}>
          <TextField
            label={t('textLayout.dialog.countBy')}
            value={form.countBy}
            onChange={(countBy) => setForm({ ...form, countBy })}
            error={whole(form.countBy, 1, 100) ? undefined : t('textLayout.dialog.countByError')}
          />
          <TextField
            label={t('textLayout.dialog.lineStart')}
            value={form.lineStart}
            onChange={(lineStart) => setForm({ ...form, lineStart })}
            error={whole(form.lineStart, 1, 32767) ? undefined : t('textLayout.dialog.lineStartError')}
          />
          <label className={styles.field}>
            <span>{t('textLayout.dialog.restart')}</span>
            <select
              value={form.restart}
              onChange={(event) => setForm({ ...form, restart: event.target.value as 'page' | 'continuous' })}
            >
              <option value="page">{t('textLayout.dialog.restartPage')}</option>
              <option value="continuous">{t('textLayout.dialog.restartContinuous')}</option>
            </select>
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

function NumberFields(props: NumberFieldsProps) {
  return (
    <>
      <PageNumberFields {...props} />
      <LineNumberFields {...props} />
    </>
  );
}

export interface HeaderFooterDialogProps {
  readonly view: unknown;
  save(patch: Record<string, unknown>): void;
  close(): void;
}

export function HeaderFooterDialog({ view, save, close }: HeaderFooterDialogProps) {
  const [form, setForm] = useState(() => formFrom(view));
  const valid = validForm(form);
  const firstOn = form.header.first !== null || form.footer.first !== null;
  const setFirst = (on: boolean) =>
    setForm((f) => ({
      ...f,
      header: { ...f.header, first: on ? (f.header.first ?? parts(undefined)) : null },
      footer: { ...f.footer, first: on ? (f.footer.first ?? parts(undefined)) : null },
    }));
  return (
    <Dialog
      title={t('textLayout.dialog.title')}
      description={t('textLayout.dialog.description')}
      size="large"
      onDismiss={close}
      actions={[
        { id: 'cancel', label: t('textLayout.dialog.cancel'), variant: 'secondary', onPress: close },
        {
          id: 'save',
          label: t('textLayout.dialog.save'),
          variant: 'primary',
          disabled: !valid,
          onPress: () => {
            save(viewPatch(form, view));
            close();
          },
        },
      ]}
    >
      <div className={styles.form}>
        <p className={styles.hint}>
          {t('textLayout.dialog.fieldsHint', {
            page: '{page}',
            pages: '{pages}',
            title: '{title}',
            notebook: '{notebook}',
            section: '{section}',
            date: '{date}',
          })}
        </p>
        <BandFields
          title={t('textLayout.dialog.header')}
          firstTitle={t('textLayout.dialog.firstHeader')}
          band={form.header}
          onChange={(header) => setForm({ ...form, header })}
        />
        <BandFields
          title={t('textLayout.dialog.footer')}
          firstTitle={t('textLayout.dialog.firstFooter')}
          band={form.footer}
          onChange={(footer) => setForm({ ...form, footer })}
        />
        <Switch label={t('textLayout.dialog.differentFirst')} checked={firstOn} onChange={setFirst} />
        <NumberFields form={form} setForm={setForm} />
      </div>
    </Dialog>
  );
}
