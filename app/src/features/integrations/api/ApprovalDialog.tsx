// The question OpenNote asks before an app connects or changes notes. Don't allow is the choice that loses
// nothing, so it has the focus first, and Escape means no. For a new app the person picks what it may do and which
// notebooks it sees: reading only, on the open notebook, unless they choose more.

import { useState } from 'react';
import { getLocation } from '../../../app/location';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import type { DialogAction } from '../../../ui';
import styles from './AppPermissions.module.css';
import { ScopePicker, useNotebookChoices } from './ScopePicker';
import type { Access, ApprovalRequest, Decision, Scope } from './types';

/** What a new app starts with: reading, on the notebook that is open, if one is. */
export function defaultScope(): Scope {
  const location = getLocation();
  const notebook = location.view === 'workspace' ? location.notebookId : null;
  return { kind: 'notebooks', ids: notebook ? [notebook] : [] };
}

export function ApprovalDialog(props: { request: ApprovalRequest; onDecide(decision: Decision): void }) {
  const { request, onDecide } = props;
  const notebooks = useNotebookChoices();
  const [access, setAccess] = useState<Access>('read');
  const [scope, setScope] = useState<Scope>(defaultScope);
  const deny: DialogAction = {
    id: 'deny',
    label: t('platformApi.ask.deny'),
    variant: 'secondary',
    leastDestructive: true,
    onPress: () => onDecide({ kind: 'deny' }),
  };
  if (request.question.kind === 'change') {
    const { action, target } = request.question;
    return (
      <Dialog
        title={t('platformApi.ask.changeTitle')}
        description={t('platformApi.ask.changeBody', { name: request.appName, action, target })}
        initialFocus="leastDestructive"
        onDismiss={() => onDecide({ kind: 'deny' })}
        actions={[
          deny,
          {
            id: 'always',
            label: t('platformApi.ask.changeAlways'),
            variant: 'secondary',
            onPress: () => onDecide({ kind: 'allow', always: true }),
          },
          {
            id: 'once',
            label: t('platformApi.ask.changeOnce'),
            variant: 'primary',
            onPress: () => onDecide({ kind: 'allow', always: false }),
          },
        ]}
      />
    );
  }
  const noNotebook = scope.kind === 'notebooks' && scope.ids.length === 0;
  const kind = t(`platformApi.apps.kind.${request.question.appKind}`);
  return (
    <Dialog
      title={t('platformApi.ask.connectTitle', { name: request.appName })}
      description={t('platformApi.ask.connectBody', { name: request.appName, kind })}
      size="medium"
      initialFocus="leastDestructive"
      onDismiss={() => onDecide({ kind: 'deny' })}
      actions={[
        deny,
        {
          id: 'allow',
          label: t('platformApi.ask.connectAllow'),
          variant: 'primary',
          onPress: () => {
            if (!noNotebook) onDecide({ kind: 'allow', access, notebooks: scope });
          },
        },
      ]}
    >
      <div className={styles.dialogBody}>
        <label className={styles.field}>
          <span>{t('platformApi.apps.access.label')}</span>
          <select value={access} onChange={(event) => setAccess(event.target.value as Access)}>
            <option value="read">{t('platformApi.apps.access.read')}</option>
            <option value="readWrite">{t('platformApi.apps.access.readWrite')}</option>
          </select>
        </label>
        <ScopePicker
          legend={t('platformApi.apps.notebooks.label')}
          value={scope}
          onChange={setScope}
          notebooks={notebooks}
        />
        {noNotebook && (
          <p className={styles.note} role="status">
            {t('platformApi.ask.pickNotebook')}
          </p>
        )}
      </div>
    </Dialog>
  );
}
