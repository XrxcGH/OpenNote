// Composes the views from each feature's public face and switches on the location (ARCHITECTURE.md section 5.3).
// WP5 owns it after WP0 and adds the responsive layout and window titles.

import { useLocation } from './app/location';
import { NotebooksPane, PagesPane } from './features/tree';
import { PageView } from './features/page';
import { SettingsView } from './features/settings';
import { SetupView } from './features/setup';
import { TrashView } from './features/trash';
import { BottomBar, CommandBar } from './shell/commandbar';
import { Workspace } from './shell/layout/Workspace';
import { AppBar, TitleBar } from './shell/titlebar';
import { Announcer, Toaster } from './ui';

function View() {
  const location = useLocation();
  if (location.view === 'settings') return <SettingsView />;
  if (location.view === 'setup') return <SetupView />;
  return (
    <Workspace
      titleBar={<TitleBar />}
      appBar={<AppBar />}
      commandBar={<CommandBar />}
      notebooks={<NotebooksPane />}
      pages={<PagesPane />}
      page={location.view === 'trash' ? <TrashView /> : <PageView />}
      bottomBar={<BottomBar />}
    />
  );
}

export function App() {
  const location = useLocation();
  return (
    <>
      {location.view === 'workspace' || location.view === 'trash' ? null : <TitleBar />}
      <View />
      <Toaster />
      <Announcer />
    </>
  );
}
