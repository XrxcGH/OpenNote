// The Export dialog: choose what to export (this page, section, or notebook), a format, and a folder; export with
// progress and Cancel; read the summary. The host makes a new folder or file, so nothing is overwritten.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { isEnabled } from '../../app/flags';
import type { ExportFormat, ExportScope, InteropClient } from '../../platform/interop';
import type { NotesService } from '../../services/notes/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Button, Dialog, RadioCard, RadioGroup, Switch, TextField, announce } from '../../ui';
import type { DialogAction } from '../../ui';
import { createExportFlow } from './exportFlow';
import { SendExtras } from './SendExtras';
import { NO_SHARE_CHOICES } from './exportFlow';
import type { DrawPdf, ExportFlow, ExportState } from './exportFlow';
import type { ExportTarget } from './exportTarget';
import styles from './Interop.module.css';
import { JobStatus, LossList, StepHeading } from './Parts';
import { exportErrorText } from './text';

export interface ExportDialogProps {
  interop: InteropClient;
  notes: NotesService;
  target: ExportTarget;
  /** Prints the pages of a PDF export (features/pdf/bundle). */
  drawPdf?: DrawPdf;
  /** `share` makes this Share as a file: one .opennote file, with an optional password and page history. */
  mode?: 'export' | 'share';
}

const FORMATS: readonly ExportFormat[] = ['markdown', 'html', 'htmlSingle', 'docx'];
const OFFICE_FORMATS: readonly ExportFormat[] = ['pptx', 'xlsx', 'csv'];

/**
 * The choices to show: the PDF and the Office choices appear when their flags are on. PDF also needs a way to print
 * the pages, which a copy of OpenNote without the print window doesn't have, so it isn't offered there.
 */
function exportFormats(canPrint: boolean): readonly ExportFormat[] {
  return [
    ...FORMATS,
    ...(isEnabled('interop.officeFormats') ? OFFICE_FORMATS : []),
    ...(canPrint && isEnabled('interop.exportPdf') ? (['pdf'] as const) : []),
  ];
}

const formatLabel = (format: ExportFormat) =>
  ({
    markdown: t('interop.export.formats.markdown'),
    html: t('interop.export.formats.html'),
    htmlSingle: t('interop.export.formats.htmlSingle'),
    docx: t('interop.export.formats.docx'),
    pdf: t('interop.export.formats.pdf'),
    pptx: t('interop.export.formats.pptx'),
    xlsx: t('interop.export.formats.xlsx'),
    csv: t('interop.export.formats.csv'),
    share: t('interop.share.command'),
  })[format];

const formatHint = (format: ExportFormat) =>
  ({
    markdown: t('interop.export.formats.markdownHint'),
    html: t('interop.export.formats.htmlHint'),
    htmlSingle: t('interop.export.formats.htmlSingleHint'),
    docx: t('interop.export.formats.docxHint'),
    pdf: t('interop.export.formats.pdfHint'),
    pptx: t('interop.export.formats.pptxHint'),
    xlsx: t('interop.export.formats.xlsxHint'),
    csv: t('interop.export.formats.csvHint'),
    share: t('interop.share.intro'),
  })[format];

function scopeLabel(scope: ExportScope, name: string): string {
  if (scope === 'page') return t('interop.export.scopes.page', { name });
  if (scope === 'section') return t('interop.export.scopes.section', { name });
  return t('interop.export.scopes.notebook', { name });
}

function Options({
  flow,
  state,
  target,
  refocus,
  canPrint,
}: {
  flow: ExportFlow;
  state: Extract<ExportState, { step: 'options' }>;
  target: ExportTarget;
  refocus: boolean;
  canPrint: boolean;
}) {
  return (
    <div className={styles.body}>
      <StepHeading focus={refocus}>{t('interop.export.optionsHeading')}</StepHeading>
      <p>{state.format === 'share' ? t('interop.share.intro') : t('interop.export.intro')}</p>
      {target.choices.length > 1 && (
        <RadioGroup<ExportScope>
          label={t('interop.export.scopeLabel')}
          value={state.scope}
          onChange={(scope) => flow.setScope(scope)}
        >
          {target.choices.map((choice) => (
            <RadioCard<ExportScope>
              key={choice.scope}
              value={choice.scope}
              label={scopeLabel(choice.scope, choice.node.title)}
            />
          ))}
        </RadioGroup>
      )}
      {state.format === 'share' ? (
        <ShareFields flow={flow} state={state} />
      ) : (
        <RadioGroup<ExportFormat>
          label={t('interop.export.formatLabel')}
          value={state.format}
          onChange={(format) => flow.setFormat(format)}
        >
          {exportFormats(canPrint).map((format) => (
            <RadioCard<ExportFormat>
              key={format}
              value={format}
              label={formatLabel(format)}
              description={formatHint(format)}
            />
          ))}
        </RadioGroup>
      )}
      <div className={styles.folder}>
        <div>
          <h3 className={styles.subheading}>{t('interop.export.folderLabel')}</h3>
          <p className={styles.path} title={state.folder ?? undefined}>
            {state.folder ?? t('interop.export.folderNone')}
          </p>
        </div>
        <Button onClick={() => void flow.chooseFolder()}>
          {state.folder ? t('interop.export.changeFolder') : t('interop.export.chooseFolder')}
        </Button>
      </div>
      {state.format !== 'share' && <SendExtras flow={flow} folder={state.folder} />}
      {state.error && (
        <p role="alert" className={styles.error}>
          {exportErrorText(state.error)}
        </p>
      )}
    </div>
  );
}

