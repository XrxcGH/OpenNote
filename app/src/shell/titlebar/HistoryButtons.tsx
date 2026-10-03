// The toolbar arrows for back and forward (FEATURES.md, Phase 2, "Back and forward"), as title bar items. Each
// stays in the tab order when there is nowhere to go, with aria-disabled, so it can still be found.

import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { useHistoryDepth } from '../../app/location';
import { executeCommand } from '../../commands/registry';
import { t } from '../../strings/t';
import { IconButton } from '../../ui';
import { TitleBarMenuItem } from './TitleBarMenuItem';

type Presentation = { presentation: 'full' | 'icon' | 'menuItem' };

export function BackButton({ presentation }: Presentation) {
  const { back } = useHistoryDepth();
  const run = () => void executeCommand('nav.back', undefined, 'titleBar');
  if (presentation === 'menuItem') {
    return <TitleBarMenuItem label={t('layout.commands.back')} command="nav.back" disabled={!back} onPress={run} />;
  }
  return (
    <IconButton
      label={t('layout.commands.back')}
      icon={ArrowLeftIcon}
      command="nav.back"
      disabled={back ? undefined : 'aria'}
      onPress={run}
    />
  );
}

export function ForwardButton({ presentation }: Presentation) {
  const { forward } = useHistoryDepth();
  const run = () => void executeCommand('nav.forward', undefined, 'titleBar');
  if (presentation === 'menuItem') {
    return (
      <TitleBarMenuItem label={t('layout.commands.forward')} command="nav.forward" disabled={!forward} onPress={run} />
    );
  }
  return (
    <IconButton
      label={t('layout.commands.forward')}
      icon={ArrowRightIcon}
      command="nav.forward"
      disabled={forward ? undefined : 'aria'}
      onPress={run}
    />
  );
}
