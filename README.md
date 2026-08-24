# RWE — RP Web Engine

A browser-based roleplay engine. Bring your own model, import character cards,
and play. Everything lives in your browser: there is no account, no server-side
storage, and no telemetry.

## Status

Pre-1.0. The storage format is versioned and migrated on load, but expect rough
edges. Back up from **My Chats → Export** before upgrading.

## What's in the box

**Providers.** Two paths, switchable per chat:

- **Gemini** — Google AI Studio keys, native `@google/genai` SDK, thinking-level
  control, and per-key tier tracking (a billed key can request Google's cheaper
  Flex service tier).
- **Proxy** — any OpenAI-compatible `/chat/completions` endpoint: OpenRouter or any local server.

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

RWE starts empty, you can create a character:

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

## A note on keys

Keys entered in the UI are stored in your browser's `localStorage` and sent only
to the provider you configured. Keys supplied through `VITE_*` variables are
compiled into the bundle and readable by anyone who can open the page — use
those only for deployments where that is acceptable.

## Contributing

This project will improve in future. Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) has the
setup and, more usefully, the few invariants that are easy to break by accident
— chiefly that prompt ordering is what keeps provider caching alive, and that
the two provider paths have to stay in step.

For feature requests, describing the story problem beats describing the
solution. Security issues go through [SECURITY.md](SECURITY.md) rather than a
public issue.

## License

MIT — see [LICENSE](LICENSE).
