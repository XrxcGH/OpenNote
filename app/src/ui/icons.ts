import type { ComponentType } from 'react';

// Icons are Phosphor icons, imported one module per icon (for example
// '@phosphor-icons/react/dist/csr/Moon'), because the package index loads every icon. Icons use currentColor,
// so they follow the theme and Windows contrast themes.

/** A Phosphor icon name, such as 'Moon'. */
export type IconName = string;

export type IconProps = { weight?: 'regular' | 'fill'; 'aria-hidden'?: boolean };

/** A Phosphor icon as a component, such as the one imported from '@phosphor-icons/react/dist/csr/Moon'. */
export type IconComponent = ComponentType<IconProps>;
