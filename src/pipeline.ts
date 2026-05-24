/**
 * agent-pipeline — production-grade multi-step research agent.
 *
 * Wires the full mukundakatta agent-stack:
 *
 *   1. agentfit  — trim conversation history to stay within token budget
 *   2. agentguard — enforce network egress allowlist on fetch calls
 *   3. agentvet  — validate tool arguments before each tool call
 *   4. agentcast — drive the LLM call and parse structured output
 *   5. agentsnap — record the tool-call trace for regression testing
 *
 * The pipeline runs a "research" task: given a question, it searches the
 * web (via a guarded fetch), extracts key facts (via a vetted tool), and
 * casts the result into a structured ResearchResult.
 *
 * In stub mode (STUB=1 or no ANTHROPIC_API_KEY), the LLM call is mocked
 * so the full pipeline runs offline with no credentials.
 */

import { count, fit } from "@mukundakatta/agentfit";
import { firewall, type PolicySpec, type PolicyViolation } from "@mukundakatta/agentguard";
import { vet } from "@mukundakatta/agentvet";
import { cast } from "@mukundakatta/agentcast";
import { record, type Trace } from "@mukundakatta/agentsnap";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PipelineConfig {
  model?: string;
  maxTokens?: number;
  stub?: boolean;
  allowedHosts?: string[];
  snapshotDir?: string;
}

export interface ResearchResult {
  question: string;
  answer: string;
  sources: string[];
  confidence: number; // 0.0 – 1.0
  token_budget_used: number;
  egress_blocked: number;
  tool_calls: number;
}

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

interface Message { role: string; content: string }

// ── Tool definitions (with agentvet) ─────────────────────────────────────────

const searchTool = vet<{ query: string; max_results?: number }, SearchResult[]>({
  name: "web_search",
  schema: (args: unknown) => {
    const a = args as Record<string, unknown>;
    if (typeof a["query"] !== "string" || a["query"].trim().length === 0) {
      return { valid: false, error: "query must be a non-empty string" };
    }
    if (a["max_results"] !== undefined && typeof a["max_results"] !== "number") {
      return { valid: false, error: "max_results must be a number" };
    }
    return { valid: true, value: args as { query: string; max_results?: number } };
  },
  fn: async (args) => {
    // Synthetic results for demo — real impl would call a search API.
    const n = args.max_results ?? 3;
    return Array.from({ length: n }, (_, i) => ({
      url: `https://example.com/result-${i + 1}?q=${encodeURIComponent(args.query)}`,
      title: `Result ${i + 1} for: ${args.query}`,
      snippet: `Relevant information about ${args.query}. This result provides context for understanding the topic in depth.`,
    }));
  },
});

const fetchPageTool = vet<{ url: string }, { status: number; text: string }>({
  name: "fetch_page",
  schema: (args: unknown) => {
    const a = args as Record<string, unknown>;
    if (typeof a["url"] !== "string") {
      return { valid: false, error: "url must be a string" };
    }
    try {
      new URL(a["url"] as string);
      return { valid: true, value: args as { url: string } };
    } catch {
      return { valid: false, error: "url is not a valid URL" };
    }
  },
  fn: async (args) => {
    const res = await fetch(args.url);
    const text = await res.text();
    return { status: res.status, text: text.slice(0, 2000) };
  },
});

// ── LLM stub (no API key required) ───────────────────────────────────────────

async function callLLM(
  messages: Message[],
  model: string,
  stub: boolean
): Promise<string> {
  if (stub || !process.env["ANTHROPIC_API_KEY"]) {
    // Return a structured fake answer the cast step can parse.
    const question = messages.find(m => m.role === "user")?.content ?? "unknown";
    return JSON.stringify({
      answer: `Based on the research, here is a concise answer to: "${question.slice(0, 80)}". The sources provide relevant information supporting this conclusion.`,
      sources: ["https://example.com/result-1", "https://example.com/result-2"],
      confidence: 0.82,
    });
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 512,
    messages: messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    system: "You are a research assistant. Always respond in JSON with: {answer: string, sources: string[], confidence: number}",
  });
  return response.content[0].type === "text" ? response.content[0].text : "";
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export async function runPipeline(
  question: string,
  cfg: PipelineConfig = {}
): Promise<{ result: ResearchResult; trace: Trace }> {
  const {
    model = "claude-3-haiku-20240307",
    maxTokens = 4096,
    stub = true,
    allowedHosts = ["example.com", "en.wikipedia.org", "www.wikipedia.org"],
  } = cfg;

  const egressPolicy: PolicySpec = {
    network: { allow: allowedHosts },
    violations: "throw",
  };

  let egressBlocked = 0;
  let toolCalls = 0;

  // ── Step 1: Search ────────────────────────────────────────────────────────
  toolCalls++;
  const searchResults: SearchResult[] = await searchTool({ query: question, max_results: 3 });

  // ── Step 2: Fetch top result (egress-guarded) ─────────────────────────────
  let fetchedText = "";
  try {
    const fetchResult = await firewall(egressPolicy, async () => {
      toolCalls++;
      return fetchPageTool({ url: searchResults[0].url });
    });
    fetchedText = fetchResult.text;
  } catch (err) {
    // PolicyViolation or fetch error — fall back to search snippets.
    const pv = err as PolicyViolation;
    if (pv.name === "PolicyViolation") {
      egressBlocked++;
    }
    fetchedText = searchResults.map((r: SearchResult) => r.snippet).join("\n");
  }

  // ── Step 3: Build prompt and count token budget ───────────────────────────
  const prompt = [
    `Question: ${question}`,
    `Search results:`,
    ...searchResults.map((r: SearchResult) => `- ${r.title}: ${r.snippet}`),
    `Fetched content: ${fetchedText.slice(0, 500)}`,
    `Please provide a structured JSON answer with: answer, sources[], confidence.`,
  ].join("\n");

  // Fit to budget using agentfit — measure how many tokens the prompt uses.
  const fitResult = fit([{ role: "user", content: prompt }], {
    maxTokens,
    strategy: "drop-oldest",
    onOverBudget: "return-partial",
  });
  const tokenBudget = count(fitResult.messages);

  // ── Step 4+5: cast drives the LLM call and validates the JSON output ──────
  const structured = await cast<{ answer: string; sources: string[]; confidence: number }>({
    llm: async (messages) => callLLM(messages as Message[], model, stub ?? true),
    prompt,
    system: "You are a research assistant. Always respond in JSON with: {answer: string, sources: string[], confidence: number}",
    validate: (v: unknown) => {
      const obj = v as { answer?: unknown; sources?: unknown; confidence?: unknown };
      if (typeof obj.answer !== "string") return { valid: false, error: "answer must be a string" };
      if (!Array.isArray(obj.sources)) return { valid: false, error: "sources must be an array" };
      if (typeof obj.confidence !== "number") return { valid: false, error: "confidence must be a number" };
      return { valid: true, value: obj as { answer: string; sources: string[]; confidence: number } };
    },
    maxRetries: 1,
  });

  const result: ResearchResult = {
    question,
    answer: structured.answer,
    sources: structured.sources,
    confidence: structured.confidence,
    token_budget_used: tokenBudget,
    egress_blocked: egressBlocked,
    tool_calls: toolCalls,
  };

  // ── Step 6: Record trace for snapshot testing ─────────────────────────────
  const trace = await record(
    async () => result,
    { input: question, model }
  );

  return { result, trace };
}
