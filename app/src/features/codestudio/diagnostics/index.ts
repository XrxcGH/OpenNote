// Automatic error detection for the code studio (DESIGN 6, ADR 0074), loaded with the studio. The studio creates one
// service, feeds it each file's text and version, and shows what it publishes with the editor's showProblems.
// Runtime lanes register their engine checks here (registerEngineCheck), loaded or not.

export { analyze, CHECKER_LANGUAGES } from './analyze';
export type { AnalyzeRequest, AnalyzeResult } from './analyze';
export { createCheckerClient } from './client';
export type { CheckerClient, WorkerLike } from './client';
export {
  engineChecks,
  engineProvider,
  fromRuntimeAdapter,
  onEngineChecks,
  registerEngineCheck,
  runtimeToDiagnostic,
} from './engine';
export type { EngineCheck } from './engine';
export { GRAMMAR_LANGUAGES, loadParser } from './parsers';
export { checkerProvider, createDiagnostics, syntaxProvider, toDiagnostic } from './providers';
export type { DiagnosticsService } from './providers';
export { createDiagnosticsScheduler } from './scheduler';
export type { DiagnosticsScheduler, MapPos, SchedulerOptions } from './scheduler';
export { LAYER_DEBOUNCE_MS, LAYERS } from './types';
export type { DiagnosticProvider, DiagnosticRequest, Finding, Layer, MessageId } from './types';
