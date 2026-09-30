// What each screen module returns, and a helper to build it.

import { svgDocument } from '../lib/svg.ts';

export interface Screen {
  file: string;
  title: string;
  svg: string;
}

export interface ScreenSpec {
  file: string;
  title: string;
  background: string;
  body: string[];
  width?: number;
  height?: number;
}

export function makeScreen(spec: ScreenSpec): Screen {
  const { file, title, background, body } = spec;
  const svg = svgDocument({ title, width: spec.width ?? 1440, height: spec.height ?? 900, background, body });
  return { file, title, svg };
}
