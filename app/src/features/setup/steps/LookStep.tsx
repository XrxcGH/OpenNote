// Step 2 (ARCHITECTURE.md section 17.4): three theme cards. Match Windows is selected in advance, with a caption
// that names the Windows setting, because the screen already matches it. A choice applies through the flash-safe
// applier and is saved to settings.json at once, so it is stored before any page opens.

import { formatChord, useKeysFor } from '../../../commands/keymap';
import type { ThemePreference } from '../../../platform/types';
import type { SetupStepProps } from '../../../registries';
import { useOs } from '../../../state/os';
import { t } from '../../../strings/t';
import { setThemePreference } from '../../../theme/theme';
import { ThemeCards } from '../../theme';
import styles from '../SetupView.module.css';
import { StepHeader } from '../StepHeader';

export default function LookStep(props: SetupStepProps) {
  const { draft, setDraft } = props;
  const dark = useOs((os) => os.dark);
  const keys = useKeysFor('theme.toggle');
  const theme = draft.look?.theme ?? 'system';
  const subtitle = keys.length
    ? t('setup.look.subtitle', { shortcut: formatChord(keys[0]) })
    : t('setup.look.subtitleNoShortcut');
  const choose = (choice: ThemePreference) => {
    setDraft({ look: { theme: choice } });
    setThemePreference(choice, 'setup');
  };
  return (
    <div className={styles.step}>
      <StepHeader {...props} title={t('setup.steps.look')} subtitle={subtitle} />
      <ThemeCards
        value={theme}
        onChange={choose}
        systemCaption={
          theme === 'system' ? t(dark ? 'setup.look.preselectedDark' : 'setup.look.preselectedLight') : undefined
        }
      />
    </div>
  );
}
