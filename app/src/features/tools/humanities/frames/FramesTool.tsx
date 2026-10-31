// Note frames: pick a structure by subject or by searching, look at it, and insert it at the caret as headings,
// prompts, lists, and a table.
import '../text';
import { useMemo, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import { insertHtml, insertTable } from '../ui/insert';
import { Choice, Field, Fields, Note, Tool, ht, useInsertResult } from '../ui/parts';
import styles from '../ui/kit.module.css';
import { frameHtml, frameTable, parseOutline, searchFrames } from './engine';
import type { FrameBlock, FrameEntry, FrameGroup } from './engine';
import { FRAMES, FRAME_GROUPS } from './frames';
import type { FrameId } from './frames';

const ALL = 'all';

function Preview({ blocks, name }: { blocks: readonly FrameBlock[]; name: string }) {
  return (
    <div role="region" aria-label={t('kitHumanities.frames.preview', { name })} className={styles.group}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') return <strong key={index}>{block.text}</strong>;
        if (block.kind === 'prompt') return <em key={index}>{block.text}</em>;
        if (block.kind === 'table') return <Note key={index}>{block.header.join(' | ')}</Note>;
        const List = block.kind === 'bullets' ? 'ul' : 'ol';
        return (
          <List key={index} className={styles.list}>
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

export function FramesTool() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<FrameGroup | typeof ALL>(ALL);
  const [chosen, setChosen] = useState<FrameId>('essayPlanner');
  const entries = useMemo<FrameEntry[]>(
    () =>
      FRAMES.map((frame) => ({
        id: frame.id,
        group: frame.group,
        name: ht(`frames.f.${frame.id}.name`),
        keywords: ht(`frames.f.${frame.id}.keywords`),
        groupName: ht(`frames.groups.${frame.group}`),
      })),
    [],
  );
  const shown = searchFrames(query, entries).filter((entry) => group === ALL || entry.group === group);
  const current = shown.find((entry) => entry.id === chosen) ?? shown[0];
  const frame = current ? FRAMES.find((item) => item.id === current.id) : undefined;
  const blocks = frame ? parseOutline(ht(`frames.f.${frame.id}.outline`), frame.rows) : [];
  const use = frame ? ht(`frames.f.${frame.id}.use`) : '';

  const { notice, report } = useInsertResult();
  const insert = () => {
    const ok = insertHtml(frameHtml(blocks, use));
    const table = frameTable(blocks);
    report(ok && (!table || insertTable(table.header, table.rows)));
  };

  const groups: { value: FrameGroup | typeof ALL; label: string }[] = [
    { value: ALL, label: t('kitHumanities.frames.all') },
    ...FRAME_GROUPS.map((id) => ({ value: id, label: ht(`frames.groups.${id}`) })),
  ];
  return (
    <Tool label={t('kitHumanities.frames.title')}>
      <Fields>
        <Field label={t('kitHumanities.frames.search')} value={query} onChange={setQuery} />
        <Choice<FrameGroup | typeof ALL>
          label={t('kitHumanities.frames.group')}
          value={group}
          options={groups}
          onChange={setGroup}
        />
      </Fields>
      {shown.length === 0 ? (
        <Note>{t('kitHumanities.frames.none')}</Note>
      ) : (
        <label className={`${styles.field} ${styles.wide}`}>
          <span>
            {t('kitHumanities.frames.list')} ({t('kitHumanities.frames.count', { count: shown.length })})
          </span>
          <select
            size={Math.min(8, shown.length + 1)}
            value={current?.id}
            onChange={(event) => setChosen(event.target.value as FrameId)}
          >
            {shown.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {current ? (
        <>
          <Note>{use}</Note>
          <Preview blocks={blocks} name={current.name} />
          <div className={styles.actions}>
            <Button variant="primary" onClick={insert}>
              {t('kitHumanities.frames.insert')}
            </Button>
          </div>
          {notice}
        </>
      ) : null}
    </Tool>
  );
}
