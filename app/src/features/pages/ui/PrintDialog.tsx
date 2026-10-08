// The print and Export as PDF dialog. It asks for the range, odd or even sheets, a header and footer, and whether the
// paper lines print; it shows the sheets as the PDF will have them; and it runs the export with progress and a Stop
// button. Both commands open it: Export as PDF saves the file, and Print saves it and opens it in the PDF viewer,
// where the printer is chosen.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Platform } from '../../../platform/types';
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { Button, Dialog, ProgressBar, RadioCard, RadioGroup, Switch, TextField, showToast } from '../../../ui';
import { exportPdfFile, PdfCheckError, prepareInput } from '../host/exporter';
import type { PdfOutcome } from '../host/exporter';
import type { PageSource } from '../host/source';
import { parsePageRange } from '../print/range';
import type { Parity } from '../print/range';
import { preparePrint } from '../print/prepare';
import type { PrepareResult } from '../print/prepare';
import type { PrintOptions } from '../print/sheets';
import styles from './pagesUi.module.css';

export interface PrintDialogProps {
  readonly source: PageSource;
  readonly platform: Platform;
  readonly mode: 'print' | 'export';
  close(): void;
}

type Preview =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly result: PrepareResult };

/** The options as the print plan takes them. */
function toOptions(form: Form): PrintOptions {
  return {
    range: form.range.trim() === '' ? undefined : form.range,
    parity: form.parity,
    background: form.background,
    header: form.header.trim() === '' ? undefined : { center: form.header },
    footer: form.footer.trim() === '' ? undefined : { center: form.footer },
  };
}

interface Form {
  range: string;
  parity: Parity;
  header: string;
  footer: string;
  background: boolean;
  accessible: boolean;
}

