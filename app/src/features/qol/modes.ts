// The window modes: focus mode, the mini window (kept on top), docking to a screen edge, and low-power mode.
// Each is a flag in the shared qol store; the shell does the window work.

import { shellCall, shellHost } from '../../platform/shellqol';
import { getSettings } from '../../state/settings';
import { osStore } from '../../state/os';
import { qolStore } from '../../state/qol';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import { applyAppearance } from '../../theme/appearance';
import { readPrefs } from './prefs';

export function setFocusMode(on: boolean): void {
  qolStore.set((state) => (state.focusMode === on ? state : { ...state, focusMode: on }));
  announce(t(on ? 'qol.focus.on' : 'qol.focus.off'));
}

export const toggleFocusMode = () => setFocusMode(!qolStore.get().focusMode);

/** Keeps the main window above other windows, or lets it go back. */
export async function toggleMiniWindow(): Promise<void> {
  const on = !qolStore.get().miniWindow;
  try {
    await shellCall('window.setAlwaysOnTop', { on });
  } catch {
    showToast({ message: t('qol.mini.failed'), tone: 'danger' });
    return;
  }
  qolStore.set((state) => ({ ...state, miniWindow: on }));
  announce(t(on ? 'qol.mini.on' : 'qol.mini.off'));
}

/** Docks the window to an edge, or undocks it when it is docked. */
export async function toggleDock(edge: 'left' | 'right'): Promise<void> {
  try {
    const answer = await shellCall<{ docked: boolean; edge: 'left' | 'right' | null } | null>('dock.toggle', { edge });
    const docked = answer?.docked ? answer.edge : null;
    qolStore.set((state) => ({ ...state, docked }));
    announce(docked ? t('qol.dock.docked', { edge: t(`qol.dock.${docked}`) }) : t('qol.dock.undocked'));
  } catch {
    showToast({ message: t('qol.dock.failed'), tone: 'danger' });
  }
}

/** The power status the shell reports. */
export interface PowerStatus {
  readonly onBattery: boolean;
  readonly saver: boolean;
  readonly percent: number | null;
}

/** Whether low-power mode should be on, given the status and the person's choice. */
export function wantsLowPower(status: Pick<PowerStatus, 'onBattery' | 'saver'>, auto: boolean): boolean {
  return auto && (status.onBattery || status.saver);
}

/** Turns low-power mode on or off. It reuses the reduce-motion attribute, and background work reads the store. */
export function setLowPower(on: boolean): void {
  if (qolStore.get().lowPower === on) return;
  qolStore.set((state) => ({ ...state, lowPower: on }));
  const root = document.documentElement;
  if (on) root.setAttribute('data-motion', 'reduce');
  else applyAppearance(root, getSettings(), osStore.get());
  announce(t(on ? 'qol.power.on' : 'qol.power.off'));
}

/** True while low-power mode is on, for work that can wait. */
export const isLowPower = () => qolStore.get().lowPower;

let lastStatus: PowerStatus | null = null;

/** Follows the power status from the shell. Returns a function that stops. */
export function followPower(): () => void {
  const apply = async (status: PowerStatus) => {
    lastStatus = status;
    const prefs = await readPrefs();
    setLowPower(wantsLowPower(status, prefs.lowPowerAuto !== false));
  };
  const stop = shellHost().listen((event) => {
    if (event.kind === 'power') void apply(event as unknown as PowerStatus);
  });
  void shellCall<PowerStatus | null>('power.status').then((status) => status && void apply(status));
  return stop;
}

/** Re-checks low-power mode after the person changes the automatic choice. */
export async function refreshLowPower(): Promise<void> {
  const prefs = await readPrefs();
  setLowPower(lastStatus ? wantsLowPower(lastStatus, prefs.lowPowerAuto !== false) : false);
}
