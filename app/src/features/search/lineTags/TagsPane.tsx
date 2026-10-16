// checks-disable-file modifiability: one dialog whose parts share its state; split it when it grows again
// The Tags pane: the lines people tagged, and their open checkboxes, from the page, the section, the notebook, or
// every notebook, grouped by tag, by page, or by date. A To do line checks off in place. Create summary page saves
// the groups as a page of their own, each line linked back to where it came from.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from '../../../app/location';
import { commandContext } from '../../../commands/registry';
import type { NodeId } from '../../../services/notes/types';
import type { ScopeRef } from '../../../services/search/types';
import type { OverlayProps } from '../../../shell/commandbar/overlays';
import { t } from '../../../strings/t';
import { Button, Dialog, announce, showToast } from '../../../ui';
import { maybeSearchClient } from '../client';
import { openAndReveal } from '../deeplink/jump';
import styles from './lineTags.module.css';
import { tagIcon, tagName } from './defs';
import { createSummaryPage, setLineBox } from './summaryPage';
import { groupLines, linesOfBlocks, summaryMarkdown } from './summary';
import type { GroupBy, TaggedLine } from './summary';

type ScopeKind = 'page' | 'section' | 'notebook' | 'all';
const SCOPES: readonly ScopeKind[] = ['page', 'section', 'notebook', 'all'];
const GROUPS: readonly GroupBy[] = ['tag', 'page', 'date'];

function Chip({ tag }: { tag: string }) {
  return (
    <span className={styles.chip}>
      <span
        aria-hidden="true"
        ref={(node) => {
          if (node && node.childElementCount === 0) node.append(tagIcon(tag));
        }}
      />
      {tagName(tag)}
    </span>
  );
}

function Choice<V extends string>({
  label,
  value,
  values,
  name,
  onChange,
}: {
  label: string;
  value: V;
  values: readonly V[];
  name: (value: V) => string;
  onChange(value: V): void;
}) {
  return (
    <div role="group" aria-label={label} className={styles.choice}>
      <span className={styles.choiceLabel}>{label}</span>
      {values.map((candidate) => (
        <Button
          key={candidate}
          variant={candidate === value ? 'primary' : 'secondary'}
          aria-pressed={candidate === value}
          onClick={() => onChange(candidate)}
        >
          {name(candidate)}
        </Button>
      ))}
    </div>
  );
}

