import { defineConfig } from '@playwright/test';

// End-to-end suite that launches the real Electron app (Playwright's `_electron`
// support) against the built `dist/`. Run manually with `npm run test:e2e` after
// `npm run build` — it is intentionally NOT part of the pre-push gate (it needs a
// build + a display and is heavier than the Vitest unit suite).
//
// Kept disjoint from Vitest by path + extension: Vitest owns `src/**/*.test.ts` and
// `electron/**/*.test.ts`; Playwright owns `e2e/**/*.spec.ts`.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Each spec launches its own Electron instance in a throwaway profile; keep serial
  // to avoid profile/instance contention.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
});