/** Prepares the page in a frame no one sees, so the preview shows the sheets exactly as the PDF will have them. */
function usePreview(source: PageSource, options: PrintOptions): Preview {
  const [preview, setPreview] = useState<Preview>({ status: 'loading' });
  const key = JSON.stringify(options);
  useEffect(() => {
    let current = true;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:960px;border:0';
    const timer = setTimeout(() => {
      setPreview({ status: 'loading' });
      document.body.append(frame);
      const doc = frame.contentDocument;
      if (!doc) return setPreview({ status: 'failed' });
      preparePrint(doc, prepareInput(source, JSON.parse(key) as PrintOptions))
        .then((result) => current && setPreview({ status: 'ready', result }))
        .catch(() => current && setPreview({ status: 'failed' }));
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
      frame.remove();
    };
  }, [source, key]);
  return preview;
}

/** The sheet the preview shows, scaled to the width it has. */
function SheetPreview({ result, sheet }: { result: PrepareResult; sheet: number }) {
  const { width, height } = result.plan.box;
  const scale = Math.min(1, 224 / width);
  const label = t('pageViews.print.previewLabel', { sheet: result.plan.sheets[sheet]?.number ?? sheet + 1 });
  return (
    <div className={styles.sheetBox} style={{ inlineSize: width * scale, blockSize: height * scale }}>
      <iframe
        title={label}
        className={styles.sheetFrame}
        sandbox="allow-same-origin"
        srcDoc={result.html}
        tabIndex={-1}
        style={{
          inlineSize: width,
          blockSize: height * result.plan.sheets.length,
          transform: `scale(${scale}) translateY(${-sheet * height}px)`,
        }}
      />
    </div>
  );
}

const PARITIES: readonly Parity[] = ['all', 'odd', 'even'];
const parityKey = {
  all: 'pageViews.print.parityAll',
  odd: 'pageViews.print.parityOdd',
  even: 'pageViews.print.parityEven',
} as const;

/** The limitations of WebView2's printing that the dialog already says, so a saved file doesn't repeat them. */
const KNOWN = new Set(['untagged', 'noLanguage', 'variableFonts']);
/** An accessible PDF asked for tags, so a file without them is worth saying. */
const KNOWN_ACCESSIBLE = new Set(['variableFonts']);

interface Working {
  readonly stage: string;
  readonly fraction: number;
}

/** Tells the person how an export that did not finish ended. */
function reportFailure(error: unknown, platform: Platform): void {
  const name = error instanceof Error ? error.name : '';
  const code = (error as { code?: string }).code;
  if (name === 'AbortError') return void showToast({ message: t('pageViews.print.stopped') });
  if (name === 'TimeoutError') return void showToast({ message: t('pageViews.print.timedOut'), tone: 'danger' });
  if (code === 'notImplemented') return void showToast({ message: t('pageViews.print.unavailable'), tone: 'danger' });
  platform.log('error', `PDF export failed: ${error instanceof PdfCheckError ? error.message : String(error)}`);
  showToast({ message: t('pageViews.print.failed'), tone: 'danger' });
}

/** Tells the person where the PDF went, and what to know about it. */
function reportSaved(outcome: Extract<PdfOutcome, { status: 'saved' }>, platform: Platform, accessible: boolean): void {
  const known = accessible ? KNOWN_ACCESSIBLE : KNOWN;
  const extra = outcome.problems.find((problem) => !known.has(problem.kind));
  const message = t('pageViews.print.done', { name: outcome.name });
  showToast({
    message: extra ? `${message} ${t(`pageViews.print.problem.${extra.kind}`)}` : message,
    action: { label: t('pageViews.print.openFile'), run: () => platform.exports.open(outcome.path, true) },
  });
}

/** Runs the export with progress, and stops it when asked. */
function useExport(props: PrintDialogProps, options: PrintOptions, accessible: boolean) {
  const { source, platform, mode, close } = props;
  const [working, setWorking] = useState<Working | null>(null);
  const abort = useRef<AbortController | null>(null);
  const run = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setWorking({ stage: 'prepare', fraction: 0 });
    try {
      const outcome = await exportPdfFile(platform.exports, source, {
        print: options,
        accessible,
        signal: controller.signal,
        onProgress: (progress) => setWorking({ stage: progress.stage, fraction: progress.fraction }),
      });
      if (outcome.status === 'canceled') return setWorking(null);
      close();
      reportSaved(outcome, platform, accessible);
      if (mode === 'print') await platform.exports.open(outcome.path, false).catch(() => undefined);
    } catch (error) {
      setWorking(null);
      reportFailure(error, platform);
    } finally {
      abort.current = null;
    }
  };
  return { working, run, stop: () => abort.current?.abort() };
}

interface FieldsProps {
  readonly form: Form;
  readonly total: number;
  readonly rangeError: boolean;
  set<K extends keyof Form>(key: K, value: Form[K]): void;
}

function Fields({ form, total, rangeError, set }: FieldsProps) {
  const error = rangeError ? t('pageViews.print.badRange', { sheets: total }) : undefined;
  const fields = { title: '{title}', page: '{page}', pages: '{pages}', date: '{date}' };
  return (
    <div className={styles.form}>
      <TextField
        label={t('pageViews.print.range')}
        value={form.range}
        onChange={(value) => set('range', value)}
        help={t('pageViews.print.rangePlaceholder')}
        error={error}
      />
      <RadioGroup label={t('pageViews.print.parity')} value={form.parity} onChange={(value) => set('parity', value)}>
        {PARITIES.map((parity) => (
          <RadioCard key={parity} value={parity} label={t(parityKey[parity])} />
        ))}
      </RadioGroup>
      <div className={styles.cols}>
        <TextField label={t('pageViews.print.header')} value={form.header} onChange={(v) => set('header', v)} />
        <TextField label={t('pageViews.print.footer')} value={form.footer} onChange={(v) => set('footer', v)} />
      </div>
      <p className={styles.hint}>{t('pageViews.print.headerHint', fields)}</p>
      <Switch
        label={t('pageViews.print.paperPattern')}
        checked={form.background}
        onChange={(value) => set('background', value)}
      />
      {isEnabled('pages.accessiblePdf') ? (
        <>
          <Switch
            label={t('pagesPlus.pdf.accessible')}
            checked={form.accessible}
            onChange={(value) => set('accessible', value)}
          />
          <p className={styles.hint}>{t('pagesPlus.pdf.accessibleHelp')}</p>
        </>
      ) : null}
    </div>
  );
}

