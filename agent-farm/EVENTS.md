# agent-farm event log spec

`agent-farm` is a passive dashboard. Anything that emits events in this format to a runs directory will show up live.

## Layout

```
<runs-dir>/
  <run-id>/
    events.jsonl       # required, append-only JSONL
    meta.json          # optional, run-level metadata
```

`<run-id>` is any string usable as a filename — `2026-05-03T14-15-42`, `nightly-23`, or a uuid. Sort order in the dashboard is by directory mtime, newest first.

## events.jsonl

One JSON object per line. Required fields on every event:

| field | type | meaning |
|---|---|---|
| `ts` | number | Unix epoch milliseconds |
| `runId` | string | matches the parent dir name |
| `type` | string | one of the lifecycle types below |

Lifecycle types:

| `type` | meaning | typical fields |
|---|---|---|
| `run_start` | run began | `msg` |
| `run_done` | run finished (any outcome) | `msg`, `tokens` |
| `task_start` | a task began | `taskId`, `title`, `metadata` |
| `task_status` | mid-task progress update | `taskId`, `phase`, `msg` |
| `task_done` | task succeeded | `taskId`, `tokens`, `msg` |
| `task_failed` | task failed | `taskId`, `msg` |
| `log` | free-form run-level log line | `msg` |

Optional fields:

| field | type | when used |
|---|---|---|
| `taskId` | string | stable per-task identifier (e.g. `issue-449`, `url-foo`, `row-12`) |
| `title` | string | human-readable title (rendered as the row's title) |
| `phase` | string | user-defined phase label (e.g. `reading`, `editing`, `committing`) |
| `msg` | string | one-line message |
| `tokens` | `{input: number, output: number}` | LLM token usage |
| `metadata` | object | arbitrary per-task fields rendered as key:value chips (`branch`, `path`, `issue`, etc.) |

The dashboard groups events by `taskId` for the per-task table. Events without `taskId` are run-level and contribute to totals only.

## meta.json (optional)

```json
{
  "model": "google/gemma-4-31b-it",
  "provider": "openrouter",
  "concurrency": 6,
  "started": "2026-05-03T14:15:42Z",
  "labels": { "repo": "fitnessgrid", "purpose": "issue triage" }
}
```

Any keys are accepted. Rendered in the dashboard's run header.

## Minimal emitter (no dependency)

You don't need the `Reporter` helper — the format is trivial enough to inline. From any Node.js script:

```ts
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const runsDir = process.env.AGENT_FARM_DIR ?? './agent-runs'
const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const file = join(runsDir, runId, 'events.jsonl')
mkdirSync(join(runsDir, runId), { recursive: true })

function emit(event) {
  appendFileSync(file, JSON.stringify({ ts: Date.now(), runId, ...event }) + '\n')
}

emit({ type: 'run_start', msg: 'starting' })
emit({ type: 'task_start', taskId: 'issue-449', title: 'fix script crash' })
emit({ type: 'task_status', taskId: 'issue-449', phase: 'editing', msg: 'patching seed_training_history.py' })
emit({ type: 'task_done', taskId: 'issue-449', tokens: { input: 8200, output: 1450 } })
emit({ type: 'run_done', msg: 'done' })
```

That's the whole contract.
