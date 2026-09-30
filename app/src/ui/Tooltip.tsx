// Tooltips (ARCHITECTURE.md section 15.4): "Name (Shortcut)". WP0 uses the native title; WP4 replaces it with
// a hoverable tooltip that shows after 500 ms of hover or focus and closes on Escape.

import { cloneElement } from 'react';
import type { ReactElement } from 'react';

export interface TooltipProps {
  label: string;
  shortcut?: string | null;
  children: ReactElement;
}

export function Tooltip({ label, shortcut, children }: TooltipProps) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return cloneElement(children as ReactElement<{ title?: string }>, { title });
}
