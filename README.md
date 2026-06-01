# skills

Agent Skills published by [@pjankiewicz](https://github.com/pjankiewicz). Drop-in references for AI coding agents (Claude Code, Cursor, Copilot CLI, Codex, Cline) following the open [Agent Skills](https://skills.sh) format.

## Skills in this repo

### `open-multi-agent`

A skill for [`@jackchen_me/open-multi-agent`](https://github.com/JackChen-me/open-multi-agent) — the TypeScript-native multi-agent orchestration framework that turns a goal into a task DAG. Teaches the agent which of the three execution modes to pick (`runAgent` / `runTeam` / `runTasks`), which built-in tools to attach, how to wire MCP servers, how to use Zod-validated structured output, how to mix providers in one team, and which production controls actually matter.

```bash
npx skills add pjankiewicz/skills@open-multi-agent
```

To install every skill in this repo at once:

```bash
npx skills add pjankiewicz/skills
```

Browse the directory at [skills.sh](https://skills.sh).

### `ux-review`

A per-screen, PASS/FAIL heuristic rubric (~55 criteria across 9 sections) for auditing the **interaction quality** of a mobile (iOS/Android) or web UI — pressed/focus/disabled states, empty/loading/error states, touch targets, platform conventions (Apple HIG / Material 3), WCAG 2.2 AA contrast, system-status feedback, and honest copy. Hunts *works-but-feels-wrong*.

```bash
npx skills add pjankiewicz/skills@ux-review
```

### `app-bug-sweep`

A fan-out methodology for finding the defects that *ship* — the integration gaps a compiler and unit tests never catch: dead/no-op controls, capability built on the backend but never wired to a screen, inert gestures, silent data-loss footguns, and dead settings / fake data / cross-platform decode-parity gaps. Runs as parallel read-only scans, one per failure class, with a suppression list so each reports only net-new findings. Pairs with `ux-review` (one hunts *broken*, the other *feels-wrong*).

```bash
npx skills add pjankiewicz/skills@app-bug-sweep
```

## What the open-multi-agent skill covers

- **Three run modes** — `runAgent` (single), `runTeam` (goal-driven coordinator), `runTasks` (explicit DAG).
- **Tool wiring** — built-in tool presets, custom tools via `defineTool` + Zod, opt-in `delegate_to_agent`.
- **MCP** — `connectMCPTools` from the `@jackchen_me/open-multi-agent/mcp` subpath.
- **Providers** — Anthropic, OpenAI, Azure, Gemini, Grok, DeepSeek, MiniMax, Qiniu, Copilot natively; Ollama / vLLM / LM Studio / OpenRouter / Groq via OpenAI-compatible `baseURL`.
- **Structured output** — `outputSchema` (Zod) on `AgentConfig` → `result.structured`.
- **Observability** — `onProgress` events, `onTrace` spans, `renderTeamRunDashboard` static HTML.
- **Production controls** — `maxTurns`, `maxTokenBudget`, `timeoutMs`, `contextStrategy`, `loopDetection`, `compressToolResults`, task retries, delegation depth caps, `onApproval` gate.
- **Common pitfalls** — ESM-only, Ollama placeholder API key, local-server tool-call streaming quirks, peer-dep loading.

Skills are read on demand by the agent — they do not run code, install dependencies, or modify your project.

## Tools shipped alongside

### `agent-farm/`

A small, generic live dashboard for multi-agent runs. Watches a runs directory and renders any agent activity that follows the [agent-farm event format](./agent-farm/EVENTS.md). Intentionally domain-agnostic — anything that emits well-formed JSONL with a `taskId` shows up. Pairs well with the `open-multi-agent` skill but doesn't depend on it.

See [`agent-farm/README.md`](./agent-farm/README.md) for usage. Install / run from the repo:

```bash
cd agent-farm && npm install && npm run dev
# dashboard at http://localhost:5180/, watching ./agent-runs/ by default
```

## Layout

```
skills/
  <skill-name>/
    SKILL.md           # the skill itself
agent-farm/             # optional sidekick dashboard for multi-agent runs
```

Standard `npx skills` / [skills.sh](https://skills.sh) skill layout — one directory per skill under `skills/`, each with a `SKILL.md` carrying YAML frontmatter (`name`, `description`).

## Compatibility

- Claude Code (`~/.claude/skills/`)
- Cursor, VS Code, GitHub Copilot, Cline, Codex, and any other agent that consumes the open Agent Skills format.

## Source of truth

The `open-multi-agent` skill summarises the public API of `@jackchen_me/open-multi-agent` as of the version pinned at publish. For exact current signatures and edge cases, the upstream sources of truth are:

- Repo: <https://github.com/JackChen-me/open-multi-agent>
- npm: `@jackchen_me/open-multi-agent`
- CLI docs: [`docs/cli.md`](https://github.com/JackChen-me/open-multi-agent/blob/main/docs/cli.md)
- Shared memory: [`docs/shared-memory.md`](https://github.com/JackChen-me/open-multi-agent/blob/main/docs/shared-memory.md)
- Context strategies: [`docs/context-management.md`](https://github.com/JackChen-me/open-multi-agent/blob/main/docs/context-management.md)

If something here drifts from the upstream API, file an issue or open a PR.

## License

[MIT](./LICENSE). Skills here describe third-party packages; those packages remain the property of their authors.

## Not affiliated

These are independent community skills. They are not maintained by, endorsed by, or otherwise affiliated with the upstream projects they document.
