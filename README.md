# RWE — RP Web Engine

A browser-based roleplay engine. Bring your own model, import character cards,
and play. Everything lives in your browser: there is no account, no server-side
storage, and no telemetry.

RWE covers the same ground as SillyTavern, but leans on a different idea — a
**multi-agent World Model** that maintains an explicit story state between turns
instead of asking one model to remember everything from the transcript.

## Status

Pre-1.0. The storage format is versioned and migrated on load, but expect rough
edges. Back up from **My Chats → Export** before upgrading.

## What's in the box

**The World Model pipeline.** Rather than one prompt per turn, a turn is routed
through a small graph of agents:

| Phase | Agents | Runs |
| --- | --- | --- |
| `setup` | Universe Detector → Plotter → Lore / Roster / Locations | once per chat, builds the Story Bible |
| `routing` | Turn Router | every turn — decides which of the below to skip |
| `pre-turn` | World Curator | updates the world snapshot |
| `per-actor` | Character Candidate (one per active character, in parallel) | asks each NPC what they'd do |
| `synthesis` | Game Master | writes the reply the player actually reads |

The Story Bible, the world snapshot, and per-character state are inspectable and
editable in the UI (Story Bible, World State, Character Tracker). The router
exists because the full pipeline is expensive: trivial turns skip most of it.

Prefer the classic single-prompt setup? Turn the World Model off and RWE behaves
like a conventional frontend.

**Providers.** Two paths, switchable per chat:

- **Gemini** — Google AI Studio keys, native `@google/genai` SDK, thinking-level
  control, and per-key tier tracking (a billed key can request Google's cheaper
  Flex service tier).
- **Proxy** — any OpenAI-compatible `/chat/completions` endpoint: OpenRouter,
  the Vercel AI Gateway, community routers, or a local LM Studio / llama.cpp /
  Ollama server.

The **Preset Builder** (API Settings → Builder) assembles a preset from a model
block and a prompt block, so you can go from "I want to try this model" to a
working preset without hand-writing JSON. Blocks carry endpoints only — you
supply the key.

**Prompt construction is cache-aware.** The system prompt, character card, and
history are ordered so a provider's prefix cache stays valid across turns;
volatile pieces (player notes, keyword-triggered World Info, active scenarios)
are appended to the tail rather than spliced into the middle. The test suite
pins this ordering — see `tests/cache/`.

**Character cards.** Import and export the de-facto standard PNG card (spec
V1/V2/V3, the `chara` / `ccv3` tEXt chunk) plus plain-JSON cards, so cards move
freely between RWE, SillyTavern, chub.ai, and JanitorAI. `character_book`
entries become keyword-triggered World Info.

**Manual scenarios.** Story hooks you toggle on and off per chat — unlike World
Info they never fire on their own, and because they sit in the prompt tail,
flipping one costs a single re-cache rather than invalidating the whole history.
Author them in the app, or declare them per character in
`manualScenarioCatalog.ts` to keep them in version control; **Resync** then pulls
new ones into a chat and restores any that drifted. The catalog ships empty.

**Also:** branching chat trees with per-node regeneration, personas, keyword
World Info with configurable scan depth, inline images, a request log viewer,
themes, and per-chat generation settings.

## Getting started

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000, go to **API Settings**, and paste a key for whichever
provider you want. Then import a character card — the `cards/` directory has a
starter set, or grab any card from the wider ecosystem.

To pre-fill keys instead of pasting them into each browser, copy `.env.example`
to `.env.local`. This is optional; nothing is required to run.

## Bringing characters

RWE ships with an empty roster on purpose — it is an engine, not a content pack.

- **Import**: character selection page → **Import**, and pick a `.png` or `.json`
  card. `cards/` contains a set of ready-made cards to get started.
- **Export**: any character's detail page exports it back out as a PNG card,
  including a lossless RWE payload (alternate greetings, settings, lore book)
  under `data.extensions.rwe` that other frontends simply ignore.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 3000, with the API proxy middleware |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest suite |

## Deploying

The repo is Vercel-shaped: `api/proxy/chat.ts` is a Node serverless function
that forwards browser requests to providers that don't send CORS headers. It is
**not** an open relay — it only forwards to an allowlist of known gateways. To
reach your own inference server through it, set `PROXY_ALLOWED_HOSTS` on the
deployment (see `.env.example`).

Any static host works too, as long as you either supply that proxy or use
providers that are reachable directly from the browser.

## A note on keys

Keys entered in the UI are stored in your browser's `localStorage` and sent only
to the provider you configured. Keys supplied through `VITE_*` variables are
compiled into the bundle and readable by anyone who can open the page — use
those only for deployments where that is acceptable.

## Content

RWE is an uncensored roleplay engine: the built-in prompt templates instruct
models to write adult fiction, and several of them are explicitly jailbreak-shaped.
It is intended for adults writing fiction with models they have the right to use.
Whatever you generate is between you and your provider — check their terms.

## License

MIT — see [LICENSE](LICENSE).
