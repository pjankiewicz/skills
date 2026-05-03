---
name: open-multi-agent
description: Use when building autonomous agent systems in TypeScript/Node.js — triaging a list (GitHub issues, files, URLs) and dispatching parallel workers per item, running each worker inside its own git worktree or sandbox, fanning out one ephemeral agent per dynamic input via AgentPool, decomposing a goal into a parallel task DAG, running local gemma/qwen via Ollama or vLLM with concurrency caps, mixing providers (Anthropic/OpenAI/Gemini/Grok/DeepSeek/local) in one team, connecting MCP servers, or producing Zod-validated structured output. Triggers on `@jackchen_me/open-multi-agent`, `OpenMultiAgent`, `AgentPool`, `runTeam`, `runTasks`, `runParallel`, `runEphemeral`, the `oma` CLI, "agent farm", "parallel workers per issue", "TypeScript multi-agent framework". Skip for single-shot LLM calls, Python multi-agent stacks, or LangGraph/Mastra/CrewAI work.
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

A fourth primitive — `AgentPool` — sits below all three modes. It is what `runTeam`/`runTasks` use internally and what you reach for when the *number of workers is dynamic* (one per issue, file, URL, batch row). Three call shapes:

| Call | Use when |
|---|---|
| `pool.run(name, prompt)` | Run a registered agent by name; pool semaphore + per-agent mutex. |
| `pool.runEphemeral(agent, prompt)` | Run a freshly-built `Agent` instance once; pool semaphore only. **The right primitive when you build N workers from a list at runtime** (workers don't need to be registered, and same-name collision in `runParallel` is avoided). |
| `pool.runParallel([{ agent, prompt }])` | Fan out across distinct *registered* names. Same agent name → only the last result is kept; for N-from-a-list use `runEphemeral` + `Promise.allSettled`. |

`pool.availableRunSlots` reads the live semaphore; `pool.getStatus()` returns lifecycle counts. Constructor: `new AgentPool(maxConcurrency = 5)`.

## Recipes

### Recipe 1 — Fan out one worker per item (the "agent farm" pattern)

Whenever you have a list of items (GitHub issues, files, URLs, dataset rows, log entries), the same four-phase shape applies. Items, sandbox, workers, gather. Keep filesystem and remote-state mutations in deterministic driver code; only LLM reasoning happens inside agents.

```ts
import {
  Agent, AgentPool,
  ToolRegistry, ToolExecutor, registerBuiltInTools,
} from '@jackchen_me/open-multi-agent'
import type { AgentConfig } from '@jackchen_me/open-multi-agent'

// A) Produce the item list — either deterministic (read a directory, fetch a feed)
//    or LLM-mediated with `runAgent` + `outputSchema` for Zod-validated triage.

// B) Provision per-item sandboxes in driver code (git worktree, tmpdir, container, …).
//    Don't ask the LLM to do this — keep the audit trail in TypeScript.

// C) Build one ephemeral Agent per item and fan out under a concurrency cap.
function buildWorker(item: Item): Agent {
  const reg = new ToolRegistry()
  registerBuiltInTools(reg)
  // Custom tools must be registered HERE on the registry — `customTools` on AgentConfig is
  // only honoured by the orchestrator's run-paths (runAgent/runTeam/runTasks). Hand-built
  // Agents fed to runEphemeral silently drop it. (See pitfalls below.)
  reg.register(buildReportStatusTool(item.id), { runtimeAdded: true })

  const cfg: AgentConfig = {
    name: `worker-${item.id}`,        // unique per item; ephemeral, not pool-registered
    model: MODEL, ...PROVIDER,
    systemPrompt:
      `Work ONLY inside ${item.sandbox}. Pass cwd=${item.sandbox} on every bash call. ` +
      `Make the smallest change. Commit when done; do not push. ` +
      // Cheap, decisive prohibition — without it weak models will eagerly run
      // cargo/npm/pytest from inside a fresh worktree and recompile everything from zero.
      `Do NOT run heavy builds (\`cargo build/test\`, \`npm install\`, \`pytest\` over big trees) ` +
      `unless the task explicitly requires compiled-code verification.`,
    tools: ['bash', 'file_read', 'file_write', 'file_edit', 'grep', 'glob'],
    maxTurns: 30,
    maxTokens: 4096,                                          // per-call cap; backstop against in-turn token babble
    timeoutMs: 10 * 60_000,
    maxTokenBudget: 200_000,
    loopDetection: { maxRepetitions: 4, onLoopDetected: 'terminate' },
    compressToolResults: { minChars: 800 },
  }
  return new Agent(cfg, reg, new ToolExecutor(reg))
}

