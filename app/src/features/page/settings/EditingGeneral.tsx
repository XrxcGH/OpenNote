// Settings, then Editing, then Typing (owner: WP4): Markdown shortcuts, the slash menu, when the formatting bar
// shows, and the date and time under a new page's title.
import { useId } from 'react';
import { updateSettings, useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { RadioCard, RadioGroup, Switch } from '../../../ui';
import styles from './EditingTyping.module.css';

type Bar = 'touchAndPen' | 'always' | 'never';

export default function EditingGeneral() {
  const editing = useSettings((settings) => settings.editing);
  const shortcutsHint = useId();
  const slashHint = useId();
  const set = (patch: Parameters<typeof updateSettings>[0]['editing']) => void updateSettings({ editing: patch });
  return (
    <section className={styles.part} aria-labelledby="editing-typing">
      <h2 id="editing-typing">{t('editor.general.title')}</h2>
      <Switch
        label={t('editor.general.markdownShortcuts')}
        checked={editing.markdownShortcuts}
        describedBy={shortcutsHint}
        onChange={(markdownShortcuts) => set({ markdownShortcuts })}
      />
      <p id={shortcutsHint} className={styles.help}>
        {t('editor.general.markdownShortcutsHint')}
      </p>
      <Switch
        label={t('editor.general.slashMenu')}
        checked={editing.slashMenu}
        describedBy={slashHint}
        onChange={(slashMenu) => set({ slashMenu })}
      />
      <p id={slashHint} className={styles.help}>
        {t('editor.general.slashMenuHint')}
      </p>
      <RadioGroup<Bar>
        label={t('editor.general.formattingBar')}
        value={editing.formattingBar as Bar}
        onChange={(formattingBar) => set({ formattingBar })}
      >
        <RadioCard<Bar> value="touchAndPen" label={t('editor.general.formattingBarTouch')} />
        <RadioCard<Bar> value="always" label={t('editor.general.formattingBarAlways')} />
        <RadioCard<Bar> value="never" label={t('editor.general.formattingBarNever')} />
      </RadioGroup>
    </section>
  );
}
