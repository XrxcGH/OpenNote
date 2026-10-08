// The side-by-side view of a page and its conflict copy: this version on one side, the other on the other, and the
// choice to keep this one, keep the other one, or keep both as separate pages. Nothing changes until a choice.

import { useEffect, useState } from 'react';
import { shellCall } from '../../platform/shellqol';
import { formatDate } from '../../strings/format';
import { t } from '../../strings/t';
import { Dialog, showToast } from '../../ui';
import { showDialog } from './dialogHost';
import { reloadPage } from './ExternalNotice';
import styles from './Conflict.module.css';

type Choice = 'keepMine' | 'keepTheirs' | 'keepBoth';

interface Texts {
  readonly mine: string;
  readonly theirs: string;
}

function ConflictContent(props: {
  pageId: string;
  revision: string;
  device: string;
  savedAt: string;
  more: number;
  done(): void;
}) {
  const [texts, setTexts] = useState<Texts | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    shellCall<Texts | null>('conflict.text', { pageId: props.pageId, revision: props.revision }).then(
      (loaded) => current && (loaded ? setTexts(loaded) : setFailed(true)),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [props.pageId, props.revision]);
  const resolve = async (choice: Choice) => {
    try {
      await shellCall('conflict.resolve', { pageId: props.pageId, revision: props.revision, choice });
    } catch {
      showToast({ message: t('qol.conflict.failed'), tone: 'danger' });
      return;
    }
    props.done();
    // Keeping the other version, or both, changes what the page shows.
    if (choice !== 'keepMine') void reloadPage(props.pageId);
    showToast({ message: t(`qol.conflict.done.${choice}`) });
  };
  const other = props.device || t('qol.conflict.otherDevice');
  return (
    <Dialog
      title={t('qol.conflict.title')}
      description={props.more > 1 ? t('qol.conflict.more', { count: props.more - 1 }) : t('qol.conflict.explain')}
      size="large"
      onDismiss={props.done}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'quiet', onPress: props.done },
        { id: 'both', label: t('qol.conflict.keepBoth'), variant: 'secondary', onPress: () => resolve('keepBoth') },
        {
          id: 'theirs',
          label: t('qol.conflict.keepTheirs'),
          variant: 'secondary',
          onPress: () => resolve('keepTheirs'),
        },
        { id: 'mine', label: t('qol.conflict.keepMine'), variant: 'primary', onPress: () => resolve('keepMine') },
      ]}
    >
      {failed && <p>{t('qol.conflict.unreadable')}</p>}
      {!failed && !texts && <p>{t('qol.conflict.loading')}</p>}
      {texts && (
        <div className={styles.columns}>
          <section aria-labelledby="conflict-mine">
            <h3 id="conflict-mine">{t('qol.conflict.mine')}</h3>
            <pre className={styles.text}>{texts.mine}</pre>
          </section>
          <section aria-labelledby="conflict-theirs">
            <h3 id="conflict-theirs">{t('qol.conflict.theirs', { device: other, date: formatDate(props.savedAt) })}</h3>
            <pre className={styles.text}>{texts.theirs}</pre>
          </section>
        </div>
      )}
    </Dialog>
  );
}

/** Opens the side-by-side view for the first open conflict of a page. */
export function openConflictDialog(
  pageId: string,
  first: { revision: string; device: { label?: string }; savedAt: string },
  count: number,
): Promise<void> {
  return showDialog<void>((done) => (
    <ConflictContent
      pageId={pageId}
      revision={first.revision}
      device={first.device.label ?? ''}
      savedAt={first.savedAt}
      more={count}
      done={() => done()}
    />
  ));
}
