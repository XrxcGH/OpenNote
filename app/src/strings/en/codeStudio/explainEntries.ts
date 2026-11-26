// The words of every catalog entry of the explain feature (DESIGN 7.2, code:L11). They stay out of the `en` tree so
// the start-up bundle does not carry them: only the lazy chunk of features/codestudio/explain imports this file.

import { explainClang } from './explainClang';
import { explainClangMore } from './explainClangMore';
import { explainDatabase } from './explainDatabase';
import { explainJavaScript } from './explainJavaScript';
import { explainPython } from './explainPython';
import { explainPythonClasses } from './explainPythonClasses';

export const explainEntries = {
  ...explainPython,
  ...explainPythonClasses,
  ...explainJavaScript,
  ...explainClang,
  ...explainClangMore,
  ...explainDatabase,
} as const;
