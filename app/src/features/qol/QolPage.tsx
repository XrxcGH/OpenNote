// What the page area adds around the page view: the tab strip, the way out of focus mode, the Home page in place of
// the page, and the notice for a page that another program changed. Everything here is hidden until its feature
// is in use, so a person who uses none of them sees the page as before.

import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { useFlag } from '../../app/flags';
import { qolStore } from '../../state/qol';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import { HomeView } from '../home';
import { ExternalNotice } from './ExternalNotice';
import { setFocusMode } from './modes';
import { TabStrip } from './TabStrip';
import styles from './QolPage.module.css';

function FocusExit() {
  const focus = useStore(qolStore, (state) => state.focusMode);
  if (!focus) return null;
  return (
    <div className={styles.focusExit}>
      <Button variant="quiet" onClick={() => setFocusMode(false)}>
        {t('qol.focus.exit')}
      </Button>
    </div>
  );
}

export function QolPage({ children }: { children: ReactNode }) {
  const homeOpen = useStore(qolStore, (state) => state.homeOpen);
  const homeOn = useFlag('qol.home');
  const home = homeOpen && homeOn;
  return (
    <>
      <TabStrip />
      <FocusExit />
      <ExternalNotice />
      {home ? (
        <Suspense fallback={null}>
          <HomeView />
        </Suspense>
      ) : (
        children
      )}
    </>
  );
}
