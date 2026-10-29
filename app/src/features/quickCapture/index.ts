// The quick capture window, which loads only in the window the shell opens for it.
import { lazy } from 'react';

export { saveCapture, splitCapture } from './capture';
export const QuickCapture = lazy(() => import('./QuickCapture'));
