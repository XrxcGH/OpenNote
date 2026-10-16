// The title bar's Search button: opens the search panel, so a person who has not learned Ctrl+Shift+F can find it.
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { executeCommand } from '../../commands/registry';
import { t } from '../../strings/t';
import { IconButton } from '../../ui';
import { TitleBarMenuItem } from '../../shell/titlebar/TitleBarMenuItem';

export function SearchButton({ presentation }: { presentation: 'full' | 'icon' | 'menuItem' }) {
  const run = () => void executeCommand('search.open', undefined, 'titleBar');
  if (presentation === 'menuItem') {
    return <TitleBarMenuItem label={t('search.commands.open')} command="search.open" onPress={run} />;
  }
  return (
    <IconButton label={t('search.commands.open')} icon={MagnifyingGlassIcon} command="search.open" onPress={run} />
  );
}
