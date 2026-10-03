// The Import notes dialog: choose a source, see what will come over and what will not, import with progress and
// Cancel, and read the summary. Nothing is added until the person presses Import on the review.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { navigate } from '../../app/location';
import type { InteropClient } from '../../platform/interop';
import type { NotesService } from '../../services/notes/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Button, Dialog, Switch, announce } from '../../ui';
import type { DialogAction } from '../../ui';
import { createImportFlow } from './importFlow';
import type { ImportFlow, ImportState } from './importFlow';
import styles from './Interop.module.css';
import { JobStatus, LossList, StepHeading } from './Parts';
import { fileName, importErrorText, sizeText } from './text';

export interface ImportDialogProps {
  interop: InteropClient;
  notes: NotesService;
}

function Choose({ flow, canceled, refocus }: { flow: ImportFlow; canceled: boolean; refocus: boolean }) {
  const [sticky, setSticky] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    flow.localSources().then(
      (sources) => current && setSticky(sources.stickyNotes),
      () => undefined,
    );
    return () => void (current = false);
  }, [flow]);
  return (
    <div className={styles.body}>
      {canceled && <p role="status">{t('interop.import.canceled')}</p>}
      <StepHeading focus={refocus}>{t('interop.import.chooseHeading')}</StepHeading>
      <p>{t('interop.import.intro')}</p>
      <div className={styles.choices}>
        <Button variant="primary" onClick={() => void flow.chooseFile()}>
          {t('interop.import.chooseFile')}
        </Button>
        <Button onClick={() => void flow.chooseFolder()}>{t('interop.import.chooseFolder')}</Button>
        {sticky && <Button onClick={() => void flow.chooseLocal(sticky)}>{t('interop.import.stickyNotes')}</Button>}
      </div>
      <h3 className={styles.subheading}>{t('interop.import.sourcesHeading')}</h3>
      <ul className={styles.plain}>
        <li>{t('interop.import.sources.markdown')}</li>
        <li>{t('interop.import.sources.evernote')}</li>
        <li>{t('interop.import.sources.notion')}</li>
        <li>{t('interop.import.sources.word')}</li>
        <li>{t('interop.import.sources.web')}</li>
        <li>{t('interop.import.sources.other')}</li>
      </ul>
    </div>
  );
}

function Review({ flow, state }: { flow: ImportFlow; state: Extract<ImportState, { step: 'review' }> }) {
  const { preview, reportPage, path } = state;
  const empty = preview.pages === 0;
  const sectionsText = t('interop.import.review.sections', { count: preview.sections.length });
  return (
    <div className={styles.body}>
      <StepHeading>
        {empty
          ? t('interop.import.review.empty')
          : t('interop.import.review.summary', { pages: preview.pages, title: preview.notebookTitle })}
      </StepHeading>
      <p className={styles.path} title={path}>
        {preview.detected.label}: {fileName(path)}
      </p>
      {!empty && (
        <>
          <p>
            {preview.assets === 0
              ? t('interop.import.review.noFiles')
              : t('interop.import.review.files', { assets: preview.assets, size: sizeText(preview.assetBytes) })}
          </p>
          <h4 className={styles.subheading}>{sectionsText}</h4>
          <ul className={`${styles.list} ${styles.scroll}`} aria-label={sectionsText}>
            {preview.sections.map((section, index) => (
              <li key={`${section.title}-${index}`} className={styles.row}>
                <span>{section.title}</span>
                <span className={styles.note}>{t('interop.import.review.sectionPages', { pages: section.pages })}</span>
              </li>
            ))}
          </ul>
          <h4 className={styles.subheading}>{t('interop.import.review.lossesHeading')}</h4>
          {preview.losses.length === 0 ? (
            <p>{t('interop.import.review.noLosses')}</p>
          ) : (
            <LossList losses={preview.losses} />
          )}
          <Switch
            label={t('interop.import.review.reportPage')}
            checked={reportPage}
            onChange={(on) => flow.setReportPage(on)}
            describedBy="interop-report-hint"
          />
          <p id="interop-report-hint" className={styles.note}>
            {t('interop.import.review.reportPageHint')}
          </p>
        </>
      )}
    </div>
  );
}

function Done({ state }: { state: Extract<ImportState, { step: 'done' }> }) {
  const { result, notebook, undone } = state;
  return (
    <div className={styles.body}>
      <StepHeading>{undone ? t('interop.import.done.undone') : t('interop.import.done.title')}</StepHeading>
      {!undone && (
        <>
          <p>{t('interop.import.done.summary', { pages: result.pages, title: notebook.title })}</p>
          {result.lostPages > 0 && <p>{t('interop.import.done.changed', { lost: result.lostPages })}</p>}
          {result.losses.length > 0 && <LossList losses={result.losses} />}
          {state.reportFile && (
            <p role="status">{t('moreInterop.report.savedTo', { name: fileName(state.reportFile) })}</p>
          )}
          {state.reportError && <p role="alert">{t('moreInterop.report.failed')}</p>}
        </>
      )}
    </div>
  );
}

