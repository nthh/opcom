// Core
export { GraphDatabase } from "./core/database.js";
export { GraphBuilder } from "./core/builder.js";
export { SCHEMA, type GraphNode, type GraphEdge, type NodeType, type EdgeRelation, type TestResult, type RunSummary, type ParsedTestRun } from "./core/schema.js";
export { type Analyzer, type AnalyzerContext, type AnalyzerResult } from "./core/analyzer.js";
export { DriftEngine, type DriftSignal, type DriftSignalType, type TestType, type DriftAction, type DriftOptions, hasUiBehavior, hasApiBehavior, hasInteractionHandlers, isRouteFile } from "./core/drift.js";
export { TriageEngine, type TriageResult, type TriageOptions, type LLMProvider, buildBatchPrompt, parseTriageResponse, isExpectedUntested, TRIAGE_SCHEMA } from "./core/triage.js";
export {
  TestGenerationEngine,
  UnitTestGenerator,
  PlaywrightGenerator,
  ApiTestGenerator,
  parseGeneratedTests,
  detectTestFramework,
  detectPlaywrightConfig,
  detectApiFramework,
  loadTestPreferences,
  GENERATED_TESTS_SCHEMA,
  type TestGeneratorInterface,
  type GeneratedTest,
  type VerificationResult,
  type GenerationContext,
  type GenerateOptions,
  type GenerationPlan,
  type GenerationResult,
  type TestFramework,
  type ApiFramework,
  type TestPreferences,
} from "./core/test-generator.js";

// Analyzers
export { TypeScriptImportAnalyzer } from "./analyzers/typescript-imports.js";
export { PythonImportAnalyzer } from "./analyzers/python-imports.js";
export { MarkdownDocAnalyzer } from "./analyzers/markdown-docs.js";
export { TicketAnalyzer } from "./analyzers/tickets.js";

// Parsers
export { parseTestResults, detectFramework, parsePytest, parseVitest, parseJunit, type Framework } from "./parsers/index.js";

// Utility
export { minimatch } from "./util/minimatch.js";

// Local imports for createBuilder
import { GraphBuilder } from "./core/builder.js";
import { TypeScriptImportAnalyzer } from "./analyzers/typescript-imports.js";
import { PythonImportAnalyzer } from "./analyzers/python-imports.js";
import { MarkdownDocAnalyzer } from "./analyzers/markdown-docs.js";
import { TicketAnalyzer } from "./analyzers/tickets.js";

/**
 * Create a GraphBuilder with all built-in analyzers registered.
 *
 * This is the main entry point for building a context graph.
 * Analyzers auto-detect which ones apply to the project.
 */
export function createBuilder(projectName: string, projectPath: string, contextDir?: string): GraphBuilder {
  const builder = new GraphBuilder(projectName, projectPath, contextDir);
  builder.register(new TypeScriptImportAnalyzer());
  builder.register(new PythonImportAnalyzer());
  builder.register(new MarkdownDocAnalyzer());
  builder.register(new TicketAnalyzer());
  return builder;
}
