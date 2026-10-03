// The flash-safe theme applier (ARCHITECTURE.md sections 9.4 and 9.5). Switching the theme repaints the whole
// window, so it applies at most one change every 350 ms (interaction.themeApplyMinMs). A change asked for sooner
// waits until the interval ends, and the latest one wins. Each change crossfades through a view transition,
// except under a Windows contrast theme. Participants, such as ink, can redraw in the new colors inside the
// transition before its new picture is taken; the applier waits for them for at most 120 ms.

import { tokens } from './tokens';

export type Theme = 'light' | 'dark';

/** Something that must be ready in the new theme before the crossfade's new picture. */
export interface ThemeParticipant {
  prepare(theme: Theme): Promise<void>;
}

export interface ApplierOptions {
  /** Writes the theme to the document and the window frame. */
  write(theme: Theme): void;
  /** False when the change should be instant, as under a contrast theme. */
  crossfade(): boolean;
  /** Default: interaction.themeApplyMinMs. */
  minIntervalMs?: number;
  /** How long participants may take. Default 120 ms. */
  prepareBudgetMs?: number;
  now?: () => number;
}

export interface ThemeApplier {
  /** Shows a theme at once with no crossfade, for the first paint. It doesn't count toward the interval. */
  init(theme: Theme): void;
  /** Asks for a theme. It applies now, or when the interval ends, unless a later request replaces it. */
  request(theme: Theme): void;
  /** The theme on screen, or the one being written. */
  current(): Theme | null;
  addParticipant(participant: ThemeParticipant): () => void;
  dispose(): void;
}

export const PREPARE_BUDGET_MS = 120;

type Transition = { ready: Promise<unknown> };
type WithTransitions = { startViewTransition?: (update: () => void | Promise<void>) => Transition };

/** Waits for every participant, or for the budget, whichever ends first. Failures don't hold the theme back. */
function prepared(participants: ReadonlySet<ThemeParticipant>, theme: Theme, budgetMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, budgetMs);
    void Promise.allSettled([...participants].map((participant) => participant.prepare(theme))).then(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/** Runs the update inside a view transition when crossfading, else at once. */
function transition(update: () => void | Promise<void>, crossfade: boolean): void {
  const doc = document as Document & WithTransitions;
  if (crossfade && typeof doc.startViewTransition === 'function') {
    // A change during the crossfade skips the running one, which rejects its ready promise.
    doc.startViewTransition(update).ready.catch(() => {});
  } else {
    void update();
  }
}

/** The transition's update: with nothing to wait for, it writes in the same task, so the crossfade starts at once. */
function updateFor(options: ApplierOptions, participants: ReadonlySet<ThemeParticipant>, theme: Theme) {
  const budget = options.prepareBudgetMs ?? PREPARE_BUDGET_MS;
  return (): void | Promise<void> =>
    participants.size === 0
      ? options.write(theme)
      : prepared(participants, theme, budget).then(() => options.write(theme));
}

export function createThemeApplier(options: ApplierOptions): ThemeApplier {
  const minInterval = options.minIntervalMs ?? tokens.interaction.themeApplyMinMs;
  const now = options.now ?? (() => performance.now());
  const participants = new Set<ThemeParticipant>();
  let shown: Theme | null = null;
  let pending: Theme | null = null;
  let lastApplied = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const theme = pending;
    pending = null;
    if (theme === null || theme === shown) return;
    shown = theme;
    lastApplied = now();
    transition(updateFor(options, participants, theme), options.crossfade());
  };

  return {
    init(theme) {
      shown = theme;
      options.write(theme);
    },
    request(theme) {
      pending = theme;
      if (timer !== null) return;
      const wait = lastApplied + minInterval - now();
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    current: () => pending ?? shown,
    addParticipant(participant) {
      participants.add(participant);
      return () => void participants.delete(participant);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      participants.clear();
    },
  };
}
