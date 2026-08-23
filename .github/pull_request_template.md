## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem it solves. For a behaviour change, what it looked like before. -->

## Checks

- [ ] `npm run typecheck && npm test && npm run build` passes
- [ ] No API key, personal name, or personal roleplay text added anywhere — including comments and test fixtures
- [ ] No character, persona, or manual scenario wired in as a built-in default

## If this touches prompt assembly

- [ ] Nothing volatile moved into the cached prefix (see CONTRIBUTING.md → *Prompt ordering is load-bearing*)
- [ ] The change landed on **both** provider paths, or lives in `services/common/`
- [ ] `tests/cache/` still passes — or the PR explains why the reordering is correct

## If this changes stored data

- [ ] A migration was added in `services/storage.ts`, and existing chats survive an upgrade