/** Share as a file: an optional password, typed twice, and whether to include page history. */
function ShareFields({ flow, state }: { flow: ExportFlow; state: Extract<ExportState, { step: 'options' }> }) {
  const share = state.share ?? NO_SHARE_CHOICES;
  const mismatch = share.confirm !== '' && share.password !== share.confirm;
  return (
    <div className={styles.fields}>
      <TextField
        label={t('interop.share.password')}
        help={t('interop.share.passwordHelp')}
        value={share.password}
        secret
        onChange={(password) => flow.setShare({ password })}
      />
      {share.password !== '' && (
        <TextField
          label={t('interop.share.confirm')}
          value={share.confirm}
          secret
          error={mismatch ? t('interop.share.mismatch') : undefined}
          onChange={(confirm) => flow.setShare({ confirm })}
        />
      )}
      <Switch
        label={t('interop.share.history')}
        checked={share.history}
        onChange={(history) => flow.setShare({ history })}
      />
      <p className={styles.note}>{t('interop.share.historyHelp')}</p>
    </div>
  );
}

function body(flow: ExportFlow, state: ExportState, target: ExportTarget, refocus: boolean, canPrint: boolean) {
  switch (state.step) {
    case 'options':
      return <Options flow={flow} state={state} target={target} refocus={refocus} canPrint={canPrint} />;
    case 'exporting':
      return (
        <div className={styles.body}>
          <StepHeading>{t('interop.export.exporting', { name: state.name })}</StepHeading>
          <JobStatus label={t('interop.export.exportingLabel')} progress={state.progress} />
        </div>
      );
    case 'empty':
      return (
        <div className={styles.body}>
          <StepHeading>{t('interop.export.nothing')}</StepHeading>
        </div>
      );
    case 'done':
      return (
        <div className={styles.body}>
          <StepHeading>{t('interop.export.done.title')}</StepHeading>
          <p>{t('interop.export.done.summary', { pages: state.result.pages, where: state.result.reveal })}</p>
          {state.result.lostPages > 0 && <p>{t('interop.export.done.changed', { lost: state.result.lostPages })}</p>}
          {state.result.losses.length > 0 && <LossList losses={state.result.losses} />}
        </div>
      );
  }
}

export default function ExportDialog({
  interop,
  notes,
  target,
  drawPdf,
  mode,
  onClose,
}: ExportDialogProps & OverlayProps) {
  const sharing = mode === 'share';
  const [flow] = useState(() =>
    createExportFlow({ interop, notes, target, announce, drawPdf, ...(sharing ? { format: 'share' as const } : {}) }),
  );
  useEffect(() => flow.attach(), [flow]);
  const state = useSyncExternalStore(flow.state.subscribe, flow.state.get);
  // The first screen keeps the focus the dialog gave its first control. Coming back to it, the heading takes focus.
  const [left, setLeft] = useState(false);
  if (state.step !== 'options' && !left) setLeft(true);

  const close = () => {
    if (flow.running()) flow.cancel();
    onClose();
  };

  useEffect(() => {
    if (state.step === 'done') announce(t('interop.export.done.title'));
  }, [state.step]);

  const initial = target.choices.find((choice) => choice.scope === target.initial)?.node;
  const name = initial?.title.trim() || target.notebook.title;
  const title = sharing ? t('interop.share.title', { name }) : t('interop.export.title', { name });
  const cancel: DialogAction = { id: 'cancel', label: t('common.cancel'), variant: 'quiet', onPress: close };
  const actions: DialogAction[] = (() => {
    switch (state.step) {
      case 'options':
        return [
          cancel,
          {
            id: 'export',
            label: sharing ? t('interop.share.start') : t('interop.export.start'),
            variant: 'primary',
            onPress: () => flow.start(),
          },
        ];
      case 'exporting':
        return [{ ...cancel, onPress: () => flow.cancel() }];
      case 'empty':
        return [
          { ...cancel, id: 'close', label: t('common.close') },
          { id: 'back', label: t('interop.export.nothingBack'), variant: 'primary', onPress: () => flow.back() },
        ];
      case 'done':
        return [
          {
            id: 'show',
            label: t('interop.export.done.show'),
            variant: 'secondary',
            onPress: () => interop.reveal(state.result.reveal),
          },
          { id: 'done', label: t('interop.export.done.close'), variant: 'primary', onPress: onClose },
        ];
    }
  })();

  return (
    <Dialog title={title} size="medium" actions={actions} onDismiss={close}>
      {body(flow, state, target, left, Boolean(drawPdf && interop.more))}
    </Dialog>
  );
}
