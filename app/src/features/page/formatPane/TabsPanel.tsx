// The Tabs tab of the Format pane (text DESIGN.md 5.3): the paragraph's tab stops and the default interval.
import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { Command } from '../../../editor/commands/command';
import type { TabAlign, TabLeader, TabStop } from '../../../editor/paragraph/attributes';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button } from '../../../ui';
import {
  TAB_ALIGNS,
  TAB_LEADERS,
  clearAllTabStops,
  clearTabStop,
  defaultTabInterval,
  setDefaultTabInterval,
  setTabStop,
  tabsAt,
} from './blocks';
import { Box, Choice, Group } from './controls';
import { lengthParse } from './fields';
import { optionLabel } from './labels';
import { formatPoints } from './units';
import styles from './FormatPane.module.css';

export interface PanelProps {
  editor: Editor;
  /** Draws the pane again after a command ran. */
  refresh(): void;
  notebook: string;
}

/** Runs a command on the editor. */
export function run(editor: Editor, command: Command): boolean {
  return command(editor.state, editor.view.dispatch);
}

/** The position typed in the box: points from 0 to 1584, or the message that says why not. */
function positionOf(text: string): { at: number } | { message: string } {
  const result = lengthParse(0, 1584)(text);
  if (!result.ok) return { message: result.message };
  if (typeof result.value !== 'number') return { message: t('textPane.invalid', { example: '36, 1in' }) };
  return { at: result.value };
}

function StopList({ stops }: { stops: readonly TabStop[] }) {
  if (stops.length === 0) return <p className={styles.help}>{t('textPane.tabs.empty')}</p>;
  return (
    <ul className={styles.list} aria-label={t('textPane.tabs.listLabel')}>
      {stops.map((stop) => (
        <li key={stop.pos} className={styles.detail}>
          {t('textPane.tabs.stop', {
            pos: formatPoints(stop.pos),
            align: optionLabel('tabAlign', stop.align),
            leader: optionLabel('tabLeader', stop.leader),
          })}
        </li>
      ))}
    </ul>
  );
}

function Interval() {
  const interval = useStore(defaultTabInterval, (now) => now);
  const [error, setError] = useState<string | undefined>();
  return (
    <Box
      label={t('textPane.tabs.interval')}
      value={formatPoints(interval)}
      unit={t('textPane.unitPoints')}
      step={1}
      error={error}
      onCommit={(text) => {
        const result = lengthParse(1, 1584)(text);
        const ok = result.ok && typeof result.value === 'number';
        if (!ok) return setError(result.ok ? t('textPane.invalid', { example: '36, 0.5in' }) : result.message);
        setError(undefined);
        setDefaultTabInterval(result.value as number);
      }}
    />
  );
}

export function TabsPanel({ editor, refresh }: PanelProps) {
  const [pos, setPos] = useState('');
  const [align, setAlign] = useState<TabAlign>('start');
  const [leader, setLeader] = useState<TabLeader>('none');
  const [error, setError] = useState<string | undefined>();
  const act = (build: (at: number) => Command, failure?: string) => {
    const where = positionOf(pos);
    if ('message' in where) return setError(where.message);
    if (!run(editor, build(where.at)) && failure) return setError(failure);
    setError(undefined);
    refresh();
  };
  const all = () => {
    run(editor, clearAllTabStops());
    refresh();
  };
  return (
    <div className={styles.panel}>
      <Group title={t('textPane.group.tabStops')}>
        <Box
          label={t('textPane.tabs.position')}
          value={pos}
          unit={t('textPane.unitPoints')}
          error={error}
          onCommit={(text) => {
            setPos(text);
            setError(undefined);
          }}
        />
        <Choice
          label={t('textPane.tabs.align')}
          field="tabAlign"
          options={TAB_ALIGNS}
          value={align}
          onCommit={(value) => setAlign(value as TabAlign)}
        />
        <Choice
          label={t('textPane.tabs.leader')}
          field="tabLeader"
          options={TAB_LEADERS}
          value={leader}
          onCommit={(value) => setLeader(value as TabLeader)}
        />
        <div className={styles.row}>
          <Button onClick={() => act((at) => setTabStop({ pos: at, align, leader }), t('textPane.tabs.tooMany'))}>
            {t('textPane.tabs.set')}
          </Button>
          <Button variant="secondary" onClick={() => act(clearTabStop)}>
            {t('textPane.tabs.clear')}
          </Button>
          <Button variant="secondary" onClick={all}>
            {t('textPane.tabs.clearAll')}
          </Button>
        </div>
        <StopList stops={tabsAt(editor.state)} />
      </Group>
      <Interval />
    </div>
  );
}
