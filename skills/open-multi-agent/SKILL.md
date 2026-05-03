---
name: open-multi-agent
description: Use when building multi-agent orchestration in TypeScript/Node.js — decomposing a goal into parallel agent tasks, wiring an explicit task DAG across multiple LLM agents, mixing providers (Anthropic/OpenAI/Gemini/Grok/DeepSeek/Ollama/vLLM/local), connecting MCP servers, or producing Zod-validated structured output. Triggers on `@jackchen_me/open-multi-agent`, `open-multi-agent`, `OpenMultiAgent`, `runTeam`, `runTasks`, the `oma` CLI, or "TypeScript multi-agent framework". Skip for single-shot LLM calls (use the SDK directly), Python multi-agent stacks, or LangGraph/Mastra/CrewAI work.
---

# open-multi-agent

`open-multi-agent` (OMA) is a TypeScript-native multi-agent orchestration framework. Give it a goal, the coordinator decomposes it into a task DAG, parallelizes independent tasks, and synthesizes the result. Three runtime dependencies (`@anthropic-ai/sdk`, `openai`, `zod`); peers (`@google/genai`, `@modelcontextprotocol/sdk`) load lazily.

## When to use

- User asks for a TypeScript multi-agent system, not a single LLM call.
- Workflow has multiple specialised roles (architect/developer/reviewer, researcher/writer/critic, parallel extractors + aggregator).
- Goal is naturally decomposable but the user does not want to hand-wire a graph (`runTeam`).
- Goal IS a known pipeline and the user wants explicit control (`runTasks`).
- Need MCP tool servers, Zod-validated outputs, mixed providers in one team, or local models via Ollama/vLLM/LM Studio.

**Not the right fit:** single-shot prompts (use `@anthropic-ai/sdk` / `openai` directly), Python stacks (use CrewAI), pre-compiled state-machine graphs (use LangGraph JS), explicit Supervisor wiring (use Mastra).

## Install

```bash
npm install @jackchen_me/open-multi-agent
```

Requires Node ≥ 18 and ESM. The package is ESM-only — set `"type": "module"` in `package.json`, or import from `.mjs`. Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`, etc.) before running.

## Mental model

Three execution modes, picked by how much structure the caller wants to specify:

| Mode | Call | Use when |
|---|---|---|
| Single agent | `orchestrator.runAgent(config, prompt)` | One agent, one prompt. |
| Goal-driven team | `orchestrator.runTeam(team, goal)` | A coordinator decomposes the goal into a task DAG at runtime, then runs independent tasks in parallel. |
| Explicit pipeline | `orchestrator.runTasks(team, tasks)` | Caller supplies the tasks and `dependsOn` graph. |

`runTeam` injects a temporary "coordinator" agent that produces a JSON task array (`title`, `description`, `assignee`, `dependsOn`). `TaskQueue` resolves dependencies topologically; each task result is written to `SharedMemory` so later tasks see prior output; the coordinator synthesises the final result.

## Quick start — auto-orchestrated team

```ts
import { OpenMultiAgent } from '@jackchen_me/open-multi-agent'
import type { AgentConfig } from '@jackchen_me/open-multi-agent'

const architect: AgentConfig = {
  name: 'architect',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'Design clear API contracts and file structures.',
  tools: ['file_write'],
}
const developer: AgentConfig = {
  name: 'developer',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'Implement what the architect specifies.',
  tools: ['bash', 'file_read', 'file_write', 'file_edit'],
}
const reviewer: AgentConfig = {
  name: 'reviewer',
  model: 'claude-sonnet-4-6',
  systemPrompt: 'Review code for correctness, security, clarity.',
  tools: ['file_read', 'grep'],
}

const orchestrator = new OpenMultiAgent({
  defaultModel: 'claude-sonnet-4-6',
  onProgress: (e) => console.log(e.type, e.task ?? e.agent ?? ''),
})

const team = orchestrator.createTeam('api-team', {
  name: 'api-team',
  agents: [architect, developer, reviewer],
  sharedMemory: true,
})

