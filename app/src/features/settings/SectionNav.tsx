// The list of Settings sections: a <nav> of links, the current one marked with aria-current="page".

import type { SettingsSectionDef } from '../../registries/types';
import { t } from '../../strings/t';
import styles from './SettingsView.module.css';

export interface SectionNavProps {
  sections: readonly SettingsSectionDef[];
  current: string;
  onChoose(id: string): void;
}

export function SectionNav({ sections, current, onChoose }: SectionNavProps) {
  return (
    <nav aria-label={t('settings.nav')} className={styles.nav}>
      <ul>
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={styles.link}
              aria-current={section.id === current ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                onChoose(section.id);
              }}
            >
              {t(section.title)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
