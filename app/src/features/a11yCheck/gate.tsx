// "Check accessibility first" for Export, Print/PDF, and Send. The choice is remembered. When it is on, the checker
// runs on the pages about to be written and the report shows before anything is: the person can go on anyway,
// open the full report to fix things, or cancel. Pages with no problems go straight through.
import { useState } from 'react';
import { isEnabled } from '../../app/flags';
import { t } from '../../strings/t';
import { Dialog, Switch } from '../../ui';
import { pagesClient, showDialog } from '../qol';
import type { PageId } from '../../services/pages/types';
import { checkPage } from './check';
import type { Issue } from './check';
import styles from './A11y.module.css';

const KEY = 'opennote.a11y.checkFirst';

/** Whether the person asked for the check before output. */
export function checkFirstOn(): boolean {
  if (!isEnabled('qol.a11yGate')) return false;
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setCheckFirst(on: boolean): void {
  try {
    localStorage.setItem(KEY, String(on));
  } catch {
    // The choice just is not remembered.
  }
}

/** The switch for Export, Print/PDF, and Send dialogs. It shows nothing when the feature is off. */
export function CheckFirstSwitch() {
  const [on, setOn] = useState(checkFirstOn);
  if (!isEnabled('qol.a11yGate')) return null;
  return (
    <Switch
      label={t('qol.a11y.checkFirst')}
      checked={on}
      onChange={(value) => {
        setCheckFirst(value);
        setOn(value);
      }}
    />
  );
}

interface Found {
  readonly id: string;
  readonly issues: readonly Issue[];
}

/** Checks the pages, in order. A page that cannot be read counts as having no problems. */
export async function findProblems(pageIds: readonly string[]): Promise<Found[]> {
  const found: Found[] = [];
  for (const id of pageIds) {
    try {
      const open = await pagesClient().open(id as PageId, { viewport: null });
      try {
        found.push({ id, issues: checkPage(open.initial) });
      } finally {
        await open.close();
      }
    } catch {
      found.push({ id, issues: [] });
    }
  }
  return found;
}

type Choice = 'continue' | 'review' | 'cancel';

function GateDialog(props: { problems: readonly Issue[]; done(choice: Choice): void }) {
  const { problems, done } = props;
  return (
    <Dialog
      title={t('qol.a11y.gateTitle')}
      description={t('qol.a11y.gateSummary', { count: problems.length })}
      onDismiss={() => done('cancel')}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', leastDestructive: true, onPress: () => done('cancel') },
        { id: 'review', label: t('qol.a11y.gateReview'), variant: 'secondary', onPress: () => done('review') },
        { id: 'go', label: t('qol.a11y.gateContinue'), variant: 'primary', onPress: () => done('continue') },
      ]}
    >
      <ul className={styles.issues}>
        {problems.slice(0, 8).map((issue) => (
          <li key={issue.id}>{t(`qol.a11y.issues.${issue.kind}`, issue.params as never)}</li>
        ))}
      </ul>
    </Dialog>
  );
}

/**
 * Runs the check when the person turned it on. Resolves true when the output may go ahead: the check is off, found
 * nothing, or the person chose to go on. Choosing to review opens the full report and resolves false.
 */
export async function checkBeforeOutput(
  pageIds: readonly string[],
  review: () => void | Promise<void>,
): Promise<boolean> {
  if (!checkFirstOn() || pageIds.length === 0) return true;
  const problems = (await findProblems(pageIds)).flatMap((found) => found.issues);
  if (problems.length === 0) return true;
  const choice = await showDialog<Choice>((done) => <GateDialog problems={problems} done={done} />);
  if (choice === 'review') await review();
  return choice === 'continue';
}
