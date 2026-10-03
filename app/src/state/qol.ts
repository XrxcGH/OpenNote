// State of the quality-of-life features that more than one place reads: focus mode, the mini window, docking,
// low-power mode, archived items, the Home page, and tabs with the recently closed list. None of it is saved; a
// new start begins with all of it off.

import type { Location } from '../app/location';
import { createStore } from './store';

type Workspace = Extract<Location, { view: 'workspace' }>;

export interface Tab {
  readonly id: string;
  /** Where the tab is. Following a link in the tab changes it. */
  readonly location: Workspace;
}

export interface ClosedTab {
  readonly location: Workspace;
  /** The page title when it closed, so the list reads even after a rename or delete. */
  readonly title: string;
  readonly closedAt: number;
}

export interface QolState {
  readonly focusMode: boolean;
  readonly miniWindow: boolean;
  readonly docked: 'left' | 'right' | null;
  /** On battery or in battery saver, and not turned off by the person. */
  readonly lowPower: boolean;
  readonly showArchived: boolean;
  readonly homeOpen: boolean;
  readonly tabs: readonly Tab[];
  readonly activeTab: string | null;
  readonly closedTabs: readonly ClosedTab[];
}

export const INITIAL_QOL: QolState = {
  focusMode: false,
  miniWindow: false,
  docked: null,
  lowPower: false,
  showArchived: false,
  homeOpen: false,
  tabs: [],
  activeTab: null,
  closedTabs: [],
};

export const qolStore = createStore<QolState>(INITIAL_QOL, 'qol');

/** How many closed tabs the list keeps. */
export const CLOSED_LIMIT = 20;
