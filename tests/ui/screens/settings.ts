// The Settings page, for the focus walk, axe, and the screenshot matrix.

import type { Page } from '@playwright/test';
import { defineScreens } from '../screens';
import { openSettingsSection } from '../settingsOpen';

async function openSection(page: Page, name: string): Promise<void> {
  await openSettingsSection(page, name);
}

export default defineScreens([
  {
    id: 'settings.general',
    description: 'Settings, General',
    prepare: (page) => openSection(page, 'General'),
  },
  {
    id: 'settings.shortcuts',
    description: 'Settings, Shortcuts, with the shortcut set choice and the list',
    prepare: (page) => openSection(page, 'Shortcuts'),
  },
  {
    id: 'settings.about',
    description: 'Settings, About',
    prepare: (page) => openSection(page, 'About'),
  },
]);
