// Opening the daily notes calendar. Its code is a lazy chunk, so it costs nothing at start-up.
import { lazy } from 'react';
import { showOverlay } from '../../shell/commandbar/overlays';

const LazyCalendar = lazy(() => import('./DailyCalendar'));

export function openDailyCalendar(): void {
  showOverlay('daily-calendar', LazyCalendar, {});
}