const result = await orchestrator.runTeam(
  team,
  'Build a minimal Express REST API in /tmp/api/ with /health and /users routes.',
)
console.log(result.success, result.totalTokenUsage.output_tokens)
```

## Explicit DAG (`runTasks`)

```ts
const result = await orchestrator.runTasks(team, [
  { id: 'design',     title: 'Design',  description: 'Draft routes', assignee: 'architect' },
  { id: 'implement',  title: 'Build',   description: 'Implement routes', assignee: 'developer', dependsOn: ['design'] },
  { id: 'review',     title: 'Review',  description: 'Review code', assignee: 'reviewer',  dependsOn: ['implement'], maxRetries: 2, retryDelayMs: 1000, retryBackoff: 2 },
])
```

Independent tasks run in parallel; failed tasks cascade-fail their dependents unless retries succeed.

## Built-in tools

`bash`, `file_read`, `file_write`, `file_edit`, `grep`, `glob`. Filter via `AgentConfig`:

```ts
{ toolPreset: 'readonly' }                                     // grep, glob, file_read
{ toolPreset: 'readwrite' }                                    // + file_write, file_edit
{ toolPreset: 'full' }                                         // + bash
{ tools: ['bash', 'file_read'] }                               // explicit allowlist
{ disallowedTools: ['bash'] }                                  // blacklist on top of preset
```

`delegate_to_agent` is opt-in and only injected during `runTeam`/`runTasks` — it lets one agent hand a sub-prompt to another, with cycle and depth guards (`maxDelegationDepth`, default 3).

## Custom tools (Zod)

```ts
import { z } from 'zod'
import { defineTool } from '@jackchen_me/open-multi-agent'

const fetchData = defineTool({
  name: 'fetch_data',
  description: 'Fetch JSON from a URL.',
  inputSchema: z.object({ url: z.string().url() }),
  execute: async ({ url }) => ({ data: await (await fetch(url)).text() }),
})
// Attach via AgentConfig.customTools
```

`defineTool` returns a `ToolDefinition`. Custom tools bypass `tools`/`toolPreset` filtering but respect `disallowedTools`. Tool-name collisions with built-ins throw at registration.

## MCP integration

```ts
import { connectMCPTools } from '@jackchen_me/open-multi-agent/mcp'

