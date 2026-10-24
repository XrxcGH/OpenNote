// The root error boundary. A render error that reaches the root would unmount the whole page. With the custom
// frame on (ADR 0017), the page draws the window's caption, so the window would be left with no way to move or
// close it with the mouse. The fallback gives the window back its native frame and says what happened.

import { Component } from 'react';
import type { ReactNode } from 'react';
import type { Platform } from '../platform/types';
import { t } from '../strings/t';

export interface RootBoundaryProps {
  platform: Pick<Platform, 'window' | 'log'>;
  children: ReactNode;
}

interface RootBoundaryState {
  failed: boolean;
}

export class RootBoundary extends Component<RootBoundaryProps, RootBoundaryState> {
  override state: RootBoundaryState = { failed: false };

  static getDerivedStateFromError(): RootBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    const { platform } = this.props;
    platform.window.setCaptionLayout(null);
    // Only the error's kind is logged: its message could name a page.
    const kind = error instanceof Error ? error.name : typeof error;
    platform.log('error', `The page failed to render (${kind}), so the window has its native frame back.`);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <p role="alert">{t('errors.pageFailed')}</p>;
  }
}
