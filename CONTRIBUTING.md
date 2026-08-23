# Contributing

Bug reports, feature requests, and pull requests are all welcome. This file
covers the setup and — more usefully — the handful of invariants that are easy
to break by accident.

## Setup

```bash
npm install
```

```bash
npm run dev
```

The dev server runs on port 3000 and includes the `/api/proxy/chat` middleware,
so proxy providers work locally exactly as they do in production.

No key is needed to boot the app. Add one under **API Settings** to actually
generate, or copy `.env.example` to `.env.local` to pre-fill it.

> **Note:** the repo carries both `package-lock.json` and `yarn.lock`. CI
> installs with `npm ci`, so `package-lock.json` is the one that decides what
> gets tested. Use npm unless you have a reason not to.

## Before you open a PR

```bash
npm run typecheck && npm test && npm run build
```

CI runs exactly these on Node 20.19 and 22, plus a scan for credential-shaped
strings. All of it must pass.

## How the code is laid out

| Path | What lives there |
| --- | --- |
| `services/common/` | Everything provider-agnostic: prompt assembly, history windowing, World Info, caching, character cards |
| `services/gemini/` | The `@google/genai` path — client, config, gameplay, presets, prompts |
| `services/proxy/` | The OpenAI-compatible path — same shape, plus `proxyHelper.ts` |
| `services/geminiService.ts`, `services/proxyService.ts` | Thin façades re-exporting each path |
| `store/` | Redux Toolkit slices and thunks; `store/thunks/gameplayThunks.ts` drives a turn |
| `presets.ts` | The World Model agent graph |
| `builderBlocks.ts` | The Preset Builder catalog (endpoints and prompts, never keys) |
| `api/proxy/chat.ts` | Serverless CORS proxy with a host allowlist |
| `tests/cache/` | The prompt-construction test suite |

## Invariants

These are the things a PR gets sent back for.

### 1. No credentials, ever

The engine ships with zero keys. They come from the UI (browser `localStorage`)
or from `VITE_*` variables read in `constants.ts`. Never hardcode one, not even
a free-tier or throwaway key, and not in a comment or a test fixture. CI fails
the build if it finds one.

### 2. No built-in content

The character roster and persona list start empty and stay that way. Sample
characters belong in `cards/` as importable PNG cards, never wired into the app
as defaults. Same for manual scenarios: `manualScenarioCatalog.ts` ships empty
and is a hook for users, not a place to add content.

Real names, personal descriptions, and personal roleplay text don't belong in
prompts, defaults, or test fixtures either.

### 3. Prompt ordering is load-bearing

Providers cache on a prompt *prefix*. RWE is built so that prefix stays byte-
identical across turns: the system prompt, character card, and history are
stable, and everything volatile — player notes, keyword-triggered World Info,
active manual scenarios — is appended to the tail instead of spliced into the
middle.

Moving something from the tail into the stable region silently doubles a user's
cost, because every turn re-processes the whole prompt. `tests/cache/` pins this
ordering; if a change there makes a test fail, that failure is the point. Fix
the change, not the test — or, if the reordering is genuinely correct, say why
in the PR.

### 4. The two provider paths stay in sync

`services/gemini/` and `services/proxy/` mirror each other. A change to how
prompts are built, how history is windowed, or how agents are invoked usually
needs to land in both, or move into `services/common/` so there is only one copy.
A fix applied to one path and not the other is the most common source of "works
on Gemini, broken on OpenRouter" reports.

### 5. Storage is versioned

Anything persisted goes through `services/storage.ts`. Changing a stored shape
means adding a migration there — users must not lose chats on upgrade.

## Style

Match the file you're editing. The codebase leans on short comments that explain
*why* a non-obvious thing is the way it is, rather than restating the code —
please keep that up, especially around caching and prompt assembly.

## Feature requests

Open an issue and describe the problem before the solution: what you were trying
to do in a story, and where the engine got in the way. That framing tends to
produce a better feature than a spec does.
