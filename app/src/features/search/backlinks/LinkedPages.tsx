// The linked pages pane. It lists the pages that link to the open page, with the words around each link. It lists
// the pages that say the title without linking it, with a Link button for each. After a rename it offers to update
// the links that still use the earlier title. The pane sits beside the page, follows the page that is open, and
// refreshes when the index changes.

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useLocation } from '../../../app/location';
import { commandContext } from '../../../commands/registry';
import type { Backlink, UnlinkedMention } from '../../../services/search/types';
import { t } from '../../../strings/t';
import { Button, announce, showToast } from '../../../ui';
import { titleOf, useTreeNode } from '../../tree';
import { maybeSearchClient } from '../client';
import { Highlighted } from '../Highlighted';
import { applyLinkEdits } from '../links/applyEdits';
import { linkMentionsOnPage } from '../links/mentions';
import { openPage } from '../locate';
import styles from '../search.module.css';

interface Loaded {
  page: string;
  links: Backlink[];
  mentions: UnlinkedMention[];
}

function useLinked(page: string | null): { loaded: Loaded | null; reload(): void } {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const client = maybeSearchClient();
    if (!client || !page) return;
    let current = true;
    const run = () =>
      void Promise.all([client.backlinks(page), client.unlinkedMentions(page, 50)])
        .then(([links, mentions]) => current && setLoaded({ page, links, mentions }))
        .catch(() => current && setLoaded({ page, links: [], mentions: [] }));
    run();
    // The index follows saves in the background, so the lists refresh when it reports a batch.
    const stop = client.onUpdate(run);
    return () => {
      current = false;
      stop();
    };
  }, [page, version]);
  return { loaded: loaded?.page === page ? loaded : null, reload: () => setVersion((before) => before + 1) };
}

const open = (page: string) => void openPage(commandContext('palette').notes, page);

function Backlinks({ links, busy, onUpdate }: { links: Backlink[]; busy: boolean; onUpdate(): void }) {
  return (
    <div className={styles.paneSection}>
      <h3 className={styles.paneSectionHeading}>{t('search.backlinks.linksHeading', { count: links.length })}</h3>
      {links.length === 0 ? (
        <p className={styles.note}>{t('search.backlinks.none')}</p>
      ) : (
        <ul className={styles.linkList}>
          {links.map((entry, at) => (
            <li key={`${entry.source}-${entry.block}-${at}`} className={styles.linkRow}>
              <button type="button" onClick={() => open(entry.source)}>
                {entry.sourceTitle || t('tree.page.noneTitle')}
              </button>
              {entry.context && (
                <span className={styles.linkContext}>
                  <Highlighted text={entry.context.text} ranges={entry.context.highlights} />
                </span>
              )}
              {entry.stale && <span className={styles.stale}>{t('search.backlinks.stale')}</span>}
            </li>
          ))}
        </ul>
      )}
      {links.some((entry) => entry.stale) && (
        <Button variant="secondary" disabled={busy} onClick={onUpdate}>
          {t('search.backlinks.update')}
        </Button>
      )}
    </div>
  );
}

interface MentionsProps {
  mentions: UnlinkedMention[];
  busy: boolean;
  onLink(mention: UnlinkedMention): void;
}

function Mentions({ mentions, busy, onLink }: MentionsProps) {
  return (
    <div className={styles.paneSection}>
      <h3 className={styles.paneSectionHeading}>{t('search.backlinks.mentionsHeading', { count: mentions.length })}</h3>
      {mentions.length === 0 ? (
        <p className={styles.note}>{t('search.backlinks.noMentions')}</p>
      ) : (
        <ul className={styles.linkList}>
          {mentions.map((mention) => (
            <li key={mention.source} className={styles.linkRow}>
              <button type="button" onClick={() => open(mention.source)}>
                {mention.sourceTitle || t('tree.page.noneTitle')}
              </button>
              <span className={styles.linkContext}>{t('search.backlinks.mentionCount', { count: mention.count })}</span>
              <Button
                variant="quiet"
                disabled={busy}
                aria-label={t('search.backlinks.linkLabel', { title: mention.sourceTitle })}
                onClick={() => onLink(mention)}
              >
                {t('search.backlinks.link')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Runs a change to links, tells the person what it did, and reloads the lists. */
function useAction(reload: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    try {
      const message = await work();
      showToast({ message });
      announce(message);
      reload();
    } catch {
      showToast({ message: t('search.backlinks.failed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export function LinkedPages({ onClose }: { onClose(): void }) {
  const location = useLocation();
  const page = location.view === 'workspace' ? location.pageId : null;
  const node = useTreeNode(page);
  const { loaded, reload } = useLinked(page);
  const { busy, run } = useAction(reload);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const search = maybeSearchClient();
  const update = () =>
    run(async () => {
      const edits = page && search ? await search.repairEdits(page) : [];
      const done = await applyLinkEdits(commandContext('palette').platform.pages, edits);
      return t('search.rename.done', { links: done.links, pages: done.pages });
    });
  const link = (mention: UnlinkedMention) =>
    run(async () => {
      if (!page || !search) return t('search.backlinks.failed');
      const { platform } = commandContext('palette');
      const target = { page, title: node ? titleOf(node) : '' };
      const count = await linkMentionsOnPage(platform.pages, search, mention, target);
      return t('search.backlinks.linked', { count, title: mention.sourceTitle });
    });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  };
  return (
    <section className={styles.pane} aria-labelledby="linked-pages-title" onKeyDown={onKeyDown}>
      <div className={styles.tagRow}>
        <h2 id="linked-pages-title" ref={heading} tabIndex={-1} className={styles.paneHeading}>
          {t('search.backlinks.title')}
        </h2>
        <Button variant="quiet" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
      {!page && <p className={styles.note}>{t('search.backlinks.noPage')}</p>}
      {page && !loaded && <p className={styles.note}>{t('search.backlinks.loading')}</p>}
      {loaded && <Backlinks links={loaded.links} busy={busy} onUpdate={() => void update()} />}
      {loaded && <Mentions mentions={loaded.mentions} busy={busy} onLink={(mention) => void link(mention)} />}
    </section>
  );
}
