# GEMINI.md — qeet-id-tanstack

**Read [AGENTS.md](AGENTS.md) first.** It is the model-neutral instruction file and the source of
truth for this repository. This file is a pointer and adds no architecture.

```text
GEMINI.md  →  AGENTS.md  →  docs/llm/*
```

## Canonical context

| File | For |
| --- | --- |
| [qeet-repo.yml](qeet-repo.yml) | Machine-readable repository identity |
| [AGENTS.md](AGENTS.md) | **Rules, commands, what CI enforces** |
| [docs/llm/context.md](docs/llm/context.md) | How this repository actually works |
| [docs/llm/boundaries.md](docs/llm/boundaries.md) | What it owns, and what it must not touch |
| [docs/llm/workflows.md](docs/llm/workflows.md) | Step-by-step for common changes |
| [docs/llm/architecture-map.md](docs/llm/architecture-map.md) | "Where is X?" — fastest path to a file |

Parent context: **L0** `qeetgroup/qeet-context` · **L1** `qeetgroup/qeet-id-context`.

## What this repository is

**Qeet ID for TanStack Start** — `@qeet-id/tanstack`. The session routes, encrypted cookie session, route
guard, middleware and server helpers for TanStack Start apps whose people sign in on Qeet ID's hosted pages.
Node.js 22.12+, bun, Biome, TypeScript 7, ES modules via tsdown.

## Non-negotiables

1. **Tokens never reach the browser.**
2. **Follow `@qeet-id/react`'s session contract exactly** (`src/contract.ts`).
3. **One renewal per refresh token** (ADR-0003).
4. **`src/index.ts` stays browser-safe.**
5. **Never weaken** a sign-in, cookie, CSRF or redirect check.

## Commands

`bun install` · `bun run verify` · `bun run build` · `bun run test` · `bun run typecheck` · `bun run check` · `bun run check:package`

That list is complete — **do not invent commands.**

## Before finishing

```bash
bun run verify
git diff
```
