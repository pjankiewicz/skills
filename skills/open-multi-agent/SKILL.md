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

### Recipe 1 — Triage GitHub issues, fan out one worker per issue into its own git worktree

The canonical "agent farm" pattern. Phase A: a triage agent reads open issues and emits a Zod-validated list of solvable ones. Phase B: deterministic driver code creates one git worktree + branch per solvable issue (do **not** delegate filesystem state changes to the LLM — keep this auditable). Phase C: one ephemeral worker agent per worktree runs in parallel under an `AgentPool` concurrency cap. Phase D: branches are pushed; failed worktrees are kept for inspection.

```ts
import {
  OpenMultiAgent, Agent, AgentPool,
  ToolRegistry, ToolExecutor, registerBuiltInTools,
} from '@jackchen_me/open-multi-agent'
import type { AgentConfig } from '@jackchen_me/open-multi-agent'
import { z } from 'zod'
import { execSync } from 'node:child_process'

// --- Provider config (local gemma via Ollama; swap for Anthropic/etc. as needed) ---
const OLLAMA = { provider: 'openai', baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' } as const
const MODEL = 'gemma3:12b'   // 4b minimum for reliable tool calls; bigger is steadier

const orchestrator = new OpenMultiAgent({
  defaultModel: MODEL, defaultProvider: OLLAMA.provider,
  defaultBaseURL: OLLAMA.baseURL, defaultApiKey: OLLAMA.apiKey,
  onProgress: (e) => console.log(e.type, e.agent ?? e.task ?? ''),
})

// --- Phase A: triage with structured output --------------------------------
const TriagePlan = z.object({
  solvable: z.array(z.object({
    number: z.number(),
    title: z.string(),
    plan: z.string().describe('1–3 line plan for fixing it in one branch'),
    riskNotes: z.string().optional(),
  })),
  skipped: z.array(z.object({ number: z.number(), reason: z.string() })),
})

const triage: AgentConfig = {
  name: 'triage', model: MODEL, ...OLLAMA,
  systemPrompt:
    'You are a triage agent. Use `gh issue list/view` (via bash) to read open issues. ' +
    'For each, decide whether it can be fixed by editing a small set of files in one ' +
    'isolated branch. Be conservative — prefer skipping ambiguous issues. Output JSON.',
  tools: ['bash'],
  outputSchema: TriagePlan,
  maxTurns: 10,
  loopDetection: { maxRepetitions: 3, onLoopDetected: 'terminate' },
}

const triageRun = await orchestrator.runAgent(
  triage,
  'Run `gh issue list --state open --limit 20 --json number,title,labels,body`. ' +
  'For each, fetch full body if needed via `gh issue view <n>`. Return the schema.',
)
const plan = triageRun.structured as z.infer<typeof TriagePlan> | undefined
if (!plan) throw new Error(`triage failed: ${triageRun.output.slice(0, 200)}`)

// --- Phase B: provision worktrees deterministically ------------------------
const REPO = process.cwd()
const ROOT = '/tmp/agent-wt'
execSync(`mkdir -p ${ROOT}`)

type Job = { number: number; title: string; plan: string; branch: string; path: string }
const jobs: Job[] = plan.solvable.map(i => {
  const branch = `agent/issue-${i.number}`
  const path = `${ROOT}/issue-${i.number}`
  // -B replaces an existing branch; --force handles a stale worktree directory
  execSync(`git -C "${REPO}" worktree add --force -B ${branch} "${path}" HEAD`, { stdio: 'inherit' })
  return { number: i.number, title: i.title, plan: i.plan, branch, path }
})

// --- Phase C: build one ephemeral worker per job, fan out via the pool ----
function buildWorker(job: Job): Agent {
  const cfg: AgentConfig = {
    name: `worker-${job.number}`,
    model: MODEL, ...OLLAMA,
    systemPrompt:
      `You work ONLY inside ${job.path}. Always pass cwd=${job.path} to the bash tool. ` +
      `Use absolute paths for file_read/file_write/file_edit. ` +
      `When changes look right, run \`git -C ${job.path} add -A && git -C ${job.path} commit -m "fix(#${job.number}): <one-line>"\`. ` +
      `Do not push; the driver will. Stop with a one-paragraph summary.`,
    tools: ['bash', 'file_read', 'file_write', 'file_edit', 'grep', 'glob'],
    maxTurns: 30,
    timeoutMs: 10 * 60_000,                                  // wall-clock cap per worker
    maxTokenBudget: 200_000,                                 // cumulative input+output cap
    loopDetection: { maxRepetitions: 4, onLoopDetected: 'terminate' },
    compressToolResults: { minChars: 800 },                  // keep context lean across turns
  }
  const reg = new ToolRegistry()
  registerBuiltInTools(reg)
  return new Agent(cfg, reg, new ToolExecutor(reg))
}

const pool = new AgentPool(2)        // see Pitfalls: real Ollama parallelism needs OLLAMA_NUM_PARALLEL

const settled = await Promise.allSettled(
  jobs.map(job => pool.runEphemeral(
    buildWorker(job),
    `Resolve issue #${job.number}: ${job.title}\n\nPlan:\n${job.plan}\n\nWorktree: ${job.path}`,
  )),
)

// --- Phase D: push successful branches; keep failed worktrees for triage --
for (const [i, r] of settled.entries()) {
  const job = jobs[i]!
  if (r.status === 'fulfilled' && r.value.success) {
    execSync(`git -C "${job.path}" push -u origin ${job.branch}`, { stdio: 'inherit' })
    console.log(`#${job.number} → ${job.branch} pushed (${r.value.tokenUsage.output_tokens} out tokens)`)
  } else {
    const why = r.status === 'rejected' ? r.reason : r.value.output.slice(0, 200)
    console.warn(`#${job.number} kept at ${job.path}: ${why}`)
  }
}
// Cleanup pattern (run after merging): `git -C $REPO worktree remove $path && git branch -D $branch`
```

Anatomy worth noting:
- **Triage stays inside the framework.** `outputSchema` + `runAgent` gives one validated retry on JSON-parse failure; you get either a typed plan or a clear failure to abort on.
- **Worktree provisioning is deterministic driver code.** Git plumbing in the LLM's hands is a foot-gun — keep it in TypeScript where you can read the diff and roll back.
- **Workers are ephemeral.** Each one is a fresh `Agent` instance constructed at fan-out time, so they don't need pool registration and can have unique names without collision. `runEphemeral` skips the per-agent mutex `run`/`runParallel` would impose.
- **Sandboxing via systemPrompt + cwd parameter.** OMA has no per-agent `cwd` field; you bake the path into the systemPrompt and instruct the agent to pass `cwd` on every bash call. The bash tool honours `cwd` from the LLM's input args.
- **`Promise.allSettled` is on purpose.** A single worker crashing must not kill the batch — every issue is independent.
- **Per-worker controls.** `timeoutMs`, `maxTokenBudget`, `loopDetection`, and `compressToolResults` are the four knobs that keep an autonomous worker from burning the house down on a misread issue.

To open PRs after pushing, either chain a second pass with a small writer agent (Zod-validated `{title, body}` per issue → `gh pr create`) or do it deterministically with `gh` in the driver — same trade-off as worktree provisioning.

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
