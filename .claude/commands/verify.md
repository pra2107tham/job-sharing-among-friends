---
description: Full verification — typecheck, lint, RLS suite, and a real bundle on all three platforms
---

Run the complete check and report each result honestly, including anything that fails.

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm db:test
cd apps/mobile && npx expo export --platform web && npx expo export --platform ios --platform android
```

Notes:

- `expo export` is the step that matters most. `tsc` does not catch module resolution or
  babel failures, and this repo uses pnpm's isolated linker, where a package the bundler
  reaches for transitively must still be a declared dependency of `apps/mobile`.
- If a bundle fails with "Unable to resolve module X", add X to `apps/mobile/package.json`
  at the version listed in `node_modules/expo/bundledNativeModules.json`. Do not change
  the pnpm linker — `.npmrc` explains why.
- Clean up `apps/mobile/dist/` afterwards; it is gitignored but large.

Report a short table of pass/fail per step. Do not describe a step as passing unless you
ran it and saw it pass.
