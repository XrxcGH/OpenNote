// The compare view (ARCHITECTURE.md section 21): static DOM through the page's schema. Added words are underlined in
// <ins> and removed words struck through in <del>, each with hidden "Added:" or "Removed:" text, because screen
// readers don't all announce those elements; colors pair with the lines, so color is never the only signal.
// Unchanged paragraphs collapse into buttons. Each change has its restore action.
import { useEffect, useRef, useState } from 'react';
import type { BlockChange, PageDiff, ParagraphChange } from '../../../editor/diff/pageDiff';
import type { WordPart } from '../../../editor/diff/myers';
import { parseTextBlock } from '../../../editor/markdown';
import { renderStatic } from '../../../editor/schema/dom';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import styles from './history.module.css';

export interface CompareActions {
  restoreParagraph(block: string, change: ParagraphChange, all: readonly ParagraphChange[]): void;
  restoreBlock(block: string): void;
}

function Static({ markdown }: { markdown: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.replaceChildren();
    renderStatic(parseTextBlock(markdown), ref.current);
  }, [markdown]);
  return <div ref={ref} className={styles.static} />;
}

function Marked({ kind, children }: { kind: 'added' | 'removed'; children: React.ReactNode }) {
  const label = (
    <span className={styles.hidden}>{t(kind === 'added' ? 'history.compare.added' : 'history.compare.removed')} </span>
  );
  return kind === 'added' ? (
    <ins className={styles.ins}>
      {label}
      {children}
    </ins>
  ) : (
    <del className={styles.del}>
      {label}
      {children}
    </del>
  );
}

function Words({ parts }: { parts: readonly WordPart[] }) {
  return (
    <p className={styles.words}>
      {parts.map((part, index) =>
        part.kind === 'same' ? (
          <span key={index}>{part.text}</span>
        ) : (
          <Marked key={index} kind={part.kind}>
            {part.text}
          </Marked>
        ),
      )}
    </p>
  );
}

function Unchanged({ items }: { items: readonly ParagraphChange[] }) {
  const [open, setOpen] = useState(false);
  if (open)
    return (
      <>
        {items.map((item, index) => (
          <Static key={index} markdown={item.after?.markdown ?? ''} />
        ))}
      </>
    );
  return (
    <Button variant="quiet" className={styles.unchanged} aria-expanded={false} onClick={() => setOpen(true)}>
      {t('history.compare.unchanged', { count: items.length })}
    </Button>
  );
}

function Paragraph({ change, onRestore }: { change: ParagraphChange; onRestore: (() => void) | null }) {
  const body =
    change.status === 'changed' && change.words ? (
      <Words parts={change.words} />
    ) : (
      <Marked kind={change.status === 'added' ? 'added' : 'removed'}>
        <Static markdown={(change.after ?? change.before)?.markdown ?? ''} />
      </Marked>
    );
  return (
    <div className={styles.change} data-change="" tabIndex={-1}>
      {body}
      {onRestore && (
        <Button variant="quiet" className={styles.restore} onClick={onRestore}>
          {t('history.restore.paragraph')}
        </Button>
      )}
    </div>
  );
}

/** A text block's paragraphs, with runs of unchanged ones collapsed. */
function TextChanges({ block, actions }: { block: Extract<BlockChange, { kind: 'text' }>; actions: CompareActions }) {
  const groups: (ParagraphChange | ParagraphChange[])[] = [];
  for (const change of block.paragraphs) {
    const last = groups.at(-1);
    if (change.status === 'same' && Array.isArray(last)) last.push(change);
    else groups.push(change.status === 'same' ? [change] : change);
  }
  const live = block.status !== 'removed';
  return (
    <>
      {groups.map((group, index) =>
        Array.isArray(group) ? (
          <Unchanged key={index} items={group} />
        ) : (
          <Paragraph
            key={index}
            change={group}
            onRestore={live && group.before ? () => actions.restoreParagraph(block.id, group, block.paragraphs) : null}
          />
        ),
      )}
    </>
  );
}

function describe(block: BlockChange): string {
  if (block.kind === 'table') {
    const { cells, rows } = block;
    return t('history.compare.table', { cells: cells.length, added: rows.added, removed: rows.removed });
  }
  if (block.kind === 'image') {
    const notes = block.notes.map((note) => t(`history.compare.${note}`)).join(', ');
    const name = t('history.compare.image', { alt: block.alt });
    return notes ? `${name}. ${t('history.compare.imageNotes', { notes })}` : name;
  }
  if (block.kind === 'other') return t('history.compare.other', { type: block.type });
  return '';
}

function BlockView({ block, actions }: { block: BlockChange; actions: CompareActions }) {
  const status =
    block.status === 'added'
      ? t('history.compare.blockAdded')
      : block.status === 'removed'
        ? t('history.compare.blockRemoved')
        : null;
  const restorable = block.status === 'removed' || (block.status === 'changed' && block.kind !== 'text');
  return (
    <section className={styles.block} aria-label={status ?? (describe(block) || undefined)}>
      {(status || block.moved) && (
        <p className={styles.note}>
          {[status, block.moved ? t('history.compare.moved') : null].filter(Boolean).join('. ')}
        </p>
      )}
      {block.kind === 'text' ? (
        <TextChanges block={block} actions={actions} />
      ) : (
        <div className={styles.change} data-change="" tabIndex={-1}>
          <p>{describe(block)}</p>
        </div>
      )}
      {restorable && (
        <Button variant="quiet" className={styles.restore} onClick={() => actions.restoreBlock(block.id)}>
          {t('history.restore.block')}
        </Button>
      )}
    </section>
  );
}

export function CompareView({ diff, actions }: { diff: PageDiff; actions: CompareActions }) {
  const shown = diff.blocks.filter((block) => block.status !== 'same' || block.moved);
  return (
    <div className={styles.compare} data-compare="">
      <p className={styles.summary}>
        {shown.length || diff.ink ? t('history.compare.summary', { ...diff.counts }) : t('history.compare.noChanges')}
      </p>
      {diff.ink && <p className={styles.note}>{t('history.compare.ink', diff.ink)}</p>}
      {shown.map((block) => (
        <BlockView key={block.id} block={block} actions={actions} />
      ))}
    </div>
  );
}

/** F8 and Shift+F8: focuses the next or previous change after focus. Returns false when there is none. */
export function moveToChange(root: Element, direction: 1 | -1): { index: number; total: number } | null {
  const changes = [...root.querySelectorAll<HTMLElement>('[data-change]')];
  if (!changes.length) return null;
  const focused = changes.findIndex((change) => change.contains(document.activeElement));
  const current = focused >= 0 ? focused : direction === 1 ? -1 : changes.length;
  const next = current + direction;
  if (next < 0 || next >= changes.length) return null;
  changes[next].focus();
  changes[next].scrollIntoView({ block: 'nearest' });
  return { index: next + 1, total: changes.length };
}
