// The preview for "Link all": every place the title appears without a link, with the words around it and a check
// box. Nothing changes until Link. The checked places are linked as one change set with one Undo.
import { useEffect, useMemo, useState } from 'react';
import { commandContext } from '../../../commands/registry';
import type { UnlinkedMention } from '../../../services/search/types';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import { recordChange, undoPageChanges } from '../changeSet';
import { maybeSearchClient } from '../client';
import styles from '../search.module.css';
import { applyLinkAll, planLinkAll } from './linkAll';
import type { MentionItem } from './linkAll';

interface Props {
  target: { page: string; title: string };
  mentions: readonly UnlinkedMention[];
  onClose(): void;
}

export function LinkAllDialog({ target, mentions, onClose }: Props) {
  const [items, setItems] = useState<MentionItem[] | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const search = maybeSearchClient();
    if (!search) return;
    let current = true;
    void planLinkAll(commandContext('palette').platform.pages, search, mentions, target.title)
      .then((list) => current && setItems(list))
      .catch(() => current && setItems([]));
    return () => {
      current = false;
    };
  }, [mentions, target.title]);
  const chosen = useMemo(() => (items ?? []).filter((item) => !skipped.has(item.id)), [items, skipped]);
  const groups = useMemo(() => {
    const out = new Map<string, MentionItem[]>();
    for (const item of items ?? []) out.set(item.source, [...(out.get(item.source) ?? []), item]);
    return [...out.values()];
  }, [items]);
  const toggle = (id: string) =>
    setSkipped((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const run = async () => {
    const search = maybeSearchClient();
    if (!search || busy || chosen.length === 0) return;
    setBusy(true);
    const { platform } = commandContext('palette');
    const done = await applyLinkAll(platform.pages, search, chosen, target);
    onClose();
    const message = t('search.backlinks.linkAllDone', { count: done.count, pages: done.pages });
    recordChange({ label: message, undo: () => undoPageChanges(platform.pages, done.changes) }, message);
  };
  return (
    <Dialog
      title={t('search.backlinks.linkAllTitle', { title: target.title })}
      description={t('search.backlinks.linkAllDescription')}
      size="large"
      onDismiss={onClose}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', leastDestructive: true, onPress: onClose },
        {
          id: 'link',
          label: t('search.backlinks.linkAllRun', { count: chosen.length }),
          variant: 'primary',
          onPress: run,
        },
      ]}
    >
      {items === null ? (
        <p className={styles.note}>{t('search.backlinks.loading')}</p>
      ) : items.length === 0 ? (
        <p className={styles.note}>{t('search.backlinks.noMentions')}</p>
      ) : (
        groups.map((group) => (
          <section key={group[0].source} aria-label={group[0].sourceTitle}>
            <h3 className={styles.paneSectionHeading}>{group[0].sourceTitle || t('tree.page.noneTitle')}</h3>
            <ul className={styles.linkList}>
              {group.map((item) => (
                <li key={item.id} className={styles.linkRow}>
                  <label>
                    <input type="checkbox" checked={!skipped.has(item.id)} onChange={() => toggle(item.id)} />{' '}
                    <span className={styles.linkContext}>
                      {item.before}
                      <strong>{item.text}</strong>
                      {item.after}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </Dialog>
  );
}

export default LinkAllDialog;