const inches = (units: number) => Math.round((units / 96) * 100) / 100;

/** The sheet the PDF will have, with arrows to look at the others. */
function PreviewPane({ preview, sheet, setSheet }: { preview: Preview; sheet: number; setSheet(n: number): void }) {
  if (preview.status !== 'ready') {
    const failed = preview.status === 'failed';
    const key = failed ? 'pageViews.print.previewFailed' : 'pageViews.print.previewing';
    return <p className={failed ? styles.error : styles.hint}>{t(key)}</p>;
  }
  const { result } = preview;
  const printed = result.plan.sheets.length;
  const shown = Math.min(sheet, Math.max(0, printed - 1));
  const { paper } = result.plan;
  const size = `${inches(paper.width)} × ${inches(paper.height)} in`;
  return (
    <>
      <SheetPreview result={result} sheet={shown} />
      <div className={styles.stepper}>
        <Button variant="quiet" disabled={shown === 0} onClick={() => setSheet(shown - 1)}>
          {t('pageViews.slides.previous')}
        </Button>
        <span>{t('pageViews.status.sheetCount', { sheet: shown + 1, sheets: printed })}</span>
        <Button variant="quiet" disabled={shown >= printed - 1} onClick={() => setSheet(shown + 1)}>
          {t('pageViews.slides.next')}
        </Button>
      </div>
      <p className={styles.hint}>{t('pageViews.print.sheetCount', { count: printed, paper: size })}</p>
    </>
  );
}

function Progress({ working }: { working: Working }) {
  return (
    <div className={styles.progress}>
      <ProgressBar label={t('pageViews.print.working')} value={working.fraction} />
      <p className={styles.hint}>{t(`pageViews.print.stage.${working.stage as 'prepare' | 'render' | 'verify'}`)}</p>
    </div>
  );
}

export function PrintDialog(props: PrintDialogProps) {
  const { source, mode, close } = props;
  const [form, setForm] = useState<Form>({
    range: '',
    parity: 'all',
    header: '',
    footer: '',
    background: true,
    accessible: isEnabled('pages.accessiblePdf'),
  });
  const [sheet, setSheet] = useState(0);
  const options = useMemo(() => toOptions(form), [form]);
  const preview = usePreview(source, options);
  const { working, run, stop } = useExport(props, options, form.accessible);
  const total = preview.status === 'ready' ? preview.result.sheets : 0;
  const rangeError = preview.status === 'ready' && parsePageRange(form.range, total, form.parity).error !== undefined;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setSheet(0);
    setForm((before) => ({ ...before, [key]: value }));
  };
  const go = {
    id: 'go',
    label: t(mode === 'print' ? 'pageViews.print.print' : 'pageViews.print.export'),
    variant: 'primary' as const,
    onPress: () => (preview.status === 'ready' && !rangeError ? run() : undefined),
  };
  const actions = working
    ? [{ id: 'stop', label: t('pageViews.print.stop'), variant: 'secondary' as const, onPress: stop }]
    : [{ id: 'cancel', label: t('pageViews.print.cancel'), variant: 'secondary' as const, onPress: close }, go];
  return (
    <Dialog
      title={t(mode === 'print' ? 'pageViews.print.title' : 'pageViews.print.exportTitle')}
      description={t('pageViews.print.description')}
      size="large"
      actions={actions}
      onDismiss={() => (working ? stop() : close())}
    >
      {working ? (
        <Progress working={working} />
      ) : (
        <div className={styles.split}>
          <Fields form={form} total={total} rangeError={rangeError} set={set} />
          <div className={styles.preview} aria-live="polite">
            <PreviewPane preview={preview} sheet={sheet} setSheet={setSheet} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
