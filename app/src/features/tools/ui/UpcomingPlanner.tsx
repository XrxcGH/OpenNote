// Forms to add an exam or a class, and the lists to remove them from. Each part shows only while its flag is on.
import { useFlag } from '../../../app/flags';
import { t } from '../../../strings/t';
import { ClassForm } from './ClassForm';
import { ExamForm } from './ExamForm';
import styles from './tools.module.css';

export function Planner() {
  const showExams = useFlag('tools.exams');
  const showClasses = useFlag('tools.timetable');
  return (
    <details className={styles.group}>
      <summary>{t('study.planner.summary')}</summary>
      <div className={styles.form}>
        {showExams ? <ExamForm /> : null}
        {showClasses ? <ClassForm /> : null}
      </div>
    </details>
  );
}