export default function TagsPane({ onClose }: OverlayProps) {
  const here = useLocation();
  const workspace = here.view === 'workspace' ? here : null;
  const [scope, setScope] = useState<ScopeKind>(workspace?.pageId ? 'page' : 'all');
  const [by, setBy] = useState<GroupBy>('tag');
  const [lines, setLines] = useState<TaggedLine[] | null>(null);
  const [version, setVersion] = useState(0);

  const scopeRef = useMemo((): ScopeRef | null => {
    if (scope === 'all') return { kind: 'all' };
    const id =
      scope === 'page' ? workspace?.pageId : scope === 'section' ? workspace?.sectionId : workspace?.notebookId;
    return id ? { kind: scope, id } : null;
  }, [scope, workspace?.pageId, workspace?.sectionId, workspace?.notebookId]);

  useEffect(() => {
    let current = true;
    const extras = maybeSearchClient()?.extras;
    if (!extras || !scopeRef) return;
    extras
      .taggedBlocks(scopeRef)
      .then((blocks) => current && setLines(linesOfBlocks(blocks)))
      .catch(() => current && setLines([]));
    return () => {
      current = false;
    };
  }, [scopeRef, version]);

  const usable = maybeSearchClient()?.extras !== undefined && scopeRef !== null;
  const groups = useMemo(
    () => groupLines(usable ? (lines ?? []) : [], by, t('qolSearch.tagsPane.openBoxes')),
    [lines, by, usable],
  );

  const open = (line: TaggedLine) => {
    onClose();
    void openAndReveal(commandContext('palette').notes, line.page, line.element ?? line.block);
  };

  const toggle = useCallback(async (line: TaggedLine) => {
    try {
      await setLineBox(commandContext('palette').platform.pages, line, line.box !== 'done');
      setVersion((was) => was + 1);
      announce(
        t(line.box === 'done' ? 'qolSearch.tagsPane.reopened' : 'qolSearch.tagsPane.checked', { text: line.text }),
      );
    } catch {
      showToast({ message: t('qolSearch.tagsPane.checkFailed'), tone: 'danger' });
    }
  }, []);

  const summarize = async () => {
    const { notes } = commandContext('palette');
    const parent = (workspace?.sectionId ?? null) as NodeId | null;
    try {
      const made = await createSummaryPage(
        notes,
        commandContext('palette').platform.pages,
        parent,
        summaryMarkdown(groups),
      );
      showToast({ message: t('qolSearch.tagsPane.summaryMade', { title: made.title }) });
      onClose();
    } catch {
      showToast({ message: t('qolSearch.tagsPane.summaryFailed'), tone: 'danger' });
    }
  };

  const scopeName = (kind: ScopeKind) => t(`qolSearch.tagsPane.scopes.${kind}`);
  return (
    <Dialog
      title={t('qolSearch.tagsPane.title')}
      description={t('qolSearch.tagsPane.description')}
      size="large"
      actions={[
        {
          id: 'summary',
          label: t('qolSearch.tagsPane.createSummary'),
          variant: 'secondary',
          onPress: summarize,
        },
        { id: 'close', label: t('common.close'), variant: 'primary', onPress: onClose },
      ]}
      onDismiss={onClose}
    >
      <div className={styles.controls}>
        <Choice<ScopeKind>
          label={t('qolSearch.tagsPane.lookIn')}
          value={scope}
          values={SCOPES}
          name={scopeName}
          onChange={setScope}
        />
        <Choice<GroupBy>
          label={t('qolSearch.tagsPane.groupBy')}
          value={by}
          values={GROUPS}
          name={(value) => t(`qolSearch.tagsPane.groups.${value}`)}
          onChange={setBy}
        />
      </div>
      {scope !== 'all' && scopeRef === null && <p className={styles.note}>{t('qolSearch.tagsPane.noPlace')}</p>}
      {usable && lines === null && <p className={styles.note}>{t('qolSearch.tagsPane.loading')}</p>}
      {usable && lines?.length === 0 && <p className={styles.note}>{t('qolSearch.tagsPane.none')}</p>}
      <div className={styles.groups}>
        {groups.map((group) => (
          <section key={group.key} className={styles.group}>
            <h3 className={styles.groupTitle}>
              {group.label}{' '}
              <span className={styles.count}>{t('qolSearch.tagsPane.count', { count: group.lines.length })}</span>
            </h3>
            <ul className={styles.lines}>
              {group.lines.map((line) => (
                <li key={`${group.key}|${line.key}`} className={styles.line}>
                  {line.box !== null && (
                    <input
                      type="checkbox"
                      className={styles.box}
                      checked={line.box === 'done'}
                      aria-label={t('qolSearch.tagsPane.boxLabel', { text: line.text })}
                      onChange={() => void toggle(line)}
                    />
                  )}
                  <span className={styles.lineText} data-done={line.box === 'done' ? 'true' : undefined}>
                    {line.text || t('qolSearch.tagsPane.emptyLine')}
                  </span>
                  {by !== 'tag' && line.tags.filter((tag) => tag !== 'todo').map((tag) => <Chip key={tag} tag={tag} />)}
                  {by === 'tag' && line.tags.length > 1 && line.tags.map((tag) => <Chip key={tag} tag={tag} />)}
                  <button type="button" className={styles.link} onClick={() => open(line)}>
                    {by === 'page' ? t('qolSearch.tagsPane.go') : line.title || t('tree.page.noneTitle')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
