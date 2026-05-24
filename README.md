# agent-pipeline

Production-grade multi-step research agent. Wires all five [`@mukundakatta`](https://www.npmjs.com/~mukundakatta) agent-stack packages into a single pipeline:

```
agentfit → agentguard → agentvet → agentcast → agentsnap
```

## What it does

Given a research question, the pipeline:

1. **agentvet** — validates tool args before calling `web_search` and `fetch_page`
2. **agentguard** — enforces an egress allowlist so fetch calls only reach approved hosts
3. **agentfit** — measures token usage and trims history to stay within budget
4. **agentcast** — drives the LLM call and validates/retries structured JSON output
5. **agentsnap** — records the full tool-call trace for regression testing

## Install

```bash
npm install
npm run build
```

## Usage

```bash
# Stub mode (offline, no API key needed)
STUB=1 node dist/cli.js "What is retrieval-augmented generation?"

# Live mode
ANTHROPIC_API_KEY=sk-... node dist/cli.js "Explain transformer attention"
```

## Output

```
=== Result ===
Answer: ...
Sources: https://example.com/result-1, ...
Confidence: 82%

=== Agent-stack metrics ===
  token_budget_used : 314
  tool_calls        : 2
  egress_blocked    : 0

Trace: 0 tool calls recorded
```

## Tests

```bash
npm test
```

16 tests covering all five stack layers — all run offline in stub mode.

## Agent-stack packages

| Package | Role |
|---|---|
| `@mukundakatta/agentfit` | Token counting + message trimming |
| `@mukundakatta/agentguard` | Network egress firewall |
| `@mukundakatta/agentvet` | Tool arg validation |
| `@mukundakatta/agentcast` | Structured output + retry |
| `@mukundakatta/agentsnap` | Trace recording + snapshot tests |