const { tools, close } = await connectMCPTools({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GH_TOKEN },
  namePrefix: 'github',
})
// pass `tools` into AgentConfig.customTools, then `await close()` after the run
```

The MCP entry is a separate subpath (`@jackchen_me/open-multi-agent/mcp`) so non-MCP users don't pay the import cost. `@modelcontextprotocol/sdk` is a peer dep and must be installed.

## Structured output

```ts
import { z } from 'zod'
const schema = z.object({ sentiment: z.enum(['pos','neg','neu']), confidence: z.number() })
const analyst: AgentConfig = { name: 'analyst', model: 'claude-sonnet-4-6', outputSchema: schema }
const result = await orchestrator.runAgent(analyst, 'Analyze: …')
const data = result.structured as z.infer<typeof schema>  // undefined if both attempts fail validation
```

The framework parses the agent's final output as JSON and validates. One automatic retry with error feedback on parse/validation failure. Distinct from `ToolDefinition.outputSchema`, which validates a single tool's output string.

## Providers

Native: `anthropic`, `openai`, `azure-openai`, `gemini`, `grok`, `deepseek`, `minimax`, `qiniu`, `copilot`. OpenAI-compatible endpoints (Ollama / vLLM / LM Studio / OpenRouter / Groq) via `provider: 'openai'` + `baseURL`:

```ts
{ name: 'local', model: 'qwen2.5:14b', provider: 'openai',
  baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' }   // placeholder required
```

Provider routing: pass `provider` explicitly on `AgentConfig` (or `defaultProvider` on the orchestrator). When omitted, the framework infers from the `model` string for known prefixes — be explicit when the model name is ambiguous (e.g. an OpenAI-compatible local model whose name starts with `claude-`).

Sampling caveats:
- `topK`, `minP` are rejected by cloud OpenAI; only Anthropic and OpenAI-compatible local servers honour them.
- `frequencyPenalty`, `presencePenalty`, `parallelToolCalls` are OpenAI-track only; Anthropic adapter ignores them.
- `extraBody` is the escape hatch for anything else; spread before structural fields, so it cannot override `model`/`messages`/`tools`/`stream`.

## Observability

Three independently consumable layers:

```ts
new OpenMultiAgent({
  onProgress: (e) => /* task_start | task_complete | task_skipped | task_retry | agent_start | agent_complete | budget_exceeded | message | error */,
  onTrace:    (e) => /* TraceEvent: llm_call | tool_call | task | agent — pipe to OTel/Datadog/Honeycomb/Langfuse */,
})

import { renderTeamRunDashboard } from '@jackchen_me/open-multi-agent'
import { writeFileSync } from 'node:fs'
writeFileSync('run.html', renderTeamRunDashboard(result))      // static HTML, no server, no D3
```

## Production controls (per agent unless noted)

| Control | What it does |
|---|---|
| `maxTurns` | Hard cap on conversation loop turns |
| `maxTokens` | Per-call output cap |
| `maxTokenBudget` | Cumulative input+output cap for the run; aborts cleanly with `budgetExceeded: true` |
| `timeoutMs` | Wall-clock cap; aborts via `AbortSignal.timeout()` |
| `contextStrategy` | `sliding-window` / `summarize` / `compact` / `custom` — keeps context from blowing up |
| `loopDetection` | Sliding-window detector for repeated tool calls or text; `'warn'` / `'terminate'` / callback |
| `maxToolOutputChars` | Truncate tool output (head + tail with marker) |
| `compressToolResults` | Replace already-consumed tool results with a marker on next turn |
| Task `maxRetries` / `retryDelayMs` / `retryBackoff` | Per-task retry with exponential backoff (cap 30s) |
| Orchestrator `maxConcurrency` | Parallel agent runs (default 5); `Team.maxConcurrency` overrides |
| Orchestrator `maxDelegationDepth` | Cap on nested `delegate_to_agent` chains (default 3) |
| Orchestrator `onApproval` | Human-in-the-loop gate between task rounds; return `false` to abort |

## CLI (`oma`)

After `npm install`, the package exposes the `oma` binary (or `node dist/cli/oma.js` from a clone). JSON-first; designed for shell and CI. Subcommands: `oma run`, `oma task`, `oma provider`, `oma help`. Schemas and exit codes in [`docs/cli.md`](https://github.com/JackChen-me/open-multi-agent/blob/main/docs/cli.md). Note: `TeamConfig.sharedMemoryStore` is SDK-only; the CLI cannot pass runtime objects.

## Common pitfalls

- **CommonJS project.** OMA is ESM-only. Either set `"type": "module"` or use dynamic `import()`.
- **Ollama / vLLM auth.** OpenAI SDK rejects empty `apiKey`; pass any non-empty placeholder (`'ollama'`).
- **Local server tool-call truncation.** Some quantised vLLM/llama-server setups corrupt parallel tool-call streams. Set `parallelToolCalls: false` to force serial.
- **Local model emits tool calls as text.** OMA has a fallback extractor for raw JSON, fenced JSON, Hermes `<tool_call>` tags, and JSON inside unclosed `<think>` tags. Native `tool_calls` always win when the server emits them.
- **MCP not loaded.** `@modelcontextprotocol/sdk` is a peer dep — install it explicitly. Import only from `@jackchen_me/open-multi-agent/mcp`.
- **Structured output retry budget.** Only one retry on validation failure; if it still fails, `result.structured` is `undefined` and `result.output` holds the raw text.
- **Coordinator can be steered.** `runTeam` accepts a `CoordinatorConfig` with `instructions` (appended) or `systemPrompt` (replaces preamble; team roster + format + synthesis sections are still appended).
- **Delegation tokens count toward parent budget.** A delegated agent's `tokenUsage` is surfaced via `ToolResult.metadata.tokenUsage` and accumulated before the next `maxTokenBudget` check — delegation can't silently exceed the cap.

## When the user asks "what about X?"

| User asks | Point them at |
|---|---|
| Goal → DAG, TypeScript | OMA (`runTeam`) |
| Pre-defined declarative graph, mature checkpointing | LangGraph JS |
| Explicit Supervisor + hand-wired workflows in TS | Mastra |
| Python ecosystem | CrewAI |
| Single-agent unified LLM client | Vercel AI SDK |

OMA composes with the AI SDK: AI SDK for the LLM call layer in single-agent code, OMA when you need a team.

## References

- Repo: <https://github.com/JackChen-me/open-multi-agent>
- npm: `@jackchen_me/open-multi-agent`
- Examples (worked workflows): [`examples/cookbook/`](https://github.com/JackChen-me/open-multi-agent/tree/main/examples/cookbook), [`examples/patterns/`](https://github.com/JackChen-me/open-multi-agent/tree/main/examples/patterns), [`examples/integrations/`](https://github.com/JackChen-me/open-multi-agent/tree/main/examples/integrations)
- CLI: [`docs/cli.md`](https://github.com/JackChen-me/open-multi-agent/blob/main/docs/cli.md)
- Shared memory backends: [`docs/shared-memory.md`](https://github.com/JackChen-me/open-multi-agent/blob/main/docs/shared-memory.md)
- Context strategies: [`docs/context-management.md`](https://github.com/JackChen-me/open-multi-agent/blob/main/docs/context-management.md)
