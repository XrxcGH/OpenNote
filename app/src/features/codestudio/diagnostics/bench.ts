// The diagnostics benchmark harness (DESIGN 15, gate G-D2): times one checker run, parse included, on a file of a
// given length, as the diagnostics worker does it. Lane L20's nightly table reads the same numbers.

import { analyze } from './analyze';
import type { EditorLanguage } from './types';

/** One block of ordinary code per language, about 20 lines, repeated to build a large file. */
const BLOCKS: Partial<Record<EditorLanguage, (i: number) => string>> = {
  python: (i) =>
    [
      `def step_${i}(items, scale=2):`,
      `    """Scales the even items."""`,
      `    total = 0`,
      `    for index, value in enumerate(items):`,
      `        if value % 2 == 0 and index > 0:`,
      `            total += value * scale`,
      `        elif value is None:`,
      `            continue`,
      `        else:`,
      `            total -= math.floor(value / 3)`,
      `    result = [x * x for x in items if x]`,
      `    try:`,
      `        ratio = total / len(result)`,
      `    except ZeroDivisionError as error:`,
      `        print(error)`,
      `        ratio = 0`,
      `    return {"total": total, "ratio": ratio, "n": len(result)}`,
      ``,
      `print(step_${i}([1, 2, 3, 4]))`,
      ``,
    ].join('\n'),
  javascript: (i) =>
    [
      `function step${i}(items, scale = 2) {`,
      `  let total = 0;`,
      `  for (const [index, value] of items.entries()) {`,
      `    if (value % 2 === 0 && index > 0) {`,
      `      total += value * scale;`,
      `    } else if (value === null) {`,
      `      continue;`,
      `    } else {`,
      `      total -= Math.floor(value / 3);`,
      `    }`,
      `  }`,
      `  const result = items.filter((x) => x).map((x) => x * x);`,
      `  switch (result.length) {`,
      `    case 0:`,
      `      return { total, ratio: 0 };`,
      `    default:`,
      `      return { total, ratio: total / result.length };`,
      `  }`,
      `}`,
      `console.log(step${i}([1, 2, 3, 4]));`,
    ].join('\n'),
  c: (i) =>
    [
      `static int step${i}(const int *items, int n, int scale) {`,
      `  int total = 0;`,
      `  for (int index = 0; index < n; index++) {`,
      `    int value = items[index];`,
      `    if (value % 2 == 0 && index > 0) {`,
      `      total += value * scale;`,
      `    } else if (value < 0) {`,
      `      continue;`,
      `    } else {`,
      `      total -= value / 3;`,
      `    }`,
      `  }`,
      `  if (n == 0) {`,
      `    return 0;`,
      `  }`,
      `  printf("%d\\n", total / n);`,
      `  return total;`,
      `}`,
      ``,
      ``,
    ].join('\n'),
  lua: (i) =>
    [
      `local function step${i}(items, scale)`,
      `  local total = 0`,
      `  for index, value in ipairs(items) do`,
      `    if value % 2 == 0 and index > 1 then`,
      `      total = total + value * scale`,
      `    elseif value < 0 then`,
      `      total = total - 1`,
      `    else`,
      `      total = total - math.floor(value / 3)`,
      `    end`,
      `  end`,
      `  local result = {}`,
      `  for _, x in ipairs(items) do`,
      `    result[#result + 1] = x * x`,
      `  end`,
      `  return { total = total, n = #result }`,
      `end`,
      `print(step${i}({ 1, 2, 3, 4 }, 2).total)`,
      ``,
      ``,
    ].join('\n'),
};
BLOCKS.typescript = BLOCKS.javascript;
BLOCKS.cpp = BLOCKS.c;

/** A file of at least `lines` lines in `language`, built from ordinary code. */
export function sampleFile(language: EditorLanguage, lines: number): string {
  const block = BLOCKS[language];
  if (!block) throw new Error(`No sample code for ${language}.`);
  const head =
    language === 'python' ? 'import math\n' : language === 'c' || language === 'cpp' ? '#include <stdio.h>\n' : '';
  let text = head;
  for (let i = 0; text.split('\n').length < lines; i += 1) text += `${block(i)}\n`;
  return text;
}

/** The median time of `runs` checker runs, parse included, after one warm-up run. */
export async function measureChecker(language: EditorLanguage, text: string, runs = 7): Promise<number> {
  await analyze({ language, text, layers: ['checker'] });
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    await analyze({ language, text, layers: ['checker'] });
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}
