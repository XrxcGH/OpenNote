// The code project's compact card on the page: its name, language, and file count, with Run, Open in Code studio,
// Export as .zip, and Import files. The code itself opens in the studio window; the card stays small.
import { useRef } from 'react';
import { DownloadSimple, FolderOpen, Play, UploadSimple } from '@phosphor-icons/react';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import type { CodeProject } from '../contracts';
import styles from './project.module.css';

export interface ProjectCardProps {
  project: CodeProject;
  /** True when the page is read-only or the project needs a newer app. */
  readOnly: boolean;
  /** True when the project came from a newer app (its `minEditor` is above this app's version). */
  newer: boolean;
  /** The fallback, shown for a project from a newer app. */
  fallback: string;
  status: string;
  onRun(): void;
  onOpen(): void;
  onExport(): void;
  onImport(files: File[]): void;
}

export function ProjectCard(props: ProjectCardProps) {
  const { project } = props;
  const input = useRef<HTMLInputElement>(null);
  const name = project.name.trim() || t('codeStudio.project.block');
  const count = Object.keys(project.files).length;
  const tests = Object.keys(project.tests).length;
  return (
    <section className={styles.card} aria-label={name}>
      <div className={styles.head}>
        <strong className={styles.name}>{name}</strong>
        <span className={styles.meta}>
          {t(`codeStudio.project.languages.${project.language}`)}
          {' · '}
          {t('codeStudio.project.card.files', { count })}
          {tests > 0 ? ` · ${t('codeStudio.project.card.tests', { count: tests })}` : ''}
          {props.readOnly && !props.newer ? ` · ${t('codeStudio.project.card.readOnly')}` : ''}
        </span>
      </div>
      {props.newer ? (
        <>
          <p className={styles.help} role="status">
            {t('codeStudio.project.card.newer')}
          </p>
          <pre className={styles.fallback}>{props.fallback}</pre>
        </>
      ) : null}
      <div className={styles.bar}>
        {props.newer ? null : (
          <>
            <Button variant="primary" onClick={props.onRun}>
              <Play aria-hidden weight="fill" /> {t('codeStudio.project.card.run')}
            </Button>
            <Button onClick={props.onOpen}>
              <FolderOpen aria-hidden /> {t('codeStudio.project.card.open')}
            </Button>
          </>
        )}
        <Button variant="quiet" onClick={props.onExport}>
          <DownloadSimple aria-hidden /> {t('codeStudio.project.card.exportZip')}
        </Button>
        {props.readOnly ? null : (
          <>
            <Button variant="quiet" onClick={() => input.current?.click()}>
              <UploadSimple aria-hidden /> {t('codeStudio.project.card.importFiles')}
            </Button>
            <input
              ref={input}
              className={styles.hidden}
              type="file"
              multiple
              aria-label={t('codeStudio.project.card.importLabel')}
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = '';
                if (files.length > 0) props.onImport(files);
              }}
            />
          </>
        )}
      </div>
      <p className={styles.help} role="status" aria-live="polite">
        {props.status}
      </p>
    </section>
  );
}
