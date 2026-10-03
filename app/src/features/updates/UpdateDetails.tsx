// The details of an update in progress (ARCHITECTURE.md section 18.11). The chip's popover and the Updates section
// share them: the title, what happens next, the release notes as plain text, and the actions for the phase.
// Release notes are never rendered as HTML.

import { useId } from 'react';
import { executeCommand } from '../../commands/registry';
import type { CommandContext, CommandId } from '../../commands/types';
import type { UpdaterPhase } from '../../platform/types';
import { t } from '../../strings/t';
import { Button, ProgressBar } from '../../ui';
import { formatSize } from './model';
import styles from './UpdateDetails.module.css';

export interface UpdateDetailsProps {
  phase: UpdaterPhase;
  /** The popover adds "Later"; the Updates section doesn't need it. */
  place: 'popover' | 'settings';
  /** Closes the popover. */
  onLater?(): void;
  /** The id the popover's dialog is named by. */
  titleId?: string;
}

const run = (source: CommandContext['source'], id: CommandId, args?: unknown) => void executeCommand(id, args, source);

function Notes({ notes }: { notes: string }) {
  const id = useId();
  if (!notes) return null;
  return (
    <section aria-labelledby={id} className={styles.notes}>
      <h3 id={id} className={styles.notesTitle}>
        {t('updates.details.notes')}
      </h3>
      <p className={styles.notesText}>{notes}</p>
    </section>
  );
}

function ReadyActions({ phase, place, onLater }: UpdateDetailsProps & { phase: { kind: 'ready' } & UpdaterPhase }) {
  const reasonId = useId();
  const source = place === 'popover' ? 'titleBar' : 'menu';
  const blocked = phase.kind === 'ready' ? phase.blockedBy : null;
  const version = phase.kind === 'ready' ? phase.version : '';
  return (
    <>
      {blocked && (
        <p id={reasonId} className={styles.blocked}>
          {blocked === 'recording' ? t('updates.blocked.recording') : t('updates.blocked.unsavedChanges')}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          variant="primary"
          aria-disabled={blocked ? true : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={() => !blocked && run(source, 'updates.restart')}
        >
          {t('updates.actions.restart')}
        </Button>
        <Button onClick={() => run(source, 'updates.whatsNew', version)}>{t('updates.actions.whatsNew')}</Button>
        <Later onLater={onLater} />
      </div>
    </>
  );
}

function AvailableActions({
  version,
  place,
  onLater,
}: {
  version: string;
  place: UpdateDetailsProps['place'];
  onLater?(): void;
}) {
  const source = place === 'popover' ? 'titleBar' : 'menu';
  return (
    <div className={styles.actions}>
      <Button variant="primary" onClick={() => run(source, 'updates.download')}>
        {t('updates.actions.download')}
      </Button>
      <Button onClick={() => run(source, 'updates.skip', version)}>{t('updates.actions.skip')}</Button>
      <Later onLater={onLater} />
    </div>
  );
}

function Title({ id, text }: { id?: string; text: string }) {
  return (
    <h2 id={id} className={styles.title}>
      {text}
    </h2>
  );
}

/** "Later", which closes the popover. The Updates section has no popover to close. */
function Later({ onLater }: { onLater?(): void }) {
  if (!onLater) return null;
  return (
    <Button variant="quiet" onClick={onLater}>
      {t('updates.actions.later')}
    </Button>
  );
}

function LaterOnly({ onLater }: { onLater?(): void }) {
  if (!onLater) return null;
  return (
    <div className={styles.actions}>
      <Later onLater={onLater} />
    </div>
  );
}

function Body(props: UpdateDetailsProps) {
  const { phase, place, onLater, titleId } = props;
  switch (phase.kind) {
    case 'ready':
      return (
        <>
          <Title id={titleId} text={t('updates.details.readyTitle', { version: phase.version })} />
          <p>{t('updates.details.readyBody')}</p>
          <Notes notes={phase.notes} />
          <ReadyActions {...props} phase={phase} />
        </>
      );
    case 'available':
      return (
        <>
          <Title id={titleId} text={t('updates.details.availableTitle', { version: phase.version })} />
          <p>{t('updates.details.availableBody', { size: formatSize(phase.size) })}</p>
          {phase.waitingForUnmetered && <p>{t('updates.details.waitingForUnmetered')}</p>}
          <Notes notes={phase.notes} />
          <AvailableActions version={phase.version} place={place} onLater={onLater} />
        </>
      );
    case 'downloading': {
      const percent = phase.total > 0 ? Math.min(100, Math.round((phase.received / phase.total) * 100)) : undefined;
      return (
        <>
          <Title id={titleId} text={t('updates.details.downloadingTitle', { version: phase.version })} />
          <ProgressBar label={t('updates.details.downloadProgress')} value={percent} />
          <LaterOnly onLater={onLater} />
        </>
      );
    }
    case 'verifying':
      return (
        <>
          <Title id={titleId} text={t('updates.details.verifyingTitle', { version: phase.version })} />
          <p>{t('updates.details.verifyingBody')}</p>
          <LaterOnly onLater={onLater} />
        </>
      );
    case 'applying':
      return <Title id={titleId} text={t('updates.details.applyingTitle', { version: phase.version })} />;
    default:
      return null;
  }
}

/** Nothing for phases without an update in hand; the Updates section shows a status line for those. */
export function UpdateDetails(props: UpdateDetailsProps) {
  const body = <Body {...props} />;
  if (!hasDetails(props.phase)) return null;
  return (
    <div className={styles.details} data-place={props.place}>
      {body}
    </div>
  );
}

/** True for the phases that have details: an update is offered, downloading, checked, or installing. */
export function hasDetails(phase: UpdaterPhase): boolean {
  return ['available', 'downloading', 'verifying', 'ready', 'applying'].includes(phase.kind);
}
