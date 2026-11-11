// Language support, each language in a chunk of its own (DESIGN 5.2): the lang-* packages, and the legacy modes for
// Ruby, Lua, R, shell, Kotlin, C#, Dart, Swift, PowerShell, Julia, and Scheme. PHP and Makefiles get plain text.

import type { Extension } from '@codemirror/state';
import type { StreamParser } from '@codemirror/language';
import type { EditorLanguage } from './indent';

async function legacy(parser: Promise<StreamParser<unknown>>): Promise<Extension> {
  const [{ StreamLanguage }, mode] = await Promise.all([import('@codemirror/language'), parser]);
  return StreamLanguage.define(mode);
}

const LOADERS: Readonly<Record<EditorLanguage, () => Promise<Extension>>> = {
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  c: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  java: () => import('@codemirror/lang-java').then((m) => m.java()),
  rust: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  go: () => import('@codemirror/lang-go').then((m) => m.go()),
  ruby: () => legacy(import('@codemirror/legacy-modes/mode/ruby').then((m) => m.ruby)),
  lua: () => legacy(import('@codemirror/legacy-modes/mode/lua').then((m) => m.lua)),
  r: () => legacy(import('@codemirror/legacy-modes/mode/r').then((m) => m.r)),
  bash: () => legacy(import('@codemirror/legacy-modes/mode/shell').then((m) => m.shell)),
  kotlin: () => legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.kotlin)),
  csharp: () => legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.csharp)),
  dart: () => legacy(import('@codemirror/legacy-modes/mode/clike').then((m) => m.dart)),
  swift: () => legacy(import('@codemirror/legacy-modes/mode/swift').then((m) => m.swift)),
  powershell: () => legacy(import('@codemirror/legacy-modes/mode/powershell').then((m) => m.powerShell)),
  julia: () => legacy(import('@codemirror/legacy-modes/mode/julia').then((m) => m.julia)),
  scheme: () => legacy(import('@codemirror/legacy-modes/mode/scheme').then((m) => m.scheme)),
  php: () => Promise.resolve([]),
  makefile: () => Promise.resolve([]),
  plain: () => Promise.resolve([]),
};

/** The language's CodeMirror support, loaded on first use. */
export function loadLanguage(language: EditorLanguage): Promise<Extension> {
  return LOADERS[language]();
}
