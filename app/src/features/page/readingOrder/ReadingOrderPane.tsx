// The Reading order pane (ARCHITECTURE.md section 20.1; owner WP3): a list of the page's blocks in reading order,
// each named by its type and a short description. Move up and Move down, or Alt+Shift+Up and Down in the list,
// write the whole order with one setPage and say where the block went. "Reset to default order" removes the list.
// Choosing an option selects the block on the page and scrolls to it. Phase 5's ink regions join through the
// reading item providers.
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, Button } from '../../../ui';
import { liveBlock } from '../blocks/textBlock';
import type { MountedPage } from '../mount';
import { readingItemProviders } from '../registries';
import { summary } from './names';
import { moveInOrder, readingOrder } from './order';
import styles from './pane.module.css';

interface Item {
  key: string;
  label: string;
  /** Blocks move; reading items from providers only show where they fall. */
  block: boolean;
}

function columns(block: BlockJson): number {
  const markdown = typeof block.data.markdown === 'string' ? block.data.markdown : '';
  const header = markdown.split('\n').find((line) => line.includes('|')) ?? '';
  return Math.max(1, header.replace(/^\s*\||\|\s*$/g, '').split('|').length);
}

/** "Text: Light reactions", "Image: Cross-section of a leaf", "Table: 3 columns", or "Handwriting". */
export function itemLabel(block: BlockJson): string {
  if (block.type === 'text')
    return summary(block) ? t('page.order.text', { summary: summary(block) }) : t('page.order.textEmpty');
  if (block.type === 'image') {
    const alt = typeof block.data.alt === 'string' ? block.data.alt : '';
    return alt ? t('page.order.image', { alt }) : t('page.order.imageUnnamed');
  }
  if (block.type === 'table') return t('page.order.table', { columns: columns(block) });
  return block.type === 'ink' ? t('page.order.ink') : t('page.order.other');
}

/** The blocks and the providers' reading items, in reading order. */
function itemsOf(mounted: MountedPage): Item[] {
  // Labels quote each text box as it is now, not as the layer's copy last held it.
  const blocks = mounted.layer.blocks().map((block) => liveBlock(mounted.layer, block));
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const page = { ...mounted.page.initial, blocks };
  const extra = readingItemProviders.list().flatMap((provider) => provider.items(page));
  const stand = extra.map((item): BlockJson => ({
    id: item.key,
    type: 'readingItem',
    order: '~',
    created: '',
    modified: '',
    frame: { x: item.rect.x, y: item.rect.y },
    data: {},
  }));
  const preferred = blocks.map((block) => block.id);
  const labels = new Map(extra.map((item) => [item.key, item.label]));
  return readingOrder([...blocks, ...stand], preferred).map((key) => {
    const block = byId.get(key);
    return { key, label: block ? itemLabel(block) : (labels.get(key) ?? ''), block: block !== undefined };
  });
}

function useLayerVersion(mounted: MountedPage): number {
  const [version, setVersion] = useState(0);
  useEffect(() => mounted.layer.onChange(() => setVersion((value) => value + 1)), [mounted]);
  return version;
}

export function ReadingOrderPane({ mounted, onClose }: { mounted: MountedPage; onClose(): void }) {
  const version = useLayerVersion(mounted);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => itemsOf(mounted), [mounted, version]);
  const [active, setActive] = useState(0);
  const current = items[Math.min(active, items.length - 1)];

  const choose = (index: number) => {
    const item = items[index];
    if (!item) return;
    setActive(index);
    if (!item.block) return;
    mounted.objects.select([item.key]);
    const rect = mounted.layer.view(item.key)?.measure();
    if (rect) mounted.viewport.scrollIntoView(rect, { block: 'nearest' });
  };

  const move = (by: -1 | 1) => {
    if (!current?.block || mounted.page.readOnly) return;
    const order = items.filter((item) => item.block).map((item) => item.key);
    const next = moveInOrder(order, current.key, by);
    if (!next) return;
    mounted.layer.setPreferredOrder(next);
    void mounted.sync.send({ edits: [{ edit: 'setPage', view: { readingOrder: next } }] }).catch(() => undefined);
    setActive(active + by);
    announce(t('page.order.movedTo', { index: next.indexOf(current.key) + 1, count: next.length }));
  };

  const reset = () => {
    mounted.layer.setPreferredOrder([]);
    void mounted.sync.send({ edits: [{ edit: 'setPage', view: { readingOrder: null } }] }).catch(() => undefined);
    announce(t('page.order.resetDone'));
  };

  const onKey = (event: KeyboardEvent) => {
    const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (by !== 0 && event.altKey && event.shiftKey) move(by);
    else if (by !== 0) choose(Math.max(0, Math.min(items.length - 1, active + by)));
    else if (event.key === 'Home') choose(0);
    else if (event.key === 'End') choose(items.length - 1);
    else if (event.key === 'Escape') onClose();
    else return;
    event.preventDefault();
  };

  return (
    <aside className={styles.pane} aria-label={t('page.order.title')}>
      <h2 className={styles.title}>{t('page.order.title')}</h2>
      <ul
        role="listbox"
        aria-label={t('page.order.list')}
        tabIndex={0}
        className={styles.list}
        aria-activedescendant={current ? `reading-${current.key}` : undefined}
        onKeyDown={onKey}
      >
        {items.map((item, index) => (
          <li
            key={item.key}
            id={`reading-${item.key}`}
            role="option"
            aria-selected={item === current}
            className={styles.option}
            onClick={() => choose(index)}
          >
            {item.label}
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button onClick={() => move(-1)} disabled={!current?.block || active === 0}>
          {t('page.order.moveUp')}
        </Button>
        <Button onClick={() => move(1)} disabled={!current?.block || active >= items.length - 1}>
          {t('page.order.moveDown')}
        </Button>
        <Button variant="quiet" onClick={reset}>
          {t('page.order.reset')}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          {t('page.order.close')}
        </Button>
      </div>
    </aside>
  );
}
