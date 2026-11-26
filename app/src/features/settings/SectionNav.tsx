// The list of Settings sections: a <nav> of links, the current one marked with aria-current="page". Up and Down
// move between the links, and Home and End go to the first and the last (full walk A-A02-5).

import type { KeyboardEvent } from 'react';
import type { SettingsSectionDef } from '../../registries/types';
import { t } from '../../strings/t';
import styles from './SettingsView.module.css';

export interface SectionNavProps {
  sections: readonly SettingsSectionDef[];
  current: string;
  onChoose(id: string): void;
}

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/** Moves focus between the links with the arrow keys, Home, and End. */
function onNavKeyDown(event: KeyboardEvent<HTMLElement>) {
  const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a')];
  const at = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (at === -1) return;
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? links.length - 1
        : event.key in STEPS
          ? at + STEPS[event.key]
          : null;
  if (next === null || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  links[Math.max(0, Math.min(links.length - 1, next))]?.focus();
}

export function SectionNav({ sections, current, onChoose }: SectionNavProps) {
  return (
    <nav aria-label={t('settings.nav')} className={styles.nav} onKeyDown={onNavKeyDown}>
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
