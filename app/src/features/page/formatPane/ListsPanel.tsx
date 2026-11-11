// The Lists tab of the Format pane (text DESIGN.md 5.3): the caret's list level, as a new list definition.
import { useState } from 'react';
import { listLevelAt, setListLevel } from '../../../editor/commands/lists';
import type { ListLevelAt } from '../../../editor/commands/lists';
import { NUMBER_FORMATS } from '../../../editor/paragraph/numberFormats';
import { t } from '../../../strings/t';
import { Box, Choice, Group } from './controls';
import { lengthParse } from './fields';
import { run } from './TabsPanel';
import type { PanelProps } from './TabsPanel';
import { formatPoints } from './units';
import styles from './FormatPane.module.css';

type Patch = Parameters<typeof setListLevel>[0];

/** Sets some fields of the level, and gives back the message for the box that was wrong, or ''. */
function useLevelEdit({ editor, refresh }: PanelProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (id: string, patch: Patch, message?: string) => {
    const ran = run(editor, setListLevel(patch));
    setErrors((now) => ({ ...now, [id]: ran ? '' : (message ?? t('textPane.refused')) }));
    if (ran) refresh();
  };
  const length = (id: 'indent' | 'hanging', text: string) => {
    const result = lengthParse(0, 1584)(text);
    const message = result.ok ? t('textPane.invalid', { example: '36, 0.5in' }) : result.message;
    if (!result.ok || typeof result.value !== 'number') return setErrors((now) => ({ ...now, [id]: message }));
    set(id, { [id]: result.value });
  };
  return { errors, set, length };
}

function Kind({ at, edit }: { at: ListLevelAt; edit: ReturnType<typeof useLevelEdit> }) {
  const { level } = at;
  const { errors, set } = edit;
  if (level.format === 'bullet') {
    return (
      <>
        <Box
          label={t('textPane.lists.symbol')}
          value={level.symbol ?? ''}
          error={errors['symbol']}
          onCommit={(text) => set('symbol', { symbol: text }, t('textPane.invalid', { example: '•' }))}
        />
        <Box
          label={t('textPane.lists.symbolFont')}
          value={level.font ?? ''}
          error={errors['font']}
          onCommit={(text) => set('font', { font: text === '' ? undefined : text })}
        />
      </>
    );
  }
  return (
    <>
      <Box
        label={t('textPane.lists.pattern')}
        value={level.text}
        error={errors['pattern']}
        onCommit={(text) => set('pattern', { text }, t('textPane.invalid', { example: '%1.' }))}
      />
      <p className={styles.help}>{t('textPane.lists.patternHint')}</p>
      <Box
        label={t('textPane.lists.start')}
        value={String(level.start)}
        step={1}
        error={errors['start']}
        onCommit={(text) => set('start', { start: Number(text) }, t('textPane.range', { min: '0', max: '32767' }))}
      />
    </>
  );
}

export function ListsPanel(props: PanelProps) {
  const edit = useLevelEdit(props);
  const at = listLevelAt(props.editor.state);
  if (!at) return <p className={styles.help}>{t('textPane.noList')}</p>;
  const { level, depth } = at;
  return (
    <div className={styles.panel}>
      <Group title={`${t('textPane.group.level')}: ${t('textPane.lists.levelNow', { level: String(depth + 1) })}`}>
        <Choice
          label={t('textPane.lists.format')}
          field="format"
          options={NUMBER_FORMATS}
          value={level.format}
          onCommit={(value) => edit.set('format', { format: value as typeof level.format })}
        />
        <Kind at={at} edit={edit} />
        <Box
          label={t('textPane.lists.indent')}
          value={formatPoints(level.indent)}
          unit={t('textPane.unitPoints')}
          step={1}
          error={edit.errors['indent']}
          onCommit={(text) => edit.length('indent', text)}
        />
        <Box
          label={t('textPane.lists.hanging')}
          value={formatPoints(level.hanging)}
          unit={t('textPane.unitPoints')}
          step={1}
          error={edit.errors['hanging']}
          onCommit={(text) => edit.length('hanging', text)}
        />
      </Group>
    </div>
  );
}
