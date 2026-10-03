// Manage tags: every tag with the number of pages that carry it, nested tags indented. Rename shows what would
// change before it does anything (how many pages, and whether the new name already exists, which merges the two),
// and applies it as one edit per page. Delete takes the hash off, so the words stay in the text.

import { useEffect, useState } from 'react';
import { useLocation } from '../../../app/location';
import { commandContext } from '../../../commands/registry';
import type { TagNode, TagPlan } from '../../../services/search/types';
import type { OverlayProps } from '../../../shell/commandbar/overlays';
import { t } from '../../../strings/t';
import { Button, Dialog, TextField, announce, showToast } from '../../../ui';
import { maybeSearchClient } from '../client';
import styles from '../search.module.css';
import { addTagToPage, applyTagPlan, normalTag } from './rewrite';

type Editing = { tag: string; mode: 'rename' | 'delete' } | null;

function useTagList(version: number): TagNode[] | null {
  const [tags, setTags] = useState<TagNode[] | null>(null);
  useEffect(() => {
    let current = true;
    maybeSearchClient()
      ?.tagTree()
      .then((list) => current && setTags(list))
      .catch(() => current && setTags([]));
    return () => {
      current = false;
    };
  }, [version]);
  return tags;
}

function describe(plan: TagPlan, from: string, to: string | null): string {
  if (plan.pageCount === 0) return t('search.tags.nothing', { tag: from });
  if (to === null) return t('search.tags.deletePlan', { tag: from, count: plan.pageCount });
  return plan.merges
    ? t('search.tags.mergePlan', { from, to, count: plan.pageCount })
    : t('search.tags.renamePlan', { from, to, count: plan.pageCount });
}

function Editor({ editing, onDone }: { editing: NonNullable<Editing>; onDone(changed: boolean): void }) {
  const [name, setName] = useState(editing.tag);
  const [plan, setPlan] = useState<TagPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const deleting = editing.mode === 'delete';
  const target = deleting ? null : normalTag(name);
  useEffect(() => {
    const client = maybeSearchClient();
    if (!client || (!deleting && !target)) return;
    let current = true;
    const timer = setTimeout(() => {
      const planned = deleting ? client.planTagDelete(editing.tag) : client.planTagRename(editing.tag, target ?? '');
      void planned.then((answer) => current && setPlan(answer)).catch(() => current && setPlan(null));
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [deleting, editing.tag, target]);
  const ready = plan !== null && plan.pageCount > 0 && (deleting || (target !== '' && target !== editing.tag));
  const apply = async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const done = await applyTagPlan(commandContext('palette').platform.pages, plan);
      showToast({ message: t('search.tags.done', { count: done.pages }) });
      announce(t('search.tags.done', { count: done.pages }));
      onDone(true);
    } catch {
      showToast({ message: t('search.tags.failed'), tone: 'danger' });
      setBusy(false);
    }
  };
  return (
    <div className={styles.paneSection}>
      {!deleting && (
        <TextField
          label={t('search.tags.newName', { tag: editing.tag })}
          value={name}
          onChange={setName}
          onCommit={() => ready && void apply()}
          onCancel={() => onDone(false)}
          autoSelect
        />
      )}
      <p role="status" className={styles.note}>
        {plan && (deleting || target) ? describe(plan, editing.tag, deleting ? null : target) : ''}
      </p>
      <div className={styles.tagRow}>
        <Button variant={deleting ? 'danger' : 'primary'} disabled={!ready || busy} onClick={() => void apply()}>
          {deleting ? t('search.tags.delete') : plan?.merges ? t('search.tags.merge') : t('search.tags.rename')}
        </Button>
        <Button variant="quiet" onClick={() => onDone(false)}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

function AddTag({ onAdded }: { onAdded(): void }) {
  const location = useLocation();
  const page = location.view === 'workspace' ? location.pageId : null;
  const [name, setName] = useState('');
  const add = async () => {
    const tag = normalTag(name);
    if (!page || !tag) return;
    try {
      const added = await addTagToPage(commandContext('palette').platform.pages, page, tag);
      const message = added ? t('search.tags.added', { tag }) : t('search.tags.has', { tag });
      showToast({ message });
      announce(message);
      setName('');
      if (added) onAdded();
    } catch {
      showToast({ message: t('search.tags.failed'), tone: 'danger' });
    }
  };
  if (!page) return <p className={styles.note}>{t('search.tags.noPage')}</p>;
  return (
    <div className={styles.naming}>
      <TextField label={t('search.tags.addLabel')} value={name} onChange={setName} onCommit={() => void add()} />
      <Button variant="secondary" disabled={!normalTag(name)} onClick={() => void add()}>
        {t('search.tags.add')}
      </Button>
    </div>
  );
}

export default function TagsDialog({ onClose }: OverlayProps) {
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const tags = useTagList(version);
  return (
    <Dialog
      title={t('search.tags.title')}
      description={t('search.tags.description')}
      size="medium"
      actions={[{ id: 'close', label: t('common.close'), variant: 'secondary', onPress: onClose }]}
      onDismiss={onClose}
    >
      <AddTag onAdded={() => setVersion((before) => before + 1)} />
      {tags === null && <p className={styles.note}>{t('search.tags.loading')}</p>}
      {tags?.length === 0 && <p className={styles.note}>{t('search.tags.none')}</p>}
      <ul className={styles.linkList} aria-label={t('search.tags.list')}>
        {tags?.map((node) => {
          const depth = node.tag.split('/').length - 1;
          const open = editing?.tag === node.tag;
          return (
            <li key={node.tag} className={styles.linkRow} style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
              <span className={styles.tagRow}>
                <strong>{node.tag.split('/').pop()}</strong>
                <span className={styles.linkContext}>{t('search.tags.pages', { count: node.pages })}</span>
                {!open && (
                  <>
                    <Button
                      variant="quiet"
                      aria-label={t('search.tags.renameLabel', { tag: node.tag })}
                      onClick={() => setEditing({ tag: node.tag, mode: 'rename' })}
                    >
                      {t('search.tags.rename')}
                    </Button>
                    <Button
                      variant="quiet"
                      aria-label={t('search.tags.deleteLabel', { tag: node.tag })}
                      onClick={() => setEditing({ tag: node.tag, mode: 'delete' })}
                    >
                      {t('search.tags.delete')}
                    </Button>
                  </>
                )}
              </span>
              {open && editing && (
                <Editor
                  editing={editing}
                  onDone={(changed) => {
                    setEditing(null);
                    if (changed) setVersion((before) => before + 1);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
