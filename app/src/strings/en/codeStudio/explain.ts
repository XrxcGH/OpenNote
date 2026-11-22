// Plain-language explanations of error messages (DESIGN 7.2). Owner: code:L11. Each catalog entry of
// features/codestudio/explain has what happened, the likely cause, and the next thing to try. The words are in the
// files explain*.ts of this folder. `{name}` and the other values come from the named groups of the entry's pattern.

import { explainClang } from './explainClang';
import { explainClangMore } from './explainClangMore';
import { explainDatabase } from './explainDatabase';
import { explainJavaScript } from './explainJavaScript';
import { explainPython } from './explainPython';
import { explainPythonClasses } from './explainPythonClasses';

export const codeStudioExplain = {
  /** "Line 3: total = total + x" */
  quote: 'Line {line}: {text}',
  unknown: {
    what: 'This error is not in the catalog yet.',
    cause: 'The message above comes straight from the program. It may name the problem in its first words.',
    next: 'Read the message, then check the line it points to. Search the message text for more help.',
  },
  hints: {
    validIndexes: 'The sequence has {length} items, so the valid positions are 0 to {last}.',
    asked: 'The code asked for position {index}.',
    oneTooFar: 'The code asked for position {index}, one past the last item.',
    negative:
      'The code asked for position {index}. A negative position counts from the end, so the lowest valid one is {first}.',
    emptySequence: 'The sequence is empty, and the code asked for position {index}.',
    loop: 'In a loop, range(len(x)) is right and range(len(x) + 1) goes one too far.',
  },
  entries: {
    ...explainPython,
    ...explainPythonClasses,
    ...explainJavaScript,
    ...explainClang,
    ...explainClangMore,
    ...explainDatabase,
  },
} as const;
