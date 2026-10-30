// Each psychology tool's words and the problems an input can have, loaded with the kit window instead of at start-up. Titles and keywords stay in
// ../kitMind.ts, since the command palette needs them at start-up.
import { agreement } from './agreement';
import { choice } from './choice';
import { coding } from './coding';
import { error } from './error';
import { learning } from './learning';
import { observe } from './observe';
import { psychophysics } from './psychophysics';
import { rt } from './rt';
import { scales } from './scales';
import { sdt } from './sdt';

export const kitMindWords = {
  sdt,
  psychophysics,
  learning,
  choice,
  rt,
  observe,
  agreement,
  scales,
  coding,
  error,
} as const;
