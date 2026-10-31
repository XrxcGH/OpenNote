// The RF tool's words, by their key under kitSignals.rf in the strings.
import { say } from '../shared/ui';

export const w = (key: string, vars?: Record<string, string | number>): string => say(`kitSignals.rf.${key}`, vars);