const pool = new AgentPool(CONCURRENCY)
const settled = await Promise.allSettled(
  items.map(item => pool.runEphemeral(buildWorker(item), buildPrompt(item))),
)

// D) Gather: inspect successes, push/cleanup based on policy. One failure must not
//    kill the batch — `Promise.allSettled` is the point.
```

**Anatomy that's load-bearing across every variant:**

- **Triage stays in the framework if you need it.** `outputSchema` (Zod) on a `runAgent` call gives one validated retry on JSON-parse failure; you get either a typed plan or a clear failure to abort on.
- **Sandboxing belongs to the driver.** Worktrees, tmpdirs, ephemeral containers — provisioned by deterministic TS, never delegated to the LLM. Same for `git push`, `gh pr create`, network calls with side-effects.
- **Workers are ephemeral.** A fresh `Agent` instance per item, run via `runEphemeral`. They aren't registered, can have unique names without collision, and `runEphemeral` skips the per-agent mutex that `run`/`runParallel` would impose.
- **Sandboxing inside the worker is a systemPrompt + bash-arg pattern.** OMA has no per-agent `cwd` field. Bake the absolute path into the systemPrompt and instruct the agent to pass `cwd` on every bash call. The `bash` tool reads `cwd` from the LLM's tool-call arguments.
- **`Promise.allSettled` is intentional.** Independent items must fail independently.
- **Five production knobs every worker needs:** `timeoutMs` (wall clock), `maxTokenBudget` (cumulative), `maxTokens` (per call — the backstop against in-turn token babble), `loopDetection` (across-turn repetition), and `compressToolResults` (don't re-feed every read into every turn). Without all five, one misread item can burn wall clock, token budget, or both.
- **Forbid heavy builds in the systemPrompt.** Weak models (gemma 31B, qwen 30B) will eagerly run `cargo test` / `npm install` / `pytest` to "verify" a one-line text change, and a fresh worktree has no shared build cache so they compile your whole project from zero. Either tell them not to (cheap), or set `CARGO_TARGET_DIR=<main-checkout>/target` (or the equivalent) so all worktrees share artefacts (also cheap, more permissive).
- **A worker's `result.success === true` does NOT mean the change is correct.** It means the model ended its turn cleanly. Always capture `result.output` so you can see *why* it stopped — "blocked", "fix already in HEAD", "I assumed it was fine because the test crashed". Without this, runs are opaque.
- **A worker may stop with the worktree dirty but uncommitted.** It hit `maxTurns` mid-flow, or got distracted into a build that crashed. The driver should fall back: after the worker stops, if `git -C ${path} status --porcelain` is non-empty, commit deterministically (`fix(<id>): WIP — worker did not commit`) so the diff isn't lost.

**Live observability — optional sidekick.** Mid-run progress isn't surfaced by OMA's `onProgress`/`onTrace` for ephemeral runs (those wire up at the orchestrator level). The pattern that works:

1. Driver emits `task_start` / `task_done` / `task_failed` events around each `pool.runEphemeral` call.
2. Each worker gets a tiny custom tool that writes a `task_status` event when called. The system prompt instructs the worker to call it before each major step.

```ts
// `reporter` is an agent-farm Reporter (or any equivalent JSONL appender)
function buildReportStatusTool(taskId: string) {
  return defineTool({
    name: 'report_status',
    description: 'Report progress so the dashboard can show what you are doing. Call before each major step.',
    inputSchema: z.object({
      phase: z.enum(['reading', 'editing', 'testing', 'committing', 'done', 'blocked']),
      msg: z.string(),
    }),
    execute: async ({ phase, msg }) => {
      reporter.taskStatus({ taskId, phase, msg })
      return { data: 'noted' }
    },
  })
}
```

Both kinds of event go into a per-run JSONL file. The companion [`agent-farm`](../../agent-farm/README.md) tool watches that file and renders a live dashboard — drop it in if you want a UI; skip it if the JSONL itself is enough. The [event format](../../agent-farm/EVENTS.md) is small and dependency-free.

**Verified end-to-end with `google/gemma-4-31b-it` on OpenRouter.** Triage produces clean Zod-validated output reliably; workers do call `report_status` once it's actually registered on the registry (the trap above). The same model also exhibits the in-turn token-babble failure mode and the "recompile-the-world to verify a typo" failure mode — both of which the production knobs above defend against.

**Concrete instance — GitHub issues into git worktrees.** Specialise the four phases as: (A) `runAgent` over `gh issue list --json …` with a Zod schema picking solvable issues; (B) `git worktree add -b agent/issue-N /tmp/wt/issue-N HEAD` per item; (C) workers told to commit with `fix(#N): …` and never push; (D) driver pushes branches you accept after diff review, removes worktrees you reject (`git worktree remove --force …`). Same shape applies to URLs (sandbox = tmpdir), files (sandbox = copy), dataset rows (sandbox = a workspace per row).

### Recipe 2 — Map–reduce over a list with `runParallel` (fixed-name analysts → aggregator)

Use this shape when the workers are a small fixed roster (e.g. three analyst perspectives + one synthesiser), not a dynamic list. `runParallel` is the cleanest call here because each worker has a distinct registered name.

```ts
const pool = new AgentPool(3)
pool.add(buildAgent(optimist))      // see fan-out-aggregate example for buildAgent helper
pool.add(buildAgent(skeptic))
pool.add(buildAgent(pragmatist))
pool.add(buildAgent(synthesiser))

const analyses = await pool.runParallel([
  { agent: 'optimist',   prompt: TOPIC },
  { agent: 'skeptic',    prompt: TOPIC },
  { agent: 'pragmatist', prompt: TOPIC },
])
// analyses: Map<string, AgentRunResult> — failures surface as { success: false }, not throws
const synth = await pool.run('synthesiser',
  ['optimist','skeptic','pragmatist'].map(n => `--- ${n} ---\n${analyses.get(n)!.output}`).join('\n\n'),
)
```

`runParallel` settles all branches even when some fail (returns failures as `{ success: false }` results in the map). Same agent name twice → only the last result survives; reach for `runEphemeral` instead.

### Recipe 3 — Local gemma via Ollama, with parallelism that actually parallelises

Single-flag setup, but the parallelism story has a sharp edge: Ollama serves one inference at a time per model unless `OLLAMA_NUM_PARALLEL` is set on the server. Without it, an `AgentPool(8)` is theatre — eight pool slots, but the LLM queue is still serial.

```ts
// On the host running ollama serve:
//   OLLAMA_NUM_PARALLEL=4 OLLAMA_MAX_LOADED_MODELS=1 ollama serve
// (consumes ~N× KV-cache memory; tune for your VRAM)

const cfg: AgentConfig = {
  name: 'worker', model: 'gemma3:12b',
  provider: 'openai',
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',                         // non-empty placeholder; OpenAI SDK rejects ''
  parallelToolCalls: false,                 // some quantised builds corrupt parallel tool-call streams
  maxTurns: 30,
  timeoutMs: 10 * 60_000,
}
```

Reach for vLLM, llama.cpp's server, or a hosted gemma (Groq, OpenRouter — both via `provider: 'openai'` + their `baseURL`) when you need ≥4 concurrent worker agents and Ollama's KV-cache budget can't stretch.



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
- **`runParallel` collapses duplicate agent names.** Tasks keyed on agent name; the result map keeps only the last result for any name that appears twice. For "N workers from a list" use `runEphemeral` + `Promise.allSettled`, not `runParallel` with hand-built unique names.
- **Ollama parallelism is opt-in.** `OLLAMA_NUM_PARALLEL` (server-side env var) controls how many inference requests Ollama services concurrently. Without it, `AgentPool(N)` for N>1 is theatre — the pool slots open but Ollama serialises behind the scenes. vLLM and Groq give real concurrent inference.
- **`AgentConfig` has no `cwd` field.** Agent workspace isolation is a systemPrompt + bash-tool-arg pattern, not framework state. Bake the absolute path into the systemPrompt and tell the agent to pass `cwd` on every bash call. The bash tool reads `cwd` from the LLM's tool-call args, not from `ToolUseContext`.
- **Don't let an LLM run `git worktree add` / `git push`.** Filesystem and remote-state mutations belong in deterministic driver code where the diff is auditable. Have the agent edit + commit *inside* a worktree the driver provisioned; have the driver push.
- **Small gemmas (≤4B) struggle with tool calls.** Use `gemma3:12b` or larger when the worker needs `bash`/`file_*`. For tighter models, prefer pure structured output (no tools) for triage/extraction passes; do the side effects deterministically afterward.
- **Worker timeouts are per agent, not per pool.** `AgentPool` itself has no timeout. Set `timeoutMs` on each `AgentConfig` and combine with `maxTokenBudget` and `loopDetection` so a single stuck worker can't burn the batch's wall-clock or token budget.
- **`runEphemeral` is not registered.** The `Agent` is built fresh, runs once, and is discarded. It does not appear in `pool.list()` / `pool.getStatus()` and cannot be re-targeted by name. That's the point — if you need the same worker for a follow-up turn, use `pool.run` with a registered agent.
- **`AgentConfig.customTools` is silently dropped on the `runEphemeral` path.** It's read only by the orchestrator's internal `buildAgent()` (used by `runAgent`/`runTeam`/`runTasks`). When you hand-build an `Agent` for `runEphemeral`, you must register custom tools on the `ToolRegistry` yourself: `reg.register(myTool, { runtimeAdded: true })`. If you set `customTools` on the config and skip the registry call, the tool simply doesn't exist for the worker — and the model never calls it, no error.
- **In-turn token babble isn't caught by `loopDetection`.** That detector compares full turns. A single assistant turn that emits `<|channel>thought a a a a a …` for thousands of tokens (a real failure mode for gemma-4 31B and other quantised builds under context pressure) will run all the way to `maxTokenBudget` unless you also set a per-call `maxTokens` cap. A 4096-token cap is cheap and decisive.
- **Workers will recompile your whole project to "verify" a trivial change.** Observed in production: gemma 31B asked to fix a markdown typo ran `cargo test` from inside a fresh worktree, recompiled fitnessgrid from scratch into a per-worktree `target/` (4.9 GB), then crashed with ENOSPC and burned its remaining turns trying to recover — never committing the actual fix. The fixes:
  1. Forbid heavy builds in the systemPrompt unless the change requires compiled verification, OR
  2. Inject `env: { CARGO_TARGET_DIR: '${repo}/target' }` (or equivalent) so all worktrees share build artefacts.
- **Worker can stop without committing.** Hitting `maxTurns` after a tool failure leaves the worktree dirty but un-committed; the worker reports "success" (the run ended cleanly) and the diff would be lost without a fallback. Add a deterministic post-run check: `git status --porcelain` non-empty → commit with `fix(<id>): WIP — worker did not commit`. Same idea for any sandbox where the worker's edits should be preserved.
- **Capture `result.output` in every emitted event.** `success: true, output: ''` happens, and so does `success: true, output: '<|channel>thought a a a a …'`. Without the final text in your event log, "stopped" and "stopped with garbage" look identical in the dashboard.
- **`git worktree` provisioning needs a prune step.** If a previous run had its worktree dirs deleted with `rm -rf` (or any non-`git worktree remove` cleanup), git keeps the metadata in `.git/worktrees/`. Subsequent `git worktree add -b` calls fail with "branch already exists" or "fatal: '<path>' already registered". Always run `git worktree prune` before the provisioning loop.

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
