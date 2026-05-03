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

## Layout

```
skills/
  <skill-name>/
    SKILL.md
```

Standard `npx skills` / [skills.sh](https://skills.sh) layout — one directory per skill, each with a `SKILL.md` carrying YAML frontmatter (`name`, `description`).

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
