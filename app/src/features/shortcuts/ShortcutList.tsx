// The shortcut list (ARCHITECTURE.md section 14.7): a filter, one table per category with each command's current
// keys, the keys that always work, and any tables later phases add. It shows in the Ctrl+/ dialog and inline in
// Settings. "Reset" puts one command back; "Reset all shortcuts" puts every command back.

import { useState } from 'react';
import { isEnabled } from '../../app/flags';
import { hasOverride } from '../../commands/keymap';
import { commands, shortcutListSections, useRegistry } from '../../registries';
import { useSettings } from '../../state/settings';
import { resetAllShortcuts } from '../../state/keymap';
import { t } from '../../strings/t';
import { Button, TextField, announce } from '../../ui';
import { shortcutGroups } from './rows';
import styles from './ShortcutList.module.css';
import { CommandTable, FixedKeysTable } from './Tables';
import type { HeadingLevel } from './Tables';

function LaterTables({ level }: { level: HeadingLevel }) {
  const Heading = `h${level}` as const;
  const sections = useRegistry(shortcutListSections).filter((section) => !section.flag || isEnabled(section.flag));
  return sections.map(({ id, title, Component }) => (
    <section key={id} className={styles.group}>
      <Heading>{t(title)}</Heading>
      <Component />
    </section>
  ));
}

export function ShortcutList({ scrolls = false, level = 3 }: { scrolls?: boolean; level?: HeadingLevel }) {
  const [query, setQuery] = useState('');
  const defs = useRegistry(commands);
  const preset = useSettings((settings) => settings.keymap.preset);
  // Reads the settings, so the list follows every rebinding.
  useSettings((settings) => settings.shortcuts);
  const groups = shortcutGroups(query);
  const anyChanged = defs.some((def) => hasOverride(def.id));
  const resetAll = () => {
    const set = t(preset === 'onenote' ? 'shortcuts.set.onenote' : 'shortcuts.set.default');
    void resetAllShortcuts().then(() => announce(t('shortcuts.resetAllDone', { set })));
  };
  return (
    <div className={styles.list}>
      <div className={styles.toolbar}>
        <TextField
          label={t('shortcuts.filter')}
          help={t('shortcuts.filterHelp')}
          value={query}
          onChange={setQuery}
          onCancel={query ? () => setQuery('') : undefined}
        />
        {anyChanged && <Button onClick={resetAll}>{t('shortcuts.resetAll')}</Button>}
      </div>
      <div
        className={scrolls ? styles.scroll : undefined}
        role={scrolls ? 'region' : undefined}
        aria-label={scrolls ? t('shortcuts.tables') : undefined}
        tabIndex={scrolls ? 0 : undefined}
      >
        {groups.map((group) => (
          <CommandTable key={group.category} group={group} level={level} />
        ))}
        {groups.length === 0 && (
          <p role="status" className={styles.note}>
            {t('shortcuts.noMatch', { query: query.trim() })}
          </p>
        )}
        {!query.trim() && <FixedKeysTable level={level} />}
        {!query.trim() && <LaterTables level={level} />}
      </div>
    </div>
  );
}
