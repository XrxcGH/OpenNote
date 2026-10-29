// The image lab's words, by their key under kitSignals.images in the strings.
import { say } from '../shared/ui';

export const w = (key: string, vars?: Record<string, string | number>): string => say(`kitSignals.images.${key}`, vars);
