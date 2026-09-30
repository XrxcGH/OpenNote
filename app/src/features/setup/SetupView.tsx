// WP0's placeholder setup screen: only the heading. WP3 builds the steps from the setupSteps registry.

import { t } from '../../strings/t';

export function SetupView() {
  return (
    <main>
      <h1>{t('setup.title')}</h1>
    </main>
  );
}
