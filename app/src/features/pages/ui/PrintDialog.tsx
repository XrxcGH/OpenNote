// The print and Export as PDF dialog. It asks for the range, odd or even sheets, a header and footer, and whether the
// paper lines print; it shows the sheets as the PDF will have them; and it runs the export with progress and a Stop
// button. Both commands open it: Export as PDF saves the file, and Print saves it and opens it in the PDF viewer,
// where the printer is chosen.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Platform } from '../../../platform/types';
import { t } from '../../../strings/t';
import { Button, Dialog, ProgressBar, RadioCard, RadioGroup, Switch, TextField, showToast } from '../../../ui';
import { exportPdfFile, PdfCheckError, prepareInput } from '../host/exporter';
import type { PageSource } from '../host/source';
import { parsePageRange, preparePrint } from '../print';
import type { Parity, PrepareResult, PrintOptions } from '../print';
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

export function PrintDialog({ source, platform, mode, close }: PrintDialogProps) {
  const [form, setForm] = useState<Form>({ range: '', parity: 'all', header: '', footer: '', background: true });
  const [sheet, setSheet] = useState(0);
  const [working, setWorking] = useState<{ stage: string; fraction: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const options = useMemo(() => toOptions(form), [form]);
  const preview = usePreview(source, options);
  const printed = preview.status === 'ready' ? preview.result.plan.sheets.length : 0;
  const total = preview.status === 'ready' ? preview.result.sheets : 0;
  const rangeError = preview.status === 'ready' && parsePageRange(form.range, total, form.parity).error !== undefined;
  const shown = Math.min(sheet, Math.max(0, printed - 1));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setSheet(0);
    setForm((before) => ({ ...before, [key]: value }));
  };

  const run = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setWorking({ stage: 'prepare', fraction: 0 });
    try {
      const outcome = await exportPdfFile(platform.exports, source, {
        print: options,
        signal: controller.signal,
        onProgress: (progress) => setWorking({ stage: progress.stage, fraction: progress.fraction }),
      });
      if (outcome.status === 'cancelled') return setWorking(null);
      close();
      const extra = outcome.problems.find((problem) => !KNOWN.has(problem.kind));
      const message = t('pageViews.print.done', { name: outcome.name });
      showToast({
        message: extra ? `${message} ${t(`pageViews.print.problem.${extra.kind}`)}` : message,
        action: { label: t('pageViews.print.openFile'), run: () => platform.exports.open(outcome.path, true) },
      });
      if (mode === 'print') await platform.exports.open(outcome.path, false).catch(() => undefined);
    } catch (error) {
      setWorking(null);
      const name = error instanceof Error ? error.name : '';
      const code = (error as { code?: string }).code;
      if (name === 'AbortError') showToast({ message: t('pageViews.print.stopped') });
      else if (name === 'TimeoutError') showToast({ message: t('pageViews.print.timedOut'), tone: 'danger' });
      else if (code === 'notImplemented') showToast({ message: t('pageViews.print.unavailable'), tone: 'danger' });
      else {
        platform.log('error', `PDF export failed: ${error instanceof PdfCheckError ? error.message : String(error)}`);
        showToast({ message: t('pageViews.print.failed'), tone: 'danger' });
      }
    } finally {
      abort.current = null;
    }
  };

  const title = t(mode === 'print' ? 'pageViews.print.title' : 'pageViews.print.exportTitle');
  const paper = preview.status === 'ready' ? preview.result.plan.paper : null;
  const actions = working
    ? [
        {
          id: 'stop',
          label: t('pageViews.print.stop'),
          variant: 'secondary' as const,
          onPress: () => abort.current?.abort(),
        },
      ]
    : [
        { id: 'cancel', label: t('pageViews.print.cancel'), variant: 'secondary' as const, onPress: close },
        {
          id: 'go',
          label: t(mode === 'print' ? 'pageViews.print.print' : 'pageViews.print.export'),
          variant: 'primary' as const,
          onPress: () => {
            if (preview.status === 'ready' && !rangeError) void run();
          },
        },
      ];

  return (
    <Dialog
      title={title}
      description={t('pageViews.print.description')}
      size="large"
      actions={actions}
      onDismiss={() => (working ? abort.current?.abort() : close())}
    >
      {working ? (
        <div className={styles.progress}>
          <ProgressBar label={t('pageViews.print.working')} value={working.fraction} />
          <p className={styles.hint}>
            {t(`pageViews.print.stage.${working.stage as 'prepare' | 'render' | 'verify'}`)}
          </p>
        </div>
      ) : (
        <div className={styles.split}>
          <div className={styles.form}>
            <TextField
              label={t('pageViews.print.range')}
              value={form.range}
              onChange={(value) => set('range', value)}
              help={t('pageViews.print.rangePlaceholder')}
              error={rangeError ? t('pageViews.print.badRange', { sheets: total }) : undefined}
            />
            <RadioGroup
              label={t('pageViews.print.parity')}
              value={form.parity}
              onChange={(value) => set('parity', value)}
            >
              {PARITIES.map((parity) => (
                <RadioCard key={parity} value={parity} label={t(parityKey[parity])} />
              ))}
            </RadioGroup>
            <div className={styles.cols}>
              <TextField label={t('pageViews.print.header')} value={form.header} onChange={(v) => set('header', v)} />
              <TextField label={t('pageViews.print.footer')} value={form.footer} onChange={(v) => set('footer', v)} />
            </div>
            <p className={styles.hint}>
              {t('pageViews.print.headerHint', { title: '{title}', page: '{page}', pages: '{pages}', date: '{date}' })}
            </p>
            <Switch
              label={t('pageViews.print.paperPattern')}
              checked={form.background}
              onChange={(value) => set('background', value)}
            />
          </div>
          <div className={styles.preview} aria-live="polite">
            {preview.status === 'ready' ? (
              <>
                <SheetPreview result={preview.result} sheet={shown} />
                <div className={styles.stepper}>
                  <Button variant="quiet" disabled={shown === 0} onClick={() => setSheet(shown - 1)}>
                    {t('pageViews.slides.previous')}
                  </Button>
                  <span>{t('pageViews.status.sheetCount', { sheet: shown + 1, sheets: printed })}</span>
                  <Button variant="quiet" disabled={shown >= printed - 1} onClick={() => setSheet(shown + 1)}>
                    {t('pageViews.slides.next')}
                  </Button>
                </div>
                <p className={styles.hint}>
                  {t('pageViews.print.sheetCount', {
                    count: printed,
                    paper: paper
                      ? `${Math.round((paper.width / 96) * 100) / 100} × ${Math.round((paper.height / 96) * 100) / 100} in`
                      : '',
                  })}
                </p>
              </>
            ) : (
              <p className={preview.status === 'failed' ? styles.error : styles.hint}>
                {t(preview.status === 'failed' ? 'pageViews.print.previewFailed' : 'pageViews.print.previewing')}
              </p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
