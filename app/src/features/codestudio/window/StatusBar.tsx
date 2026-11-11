// The status bar (DESIGN 5.1): problem counts (a button to the Problems panel), line and column, the language,
// the runtime's version, the suggestion engine, and the run state.
import { useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { countProblems } from '../problems/group';
import { countsText } from '../problems/ProblemsPanel';
import { engineKey } from '../settings/model';
import type { StudioController } from './controller';
import { fileLanguage, languageName, runtimeName } from './languages';
import styles from './studio.module.css';

export function StatusBar({ controller }: { controller: StudioController }) {
  const code = useSettings((settings) => settings.code);
  const project = controller.project()!;
  const counts = countProblems(controller.problems());
  const active = controller.activeFile ? controller.pathOf(controller.activeFile) : null;
  const version = controller.runtimeVersion ?? runtimeName(project.runtime);
  return (
    <footer className={styles.status} aria-label={t('codeStudio.studio.status.label')}>
      <button type="button" className={styles.statusButton} onClick={() => controller.showPanel('problems')}>
        {countsText(counts)}
      </button>
      {active && (
        <span>
          {t('codeStudio.studio.status.position', { line: controller.cursor.line, column: controller.cursor.column })}
        </span>
      )}
      {active && <span>{languageName(fileLanguage(active))}</span>}
      <span title={t('codeStudio.studio.status.runtime')}>{version}</span>
      <span title={t('codeStudio.studio.status.engine')}>{t(engineKey(code))}</span>
      <span role="status" className={styles.runState}>
        {t(`codeStudio.studio.status.run.${controller.runState}`)}
      </span>
    </footer>
  );
}