function body(flow: ImportFlow, state: ImportState, refocus: boolean) {
  switch (state.step) {
    case 'choose':
      return <Choose flow={flow} canceled={Boolean(state.canceled)} refocus={refocus} />;
    case 'checking':
      return (
        <div className={styles.body}>
          <StepHeading>{t('interop.import.checking', { name: fileName(state.path) })}</StepHeading>
          <JobStatus label={t('interop.import.checkingLabel')} progress={state.progress} />
        </div>
      );
    case 'unsupported':
      return (
        <div className={styles.body}>
          <StepHeading>{t('interop.import.unsupported.title')}</StepHeading>
          <p className={styles.path} title={state.path}>
            {state.detected.label}: {fileName(state.path)}
          </p>
          <p>{state.detected.advice ?? t('interop.import.unsupported.fallback')}</p>
        </div>
      );
    case 'review':
      return <Review flow={flow} state={state} />;
    case 'importing':
      return (
        <div className={styles.body}>
          <StepHeading>
            {state.building ? t('interop.import.building') : t('interop.import.importing', { name: state.title })}
          </StepHeading>
          <JobStatus label={t('interop.import.importingLabel')} progress={state.progress} />
        </div>
      );
    case 'done':
      return <Done state={state} />;
    case 'failed':
      return (
        <div className={styles.body}>
          <StepHeading>{t('interop.import.failed.title')}</StepHeading>
          <p role="alert">{importErrorText(state.error)}</p>
        </div>
      );
  }
}

export default function ImportDialog({ interop, notes, onClose }: ImportDialogProps & OverlayProps) {
  const [flow] = useState(() => createImportFlow({ interop, notes, announce }));
  useEffect(() => flow.attach(), [flow]);
  const state = useSyncExternalStore(flow.state.subscribe, flow.state.get);
  // The first screen keeps the focus the dialog gave its first button. Coming back to it, the heading takes focus.
  const [left, setLeft] = useState(false);
  if (state.step !== 'choose' && !left) setLeft(true);

  const close = () => {
    // Once the host has finished, the tree is being made, which takes a moment and cannot be canceled.
    if (state.step === 'importing' && state.building) return;
    if (flow.running()) flow.cancel();
    onClose();
  };

  useEffect(() => {
    if (state.step === 'done') announce(t('interop.import.done.title'));
    if (state.step === 'failed') announce(importErrorText(state.error), 'assertive');
  }, [state]);

  const cancel: DialogAction = { id: 'cancel', label: t('common.cancel'), variant: 'quiet', onPress: close };
  const actions: DialogAction[] = (() => {
    switch (state.step) {
      case 'choose':
        return [{ ...cancel, id: 'close', label: t('common.close') }];
      case 'checking':
        return [{ ...cancel, onPress: () => flow.cancel() }];
      case 'importing':
        return state.building ? [] : [{ ...cancel, onPress: () => flow.cancel() }];
      case 'unsupported':
        return [
          { ...cancel, id: 'close', label: t('common.close') },
          { id: 'back', label: t('interop.import.review.back'), variant: 'primary', onPress: () => flow.back() },
        ];
      case 'review':
        return [
          cancel,
          { id: 'back', label: t('interop.import.review.back'), variant: 'secondary', onPress: () => flow.back() },
          ...(state.preview.pages > 0
            ? [
                {
                  id: 'import',
                  label: t('interop.import.review.start'),
                  variant: 'primary' as const,
                  onPress: () => flow.start(),
                },
              ]
            : []),
        ];
      case 'failed':
        return [
          { ...cancel, id: 'close', label: t('common.close') },
          { id: 'retry', label: t('interop.import.failed.tryAgain'), variant: 'primary', onPress: () => flow.retry() },
        ];
      case 'done':
        return [
          ...(state.undone
            ? []
            : [
                ...(interop.more
                  ? [
                      {
                        id: 'saveReport',
                        label: t('moreInterop.report.save'),
                        variant: 'quiet' as const,
                        onPress: () => flow.saveReport(),
                      },
                    ]
                  : []),
                {
                  id: 'undo',
                  label: t('interop.import.done.undo'),
                  variant: 'quiet' as const,
                  onPress: () => flow.undo(),
                },
                {
                  id: 'open',
                  label: t('interop.import.done.open'),
                  variant: 'secondary' as const,
                  onPress: () => {
                    navigate({
                      view: 'workspace',
                      notebookId: state.notebook.id,
                      sectionId: state.firstSection?.id ?? null,
                      pageId: state.firstPage?.id ?? null,
                    });
                    onClose();
                  },
                },
              ]),
          { id: 'done', label: t('interop.import.done.close'), variant: 'primary', onPress: onClose },
        ];
    }
  })();

  return (
    <Dialog title={t('interop.import.title')} size="medium" actions={actions} onDismiss={close}>
      {body(flow, state, left)}
    </Dialog>
  );
}
