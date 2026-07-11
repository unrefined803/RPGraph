# RPgraph Code Review — To-Do List

Findings from the multi-agent security/quality review. Each item has a checkbox,
a short effort estimate (how complex the change is) and a scope estimate (how much
code has to be searched/understood — "token cost" of the investigation).

Legend: `[ ]` open · `[✅]` done (add date + short note when closing).

---

## High priority

- [✅] **1. Custom Nodes can escape their security boundary** (2026-07-11)
  Custom Node code no longer runs in the app window. It now executes in a Web
  Worker inside a sandboxed iframe (opaque origin, deny-all CSP), with no file,
  network, storage, or Electron access; the only channel is postMessage for
  inputs, LLM proxy calls, and the result (`src/nodes/custom-node/sandbox.ts`).
  The blocklist scan remains as an extra lint layer, and a 30s compute watchdog
  (paused during LLM calls) stops runaway code.
  - Files: `src/nodes/custom-node/runtime.ts:108`, `electron/preload.cjs:146`
  - Imported JavaScript is guarded only by an easily bypassed blocklist. A crafted
    workflow could, while a Custom Node runs, reach stored files, decrypted API
    keys and network functions.
  - Recommendation: do not execute imported custom code directly in the UI; run it
    in a real isolated environment without file, network and Electron access. Until
    then, do not run foreign workflows that contain Custom Nodes.
  - Effort: **High** (proper fix = new isolation runtime). Quick partial mitigation
    possible but not fully safe.
  - Scope: **Medium** — runtime.ts + preload surface + call sites of Custom Node run.

- [✅] **2. A corrupted workflow can wipe the current session** (2026-07-11)
  Workflow loading is now split into a validation step (`prepareLoadedWorkflow`,
  may throw) and a commit step (`commitHydratedWorkflow`, mutates state). Opening
  a workflow hydrates and validates the file first; `clearCurrentSession()` and
  all other state changes only run after validation succeeded, so a corrupted
  file leaves the running session untouched. The session-load path prepares its
  embedded workflow and session state the same way before committing.
  - Files: `src/App.tsx:2650`, `src/app/workflowHydration.ts:48`
  - On open the running session is cleared before the new workflow is fully
    validated. If validation then fails, unsaved progress can be lost.
  - Effort: **Medium** — reorder load/validate/commit flow.
  - Scope: **Medium** — App.tsx open handler + workflowHydration.

- [ ] **3. Corrupted sessions can leave a mixed state**
  - Files: `src/data-management/validation.ts:265`, `src/data-management/sessionStore.ts:245`, `src/App.tsx:2770`
  - Several required session parts are not validated. The workflow may already be
    applied before a later error, leaving a new workflow with old or partially
    loaded session data.
  - Recommendation: strictly validate all session areas and commit the whole session
    only after fully successful preparation.
  - Effort: **Medium–High** — validation hardening + atomic commit.
  - Scope: **Medium** — validation.ts, sessionStore.ts, App.tsx load path.

## Medium priority

- [✅] **4. Tampered RP saves can load external images** (2026-07-11)
  Session validation (the single load-time gate in `isRpgraphSessionV2`) now
  requires `data:image/` URLs for every entry in `entities.images` and
  `data:audio/` URLs for timeline voice clips, so foreign sessions with external
  media addresses are rejected before anything is displayed. Storybook images
  and voice samples were already scheme-checked in the storybook model. New
  negative fixtures cover both cases.
  - Files: `src/data-management/validation.ts:265`, `src/components/ChatConversationPanel.tsx:1459`
  - Image addresses from a session are not sufficiently checked; a foreign session
    could call an external address on display and leak IP, time and a unique marker.
  - Effort: **Low** — restrict allowed image URL schemes.
  - Scope: **Small** — validation + render site.

- [✅] **5. Provider responses have no size limit** (2026-07-11)
  - Fixed: all provider response readers (collected and streamed SSE/audio
    paths) now go through a shared 512 MB guard that destroys the stream and
    fails the request when a response grows past the limit.

- [ ] **6. Corrupted storybooks are silently altered**
  - Files: `src/nodes/rp-storybook-v1/model.ts:646`, `src/storybook/useStorybookActions.ts:231`
  - Faulty characters, images or opening-history entries are partly removed or
    emptied; the next save can overwrite the original data with this reduced version.
  - Effort: **Medium** — validate-or-refuse instead of coerce.
  - Scope: **Medium** — storybook model + actions.

- [✅] **7. New files are not written crash-safely** (2026-07-11)
  - Fixed: first saves now also use write-to-temp-then-rename via a new
    `writeNewTextFileAtomically` helper that still reports name conflicts.

- [ ] **8. The large main bundle is hidden by the warning threshold**
  - File: `vite.config.ts:8`
  - Main chunk ~2.1 MB (~985 KB gzipped). Warning limit raised to 3 MB, so the build
    stays silent. Can slow startup on weaker machines.
  - Effort: **Medium** — code-splitting / lazy loading.
  - Scope: **Medium** — bundle analysis + import boundaries.

## Low priority

- [✅] **9. Launchers do not detect outdated packages** (2026-07-11)
  - Fixed: installs now store a lockfile snapshot in `node_modules`; launchers
    compare it against `package-lock.json` and reinstall when it differs.

- [✅] **10. Launchers use `npm install` instead of `npm ci`** (2026-07-11)
  - Fixed: both launchers now run `npm ci` for the dependency install paths.

- [✅] **11. README version is outdated** (2026-07-11)
  - Fixed: README beta notice now shows `v0.4.6`.

---

## Passed checks

Production build · ESLint · unused-code · session-format · workflow-format ·
workflow-fixtures · dependency structure · `npm audit` (0 vulnerabilities, 358 deps).

Positives: file encryption, basic path-traversal protection, Electron isolation
(contextIsolation on, nodeIntegration off), no checked-in credentials.
