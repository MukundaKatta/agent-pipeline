#!/usr/bin/env node
/**
 * agent-pipeline CLI — run the research pipeline from the command line.
 *
 * Usage:
 *   STUB=1 node dist/cli.js "What is RAG drift?"
 *   ANTHROPIC_API_KEY=sk-... node dist/cli.js "Explain transformer attention"
 */

import { runPipeline } from "./pipeline.js";

const question = process.argv.slice(2).join(" ") || "What is retrieval-augmented generation?";
const stub = process.env["STUB"] !== "0";

console.log("agent-pipeline");
console.log(`  question: ${question}`);
console.log(`  stub: ${stub}`);
console.log();

try {
  const { result, trace } = await runPipeline(question, { stub });

  console.log("=== Result ===");
  console.log(`Answer: ${result.answer}`);
  console.log(`Sources: ${result.sources.join(", ") || "(none)"}`);
  console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
  console.log();
  console.log("=== Agent-stack metrics ===");
  console.log(`  token_budget_used : ${result.token_budget_used}`);
  console.log(`  tool_calls        : ${result.tool_calls}`);
  console.log(`  egress_blocked    : ${result.egress_blocked}`);
  console.log();
  console.log(`Trace: ${trace.tools?.length ?? 0} tool calls recorded`);
} catch (err) {
  console.error("Pipeline error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
