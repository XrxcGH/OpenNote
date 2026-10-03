// The Export dialog: choose what to export (this page, section, or notebook), a format, and a folder; export with
// progress and Cancel; read the summary. The host makes a new folder or file, so nothing is overwritten.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { isEnabled } from '../../app/flags';
import type { ExportFormat, ExportScope, InteropClient } from '../../platform/interop';
import type { NotesService } from '../../services/notes/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Button, Dialog, RadioCard, RadioGroup, announce } from '../../ui';
import type { DialogAction } from '../../ui';
import { createExportFlow } from './exportFlow';
import type { ExportFlow, ExportState } from './exportFlow';
import type { ExportTarget } from './exportTarget';
import styles from './Interop.module.css';
import { JobStatus, LossList, StepHeading } from './Parts';
import { exportErrorText } from './text';

export interface ExportDialogProps {
  interop: InteropClient;
  notes: NotesService;
  target: ExportTarget;
}

const FORMATS: readonly ExportFormat[] = ['markdown', 'html', 'htmlSingle', 'docx'];

const formatLabel = (format: ExportFormat) =>
  ({
    markdown: t('interop.export.formats.markdown'),
    html: t('interop.export.formats.html'),
    htmlSingle: t('interop.export.formats.htmlSingle'),
    docx: t('interop.export.formats.docx'),
    pdf: t('interop.export.formats.pdf'),
  })[format];

const formatHint = (format: ExportFormat) =>
  ({
    markdown: t('interop.export.formats.markdownHint'),
    html: t('interop.export.formats.htmlHint'),
    htmlSingle: t('interop.export.formats.htmlSingleHint'),
    docx: t('interop.export.formats.docxHint'),
    pdf: t('interop.export.formats.pdfHint'),
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
}: {
  flow: ExportFlow;
  state: Extract<ExportState, { step: 'options' }>;
  target: ExportTarget;
  refocus: boolean;
}) {
  return (
    <div className={styles.body}>
      <StepHeading focus={refocus}>{t('interop.export.optionsHeading')}</StepHeading>
      <p>{t('interop.export.intro')}</p>
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
      <RadioGroup<ExportFormat>
        label={t('interop.export.formatLabel')}
        value={state.format}
        onChange={(format) => flow.setFormat(format)}
      >
        {(isEnabled('interop.exportPdf') ? [...FORMATS, 'pdf' as const] : FORMATS).map((format) => (
          <RadioCard<ExportFormat>
            key={format}
            value={format}
            label={formatLabel(format)}
            description={formatHint(format)}
          />
        ))}
      </RadioGroup>
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
      {state.error && (
        <p role="alert" className={styles.error}>
          {exportErrorText(state.error)}
        </p>
      )}
    </div>
  );
}

function body(flow: ExportFlow, state: ExportState, target: ExportTarget, refocus: boolean) {
  switch (state.step) {
    case 'options':
      return <Options flow={flow} state={state} target={target} refocus={refocus} />;
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

export default function ExportDialog({ interop, notes, target, onClose }: ExportDialogProps & OverlayProps) {
  const [flow] = useState(() => createExportFlow({ interop, notes, target, announce }));
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
  const title = t('interop.export.title', { name: initial?.title.trim() || target.notebook.title });
  const cancel: DialogAction = { id: 'cancel', label: t('common.cancel'), variant: 'quiet', onPress: close };
  const actions: DialogAction[] = (() => {
    switch (state.step) {
      case 'options':
        return [
          cancel,
          { id: 'export', label: t('interop.export.start'), variant: 'primary', onPress: () => flow.start() },
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
      {body(flow, state, target, left)}
    </Dialog>
  );
}
