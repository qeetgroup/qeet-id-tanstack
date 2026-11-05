# CLAUDE.md — qeet-id-tanstack

**Read [AGENTS.md](AGENTS.md) first.** It is the model-neutral instruction file and the source of
truth for this repository. This file adds only Claude-specific guidance.

```text
CLAUDE.md  →  AGENTS.md  →  docs/llm/*
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

## The things most likely to trip you up here

1. **Tokens never reach the browser**, not even inside a server function's result.
2. **The contract is `@qeet-id/react`'s.** Import it only through `src/contract.ts`; change it there first.
3. **One renewal per refresh token** (ADR-0003): Qeet ID ends the grant when a spent one comes back.
4. **Browser-safe entry.** `src/index.ts` reaches server code only through dynamic imports inside server
   bodies the Start compiler strips.
5. **Never weaken** state, `iss`, PKCE, ID token, CSRF, `safeReturnTo`, cookie or `no-store` checks.

## Working style

- **Read before editing.** Match the neighbouring module rather than introducing an abstraction.
- Use the architecture map instead of guessing a path.
- **Do not read `.env*` or secret files** into anything you write.

## Finishing a change

```bash
bun run verify
git diff
```

## Escalate rather than proceed

Stop and report if a task would weaken a security control, change the session contract, change the cookie
format, or require modifying another repository.
