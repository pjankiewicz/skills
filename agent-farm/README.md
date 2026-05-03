# agent-farm

A small, generic live dashboard for multi-agent runs. Watches a runs directory, auto-discovers any activity that follows the agent-farm event format ([`EVENTS.md`](./EVENTS.md)), and renders it.

**Optional sidekick** for the `open-multi-agent` skill — it knows nothing about issues, branches, files, or any specific use case. Anything that appends JSONL events with a `taskId` shows up as a row.

## Run the dashboard

From this directory:

```bash
npm install
npm run dev               # serves http://localhost:5180/, watches ./agent-runs/
```

Or point it elsewhere:

```bash
AGENT_FARM_DIR=~/work/some-runs npm run dev
# or via positional arg
npx tsx src/server.ts ~/work/some-runs
```

`PORT` / `AGENT_FARM_PORT` overrides the listen port (default `5180`).

## Emit events from your code

Two paths. Both write the same JSONL format described in [`EVENTS.md`](./EVENTS.md).

### Use the `Reporter` helper (≈ 50 lines)

```ts
import { Reporter } from '../path/to/agent-farm/src/reporter.js'

const r = new Reporter({
  dir: './agent-runs',
  meta: { model: 'google/gemma-4-31b-it', concurrency: 6 },
})

r.start()
r.taskStart({ taskId: 'job-1', title: 'fix script crash', metadata: { branch: 'agent/job-1' } })
r.taskStatus({ taskId: 'job-1', phase: 'editing', msg: 'patching seed_training_history.py' })
r.taskDone({ taskId: 'job-1', tokens: { input: 8200, output: 1450 } })
r.done()
```

### Inline emitter (zero dependency)

```ts
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const file = join('agent-runs', runId, 'events.jsonl')
mkdirSync(join('agent-runs', runId), { recursive: true })

const emit = (e: Record<string, unknown>) =>
  appendFileSync(file, JSON.stringify({ ts: Date.now(), runId, ...e }) + '\n')

emit({ type: 'run_start' })
emit({ type: 'task_start', taskId: 'job-1', title: 'fix bug' })
emit({ type: 'task_done',  taskId: 'job-1', tokens: { input: 8200, output: 1450 } })
emit({ type: 'run_done' })
```

The `Reporter` is convenience — the format is the contract.

## What the dashboard shows

- A run picker (newest first, sorted by mtime).
- Run header: model + any `meta.json` keys as chips.
- Per-task rows: `taskId`, title, current phase, last update, last message, token usage, elapsed.
- Free-form `metadata` (e.g. `branch`, `path`, `url`, `file`, `issue`) renders as key:value chips inside each row.

Phases are user-defined — the dashboard just colours a few common ones (`reading`, `editing`, `testing`, `committing`, `done`, `failed`, `blocked`, `running`). Anything else displays in the neutral pill.

## Wiring it into open-multi-agent code

Two clean integration points:

1. **Driver-level** — emit `task_start`, `task_done`, `task_failed` around each `pool.runEphemeral` call.
2. **Mid-task** — give each worker a tiny custom `defineTool` (for example `report_status({phase, msg})`) that writes a `task_status` event. The worker's system prompt instructs it to call the tool at major milestones.

Together these give you driver-side lifecycle events plus mid-run liveness without coupling any specific domain into the dashboard.

See the [`open-multi-agent` skill](../skills/open-multi-agent/SKILL.md) (Recipes section) for the full pattern.

## Spec

The event format is documented in [`EVENTS.md`](./EVENTS.md). It's stable and intentionally tiny — anything that writes well-formed JSONL to `agent-runs/<run-id>/events.jsonl` will appear in the dashboard.

## License

MIT
