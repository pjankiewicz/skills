import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Tokens {
  readonly input: number
  readonly output: number
}

export interface BaseEvent {
  readonly type: 'run_start' | 'run_done' | 'task_start' | 'task_status' | 'task_done' | 'task_failed' | 'log'
  readonly taskId?: string
  readonly title?: string
  readonly phase?: string
  readonly msg?: string
  readonly tokens?: Tokens
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ReporterOptions {
  /** Directory holding all runs. Default: `process.env.AGENT_FARM_DIR ?? './agent-runs'`. */
  readonly dir?: string
  /** Stable run identifier. Default: ISO timestamp with ":" and "." replaced. */
  readonly runId?: string
  /** Optional run-level metadata written to `meta.json`. */
  readonly meta?: Readonly<Record<string, unknown>>
  /** Mirror every emitted event to stdout. Default: `true`. */
  readonly echo?: boolean
}

/**
 * Tiny append-only writer for the agent-farm event format.
 *
 * Drop-in for any open-multi-agent (or other) pipeline that wants to surface
 * progress on the agent-farm dashboard. The whole API is `start()`,
 * `event()`, and a few convenience wrappers.
 *
 * Usage:
 *   const r = new Reporter({ meta: { model: 'gemma-4-31b-it' } })
 *   r.start()
 *   r.taskStart({ taskId: 'issue-449', title: 'fix script crash' })
 *   r.taskStatus({ taskId: 'issue-449', phase: 'editing', msg: 'patch applied' })
 *   r.taskDone({ taskId: 'issue-449', tokens: { input: 8200, output: 1450 } })
 *   r.done()
 */
export class Reporter {
  readonly runId: string
  readonly runDir: string
  readonly eventsFile: string
  private readonly echo: boolean

  constructor(options: ReporterOptions = {}) {
    const baseDir = options.dir ?? process.env.AGENT_FARM_DIR ?? './agent-runs'
    this.runId = options.runId ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    this.runDir = join(baseDir, this.runId)
    this.eventsFile = join(this.runDir, 'events.jsonl')
    this.echo = options.echo ?? true

    mkdirSync(this.runDir, { recursive: true })
    if (options.meta) {
      writeFileSync(join(this.runDir, 'meta.json'), JSON.stringify(options.meta, null, 2))
    }
  }

  // ---- low-level --------------------------------------------------------

  event(event: BaseEvent): void {
    const line = JSON.stringify({ ts: Date.now(), runId: this.runId, ...event })
    appendFileSync(this.eventsFile, line + '\n')
    if (this.echo) {
      const tag = event.taskId ?? event.type
      process.stdout.write(`[${tag}] ${event.msg ?? event.phase ?? event.type}\n`)
    }
  }

  // ---- convenience ------------------------------------------------------

  start(msg = 'started'): void {
    this.event({ type: 'run_start', msg })
  }

  done(opts: { msg?: string; tokens?: Tokens } = {}): void {
    this.event({ type: 'run_done', msg: opts.msg ?? 'done', tokens: opts.tokens })
  }

  log(msg: string): void {
    this.event({ type: 'log', msg })
  }

  taskStart(opts: { taskId: string; title?: string; metadata?: Record<string, unknown> }): void {
    this.event({ type: 'task_start', taskId: opts.taskId, title: opts.title, metadata: opts.metadata })
  }

  taskStatus(opts: { taskId: string; phase: string; msg: string }): void {
    this.event({ type: 'task_status', taskId: opts.taskId, phase: opts.phase, msg: opts.msg })
  }

  taskDone(opts: { taskId: string; msg?: string; tokens?: Tokens }): void {
    this.event({ type: 'task_done', taskId: opts.taskId, msg: opts.msg, tokens: opts.tokens })
  }

  taskFailed(opts: { taskId: string; msg: string }): void {
    this.event({ type: 'task_failed', taskId: opts.taskId, msg: opts.msg })
  }
}
