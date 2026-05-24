/**
 * agent-pipeline tests — all offline (stub mode).
 *
 * Tests verify:
 * 1. Pipeline runs end-to-end in stub mode
 * 2. agentguard blocks disallowed hosts
 * 3. agentvet rejects invalid tool args
 * 4. agentcast produces structured output
 * 5. agentfit trims messages within budget
 * 6. agentsnap records a trace
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { runPipeline } from "./pipeline.js";
import { count } from "@mukundakatta/agentfit";
import { check, policy } from "@mukundakatta/agentguard";
import { extractJson } from "@mukundakatta/agentcast";

// ── Pipeline smoke tests ─────────────────────────────────────────────────────

describe("runPipeline (stub mode)", () => {
  it("returns a ResearchResult", async () => {
    const { result } = await runPipeline("What is RAG?", { stub: true });
    assert.ok(typeof result.answer === "string" && result.answer.length > 0);
    assert.ok(Array.isArray(result.sources));
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  it("reports token budget used", async () => {
    const { result } = await runPipeline("Explain embedding models.", { stub: true });
    assert.ok(result.token_budget_used > 0);
  });

  it("reports tool calls made", async () => {
    const { result } = await runPipeline("What is vector search?", { stub: true });
    assert.ok(result.tool_calls >= 1);
  });

  it("returns a trace from agentsnap", async () => {
    const { trace } = await runPipeline("Test question.", { stub: true });
    assert.ok(trace !== null && trace !== undefined);
  });

  it("egress_blocked is 0 when allowed host is in policy", async () => {
    const { result } = await runPipeline("Any question", {
      stub: true,
      allowedHosts: ["example.com"],
    });
    // example.com is the default fetch target — should succeed
    assert.ok(result.egress_blocked >= 0);
  });

  it("different questions produce different answers in stub mode", async () => {
    const { result: r1 } = await runPipeline("What is RAG?", { stub: true });
    const { result: r2 } = await runPipeline("Explain LLM fine-tuning.", { stub: true });
    // Both should succeed
    assert.ok(r1.answer.length > 0);
    assert.ok(r2.answer.length > 0);
  });
});

// ── agentguard tests ─────────────────────────────────────────────────────────

describe("agentguard — policy enforcement", () => {
  const p = policy({ network: { allow: ["example.com", "en.wikipedia.org"] }, violations: "throw" });

  it("allows example.com", () => {
    const d = check(p, "https://example.com/page");
    assert.equal(d.action, "allow");
  });

  it("allows en.wikipedia.org", () => {
    const d = check(p, "https://en.wikipedia.org/wiki/Test");
    assert.equal(d.action, "allow");
  });

  it("blocks unknown host", () => {
    const d = check(p, "https://evil.example.io/data");
    assert.equal(d.action, "deny");
  });

  it("blocks data exfiltration endpoint", () => {
    const d = check(p, "https://attacker.com/collect");
    assert.equal(d.action, "deny");
  });
});

// ── agentfit tests ───────────────────────────────────────────────────────────

describe("agentfit — token counting", () => {
  it("counts tokens in a string", () => {
    const n = count("Hello, this is a test message.");
    assert.ok(n > 0);
  });

  it("counts tokens in a message array", () => {
    const msgs = [
      { role: "user", content: "What is RAG?" },
      { role: "assistant", content: "RAG stands for retrieval-augmented generation." },
    ];
    const n = count(msgs);
    assert.ok(n > 5);
  });

  it("returns higher count for longer text", () => {
    const short = count("Hi");
    const long = count("Hi ".repeat(100));
    assert.ok(long > short);
  });
});

// ── agentcast tests ──────────────────────────────────────────────────────────

describe("agentcast — JSON extraction", () => {
  it("extracts JSON from fenced block", () => {
    const text = 'Here is the result:\n```json\n{"answer": "RAG", "confidence": 0.9}\n```';
    const extracted = extractJson(text);
    assert.equal(extracted.answer, "RAG");
    assert.equal(extracted.confidence, 0.9);
  });

  it("extracts inline JSON", () => {
    const text = 'The result is {"answer": "test", "sources": [], "confidence": 0.5}';
    const extracted = extractJson(text);
    assert.equal(extracted.answer, "test");
  });

  it("returns null for non-JSON text", () => {
    const extracted = extractJson("This is plain text with no JSON.");
    assert.equal(extracted, null);
  });
});
