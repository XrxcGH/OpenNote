// Composes the views from each feature's public face and switches on the location (ARCHITECTURE.md section 5.3).
// The workspace holds the title bar in its grid; Settings and setup get the title bar above them, so the window
// can always be moved and closed. The window title follows the location, and the mouse's back and forward
// buttons move through history.

import { useLocation } from './app/location';
import { NotebooksPane, PagesPane } from './features/tree';
import { PageView } from './features/page';
import { SettingsView } from './features/settings';
import { SetupView } from './features/setup';
import { QolPage } from './features/qol';
import { TrashView } from './features/trash';
import { BottomBar, CommandBar } from './shell/commandbar';
import { useHistoryMouseButtons, useWindowTitle } from './shell/layout/history';
import { Workspace } from './shell/layout/Workspace';
import { useRegion } from './shell/regions';
import { AppBar, TitleBar } from './shell/titlebar';
import { Announcer, Toaster } from './ui';
import styles from './App.module.css';

function View() {
  const location = useLocation();
  if (location.view === 'settings' || location.view === 'setup') {
    return (
      <div className={styles.view}>
        <TitleBar />
        <div className={styles.body}>{location.view === 'settings' ? <SettingsView /> : <SetupView />}</div>
      </div>
    );
  }
  return (
    <Workspace
      titleBar={<TitleBar />}
      appBar={<AppBar />}
      commandBar={<CommandBar />}
      notebooks={<NotebooksPane />}
      pages={<PagesPane />}
      page={<QolPage>{location.view === 'trash' ? <TrashView /> : <PageView />}</QolPage>}
      bottomBar={<BottomBar />}
    />
  );
}

export function App() {
  const notifications = useRegion('notifications');
  useWindowTitle();
  useHistoryMouseButtons();
  return (
    <>
      <View />
      <Toaster region={notifications} />
      <Announcer />
    </>
  );
}
