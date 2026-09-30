// WP0's placeholder Settings page: the heading and the way back. WP7 builds the section list from the
// settingsSections registry.

import { goBack, navigate } from '../../app/location';
import { t } from '../../strings/t';
import { Button } from '../../ui';

export function SettingsView() {
  return (
    <main>
      <Button
        variant="quiet"
        onClick={() => goBack() || navigate({ view: 'workspace', notebookId: null, sectionId: null, pageId: null })}
      >
        {t('settings.back')}
      </Button>
      <h1>{t('settings.title')}</h1>
    </main>
  );
}
