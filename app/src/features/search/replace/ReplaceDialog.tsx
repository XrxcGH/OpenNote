// checks-disable-file modifiability: one dialog whose parts share its state; split it when it grows again
// Replace across the notebooks: type the words and what should take their place, and every place that holds them is
// listed with a few words around it. Each can be left out. Nothing changes until Replace, and one Undo puts every
// page back. Words that only appear in recognized handwriting or in a picture are listed too, but not changed,
// because the strokes and the picture stay as they were drawn.
import { useEffect, useMemo, useState } from 'react';
import { commandContext } from '../../../commands/registry';
import type { TextHit } from '../../../services/search/types';
import type { OverlayProps } from '../../../shell/commandbar/overlays';
import { t } from '../../../strings/t';
import { Dialog, Switch, TextField, announce, showToast } from '../../../ui';
import { maybeSearchClient } from '../client';
import styles from '../search.module.css';
import { applyReplace, undoReplace } from './apply';
import { planPage } from './plan';
import type { Match, ReplaceOptions } from './plan';

const MAX_PAGES = 200;

interface Plan {
  matches: Match[];
  /** Words found in recognized handwriting or in pictures, which Replace leaves as they are. */
  unchanged: TextHit[];
  truncated: boolean;
}

/** Reads the pages that hold the words and plans every match. */
async function makePlan(find: string, options: ReplaceOptions, signal: { stale: boolean }): Promise<Plan> {
  const extras = maybeSearchClient()?.extras;
  const hits = (await extras?.findText(find)) ?? [];
  const pageIds = [...new Set(hits.map((hit) => hit.page))];
  const { platform } = commandContext('palette');
  const matches: Match[] = [];
  for (const id of pageIds.slice(0, MAX_PAGES)) {
    if (signal.stale) break;
    try {
      const open = await platform.pages.open(id, { viewport: null });
      try {
        matches.push(...planPage(open.initial, find, options));
      } finally {
        await open.close();
      }
    } catch {
      // A page that can't be read now is left out of the plan.
    }
  }
  const covered = new Set(matches.map((match) => match.block));
  const unchanged = hits.filter((hit) => (hit.kind === 'ink' || hit.kind === 'images') && !covered.has(hit.block));
  return { matches, unchanged, truncated: pageIds.length > MAX_PAGES };
}

function Row({
  match,
  replacement,
  kept,
  onToggle,
}: {
  match: Match;
  replacement: string;
  kept: boolean;
  onToggle(): void;
}) {
  return (
    <li className={styles.replaceRow}>
      <label className={styles.replaceLabel}>
        <input
          type="checkbox"
          checked={kept}
          onChange={onToggle}
          aria-label={t('qolSearch.replace.keep', { title: match.pageTitle })}
        />
        <span className={styles.replaceText}>
          {match.before}
          <del className={styles.replaceOld}>{match.found}</del>
          <ins className={styles.replaceNew}>{replacement}</ins>
          {match.after}
        </span>
      </label>
    </li>
  );
}

export default function ReplaceDialog({ onClose, query = '' }: OverlayProps & { query?: string }) {
  const [find, setFind] = useState(query);
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [planned, setPlan] = useState<Plan | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const signal = { stale: false };
    if (find.trim() === '') return;
    const timer = setTimeout(() => {
      void makePlan(find, { matchCase, wholeWord }, signal)
        .then((made) => {
          if (signal.stale) return;
          setPlan(made);
          setSkipped(new Set());
        })
        .catch(() => !signal.stale && setPlan({ matches: [], unchanged: [], truncated: false }));
    }, 300);
    return () => {
      signal.stale = true;
      clearTimeout(timer);
    };
  }, [find, matchCase, wholeWord]);

  const plan = find.trim() === '' ? null : planned;
  const chosen = useMemo(() => plan?.matches.filter((match) => !skipped.has(match.id)) ?? [], [plan, skipped]);
  const pages = new Set(chosen.map((match) => match.page)).size;
  const byPage = useMemo(() => {
    const groups = new Map<string, Match[]>();
    for (const match of plan?.matches ?? []) groups.set(match.page, [...(groups.get(match.page) ?? []), match]);
    return [...groups.values()];
  }, [plan]);

  const run = async () => {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    const { platform } = commandContext('palette');
    const done = await applyReplace(platform.pages, chosen, replacement);
    onClose();
    const message = t('qolSearch.replace.done', { count: done.matches, pages: done.pages });
    announce(message);
    showToast({
      message,
      action: {
        label: t('qolSearch.replace.undo'),
        run: async () => {
          const restored = await undoReplace(platform.pages, done.written);
          showToast({ message: t('qolSearch.replace.undone', { count: restored }) });
        },
      },
    });
  };

  return (
    <Dialog
      title={t('qolSearch.replace.title')}
      description={t('qolSearch.replace.description')}
      size="large"
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: onClose },
        {
          id: 'replace',
          label: t('qolSearch.replace.run', { count: chosen.length }),
          variant: 'primary',
          onPress: run,
        },
      ]}
      onDismiss={onClose}
    >
      <div className={styles.panel}>
        <div className={styles.naming}>
          <TextField label={t('qolSearch.replace.find')} value={find} onChange={setFind} />
          <TextField label={t('qolSearch.replace.with')} value={replacement} onChange={setReplacement} />
        </div>
        <div className={styles.filters} role="group" aria-label={t('search.panel.filters')}>
          <Switch label={t('qolSearch.replace.matchCase')} checked={matchCase} onChange={setMatchCase} />
          <Switch label={t('qolSearch.replace.wholeWord')} checked={wholeWord} onChange={setWholeWord} />
        </div>
        <p role="status" className={styles.note}>
          {plan === null
            ? t('qolSearch.replace.start')
            : plan.matches.length === 0
              ? t('qolSearch.replace.none')
              : t('qolSearch.replace.summary', { count: chosen.length, pages })}
          {plan?.truncated ? ` ${t('qolSearch.replace.truncated', { count: MAX_PAGES })}` : ''}
        </p>
        <div className={styles.replaceList}>
          {byPage.map((group) => (
            <section key={group[0].page} className={styles.paneSection}>
              <h3 className={styles.paneSectionHeading}>
                {t('qolSearch.replace.page', { title: group[0].pageTitle, count: group.length })}
              </h3>
              <ul className={styles.linkList}>
                {group.map((match) => (
                  <Row
                    key={match.id}
                    match={match}
                    replacement={replacement}
                    kept={!skipped.has(match.id)}
                    onToggle={() =>
                      setSkipped((was) => {
                        const next = new Set(was);
                        if (!next.delete(match.id)) next.add(match.id);
                        return next;
                      })
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
          {plan && plan.unchanged.length > 0 && (
            <section className={styles.paneSection}>
              <h3 className={styles.paneSectionHeading}>{t('qolSearch.replace.unchangedTitle')}</h3>
              <p className={styles.note}>{t('qolSearch.replace.unchanged', { count: plan.unchanged.length })}</p>
            </section>
          )}
        </div>
      </div>
    </Dialog>
  );
}
