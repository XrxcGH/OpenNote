// Registers the Connectors section of Settings (behind connectors.page). The page loads on first use.

import { settingsSections } from '../../registries';

settingsSections.register({
  id: 'connectors',
  title: 'connectors.section',
  icon: 'PlugsConnected',
  order: 36,
  flag: 'connectors.page',
  load: () => import('./ConnectorsSection'),
});
