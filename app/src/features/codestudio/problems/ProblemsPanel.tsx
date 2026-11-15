// The Problems panel (DESIGN 5.1 and 6.2): every problem of the project grouped by file, with each file's counts.
// A row opens the file at the problem's line. The diagnostics level in Settings, then Code, filters what shows.
import { t } from '../../../strings/t';
import type { StudioController } from '../window/controller';
import { groupProblems } from './group';
import type { ProblemCounts } from './group';
import styles from './problems.module.css';

export function countsText(counts: ProblemCounts): string {
  return [
    t('codeStudio.studio.problems.errors', { count: counts.errors }),
    t('codeStudio.studio.problems.warnings', { count: counts.warnings }),
    t('codeStudio.studio.problems.infos', { count: counts.infos }),
  ].join(', ');
}

export function ProblemsPanel({ controller }: { controller: StudioController }) {
  const order = controller.fileIds().map((id) => controller.pathOf(id));
  const groups = groupProblems(controller.problems(), order);
  if (groups.length === 0) return <p className={styles.none}>{t('codeStudio.studio.problems.none')}</p>;
  return (
    <div className={styles.problems}>
      {groups.map((group) => (
        <section key={group.file} className={styles.group} aria-label={group.file}>
          <h4 className={styles.file}>
            <span>{group.file}</span>
            <span className={styles.counts}>{countsText(group.counts)}</span>
          </h4>
          <ul className={styles.list}>
            {group.problems.map((problem, index) => (
              <li key={index}>
                <button
                  type="button"
                  className={styles.row}
                  data-severity={problem.severity}
                  onClick={() => controller.openPath(problem.file, problem.line, problem.column)}
                >
                  <span className={styles.severity}>
                    {t(`codeStudio.studio.problems.severity.${problem.severity}`)}
                  </span>
                  <span className={styles.message}>{problem.message}</span>
                  <span className={styles.where}>
                    {t('codeStudio.studio.problems.where', { line: problem.line, column: problem.column })}
                    {problem.code ? ` · ${problem.code}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
