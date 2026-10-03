// The Settings page (ARCHITECTURE.md section 16.1). It replaces the workspace. The sections from the registry sit
// beside the current one; in the compact size class the list and the section are two screens. Every change applies
// at once, so there is no Save button.

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { navigate, useLocation } from '../../app/location';
import { useSizeClass } from '../../state/layout';
import { t } from '../../strings/t';
import { Button } from '../../ui';
import { escapeLeaves, leaveSettings, rememberOpener } from './focus';
import { SectionNav } from './SectionNav';
import { SectionBody, useSections } from './sections';
import styles from './SettingsView.module.css';

/** The two screens of the compact size class, and the focus that follows each change of screen. */
function useScreens(sectionId: string | undefined, compact: boolean) {
  const [listShowing, setListShowing] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const showList = compact && listShowing;
  useEffect(() => rememberOpener(), []);
  useEffect(() => {
    heading.current?.focus();
  }, [sectionId, showList]);
  return { heading, showList, setListShowing };
}

export function SettingsView() {
  const location = useLocation();
  const sections = useSections();
  const compact = useSizeClass() === 'compact';
  const requested = location.view === 'settings' ? location.section : 'general';
  const section = sections.find((one) => one.id === requested) ?? sections[0];
  const { heading, showList, setListShowing } = useScreens(section?.id, compact);
  const choose = (id: string) => {
    setListShowing(false);
    navigate({ view: 'settings', section: id }, { replace: true });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!escapeLeaves(event)) return;
    event.preventDefault();
    if (compact && !showList) setListShowing(true);
    else leaveSettings();
  };
  const title = showList || !section ? t('settings.title') : t(section.title);
  return (
    <div className={styles.page} data-scope="settings" onKeyDown={onKeyDown}>
      <div className={styles.header}>
        {compact && !showList ? (
          <Button variant="quiet" onClick={() => setListShowing(true)}>
            {t('settings.backToSections')}
          </Button>
        ) : (
          <Button variant="quiet" onClick={leaveSettings}>
            {t('settings.back')}
          </Button>
        )}
      </div>
      <main className={styles.body}>
        {showList && (
          <h1 ref={heading} tabIndex={-1} className={styles.listHeading}>
            {title}
          </h1>
        )}
        {(!compact || showList) && <SectionNav sections={sections} current={section?.id ?? ''} onChoose={choose} />}
        {!showList && (
          <div className={styles.main}>
            <h1 ref={heading} tabIndex={-1} className={styles.heading}>
              {title}
            </h1>
            {section && <SectionBody section={section} />}
          </div>
        )}
      </main>
    </div>
  );
}
