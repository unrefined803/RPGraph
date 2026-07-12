# RP Storybook V2 — Concept & Plan

Status: **planning document, nothing implemented yet.**
Scope: storybook versioning + converter, character card export/import as a new
fourth file type, and an assistant logic check after character swaps.

Triggered by a user issue: after app updates, old storybook files are rejected
("Storybook Format X is incompatible") and characters embedded in them are lost
with no way to re-import them.

---

## 1. Current state (analysis)

### How storybook compatibility works today

- The single source of truth is `src/storybook/formatVersions.json`
  (currently `"storybook": "1.19.0"`), mirrored as
  `currentRpStorybookVersion` in `src/nodes/rp-storybook-v1/model.ts`.
- `electron/storybookFormat.cjs` marks a file compatible only when
  `storybook.version === currentStorybookFormatVersion` — an **exact string
  match**. Every version bump (even additive features like phone apps or
  character setup) instantly invalidates every previously saved storybook.
- The UI then shows `incompatibleStorybookStatus(...)` and refuses to load.
  There is no conversion path, so the user's report is accurate.

### The key insight

`parseRpStorybookJson` in `model.ts` is already a **tolerant normalizer**: every
section (`normalizeCharacter`, `rpStorybookCharacterBanking`,
`rpStorybookCharacterSocial`, `normalizePhoneContacts`,
`normalizeOpeningHistoryTurn`, ...) fills missing fields with defaults and drops
unknown ones. Almost every "incompatible" old storybook would parse fine today —
the exact-match gate is the only thing blocking it. The real risk cases are:

1. **Renamed/moved fields** — the normalizer silently drops the old location,
   so data would be *lost*, not migrated (this is why the exact gate exists).
2. **Semantic changes** — a field still exists but means something different.
3. **Opening history internals** — turns/checkpoints reference node types and
   snapshot shapes; old snapshots may not replay correctly.

So V2 is not "make the parser tolerant" (it already is) — it is "replace the
all-or-nothing gate with a governed upgrade path".

### Current storybook content (V1, format 1.19.0)

Top level: `format`, `version`, `title`, `introduction`,
`imageDescriptionPrompt`, `scenario` (summary / openingSituation /
currentSituation), `characters[]`, `phoneContacts.blocked[]`,
`openingHistory` (summary, turns, checkpoints, events, socialLikes, notes,
chatGpdChats).

Per character: `id`, `name`, `description`, `personality`, `speechStyle`,
`role`, `comfyConfig` (LoRA + appearance), `voiceConfig` (voice sample data
URL), `phoneSettings` (wallpaper), `banking` (start balance, fixed expenses),
`social` (Fotogram / OnlyFriends usernames), `profileImage` (+crop),
`images[]` (embedded data URLs with descriptions).

A character is therefore already a self-contained, heavy object — exactly the
unit the user wants to export/import independently.

---

## 2. Goals

1. An app update must never strand a user's storybook again. Old files stay
   loadable-in-principle and get an explicit, visible upgrade path.
2. Characters become portable: export one character (with images, voice,
   phone/banking/social setup) as its own file, import it into any storybook.
3. After a character swap the assistant can check scenario texts for
   consistency and propose fixes.
4. Conversion must work for very large files (opening history + embedded
   images) without blowing up an LLM context — AI only ever sees redacted,
   section-scoped text.

---

## 3. Versioning model for V2

Move from "exact match" to **semver-based compatibility**, aligned with the
node-version rule already in AGENTS.md:

- Bump storybook format to **`2.0.0`** ("RP Storybook V2"). Format id stays
  `rpgraph-storybook`.
- **Same major, file version ≤ app version** → loads directly. The tolerant
  parser fills new fields with defaults; on load the app shows a one-line
  notice "Storybook upgraded from 2.3.0 to 2.7.0 — save it to keep the
  upgrade." New additive features (next phone app, new character field) are
  now **patch/minor bumps and never break loading again.** This alone fixes
  90 % of the reported pain.
- **Older major (e.g. a 1.x file)** → file is recognized but flagged
  `legacy: true` instead of `compatible: false`. It is not loaded into the
  node; it enters the **Converter flow** (section 4).
- **Newer than the app** (same or higher major from a newer build) → rejected
  as today, with a "please update RPGraph" message.
- Renames/semantic changes inside 2.x are forbidden by convention; anything
  that would require one forces a major bump plus a converter mapping entry.

Electron side: `storybookMetadata()` returns
`{ compatible, legacy, formatVersion }`; the fixtures in
`check:storybook-format` (new script, mirroring the session/workflow checks)
pin this behavior.

Node versioning: `rp-storybook-v1` gets the matching minor bump so old
embedded workflow copies follow the same converter path; the node itself keeps
its name (the storybook *file* is what is versioned V2, not the node).

## 4. Converter flow (legacy files)

User-visible flow, matching the maintainer's sketch:

1. User opens/loads a 1.x storybook file. The storybook node / UI preview does
   **not** render the old content; it shows: *"This storybook uses the old
   Format 1.19.0. Convert it to Storybook V2 to use it."* plus a **Convert**
   button. Nothing is modified on disk.
2. Clicking Convert opens the **Conversion dialog** with a checklist, one row
   per section: Title & introduction / Scenario / Characters (one sub-row per
   character) / Phone contacts / Opening history / Images & voice samples.
3. Each row goes through states:
   - ⏳ pending → ✅ **mapped** (deterministic conversion succeeded)
   - 🟡 **new, empty** (field didn't exist in the old version; filled with the
     V2 default — e.g. a future Tinder-style app config)
   - 🔵 **AI repair suggested** (deterministic mapping impossible or lossy;
     user can run the repair or accept the default)
   - 🔴 **failed** (row explains what is missing; Apply stays disabled only
     for hard failures, not for empty-default rows)
4. When everything is ✅/🟡 (and optional AI repairs finished), **Apply** loads
   the converted storybook into the node and shows: *"Converted to Storybook
   V2 — save it as a new file now."* The old file is never overwritten.

### Conversion engine (two stages, as sketched by the maintainer)

**Stage 1 — deterministic remap (no AI, no network):**
A pure function `convertStorybookV1ToV2(old: unknown): ConversionResult` in a
new `src/storybook/convert/` module. It reuses the existing V1 normalizer to
read the old file, then maps field-by-field into the V2 shape. A small
versioned mapping table records known renames from released versions. Images,
voice samples, and profile images are **copied byte-identical and never touch
the AI**. Output: the converted storybook + a per-section report feeding the
checklist (`mapped` / `defaulted` / `needsAi` / `failed`, with messages).

**Stage 2 — AI repair (optional, per section):**
For `needsAi` rows only. Reuses the existing assistant machinery
(`rpStorybookEditPrompt` + `parseRpStorybookAssistantResult` with RFC 6902
JSON Patch), but with **section-scoped context**:

- The prompt JSON is built from the converted storybook with data URLs
  replaced by `<image:id>` placeholders (same idea as
  `npm run workflow:redact` / the new `npm run storybook:redact`) and with
  sections outside the current row removed or summarized.
- Opening history is the size problem (an imported session can exceed any
  context window). Default: AI never sees the turns, only
  `openingHistory.summary` plus counts. The dialog offers toggles ("include
  opening history", "include checkpoints") for the rare repair that needs
  them, chunked turn-by-turn if enabled.
- Every AI result is applied as a patch to the converted draft and re-runs the
  normal validation before its row turns green.

### What conversion cannot promise

Old opening-history **checkpoints** snapshot node state from old node
versions. The converter keeps turns (the readable story) but marks
checkpoints from a different major as non-restorable and drops them with a
notice in the checklist. Documented, not silent.

---

## 5. Character Card — the fourth file type

New file format alongside RP Save / Workflow / Storybook:

- Format id: `rpgraph-character`, extension `*.rpgraph-character.json`,
  own version file entry in `formatVersions.json`
  (`"characterCard": "1.0.0"`, plus `"encryptedCharacterCardEnvelope"` for
  parity with the other encrypted formats).
- Content = the full `RpStorybookV1Character` (V2 shape): identity texts,
  `comfyConfig`, `voiceConfig` (embedded voice sample), `phoneSettings`,
  `banking`, `social`, `profileImage`, `images[]` with descriptions.
- **Not** included: opening-history data (notes, ChatGPD chats, social likes,
  blocked contacts). Those are story state, not character identity — they
  reference other characters and turns and cannot travel alone. The card may
  carry an optional free-text `importNotes` field instead.

**Export:** per-character "Export Character" action in the storybook character
editor → writes the card file (plain or encrypted, like the other formats).

**Import:** "Import Character" in the storybook node:

- New `id` collision → images re-namespaced via the existing
  `nextStorybookCharacterImageId` machinery; character id gets a suffix if
  taken.
- Same `name` already present → ask: replace that character or add as new.
- Replacing a character while a story is running currently trips the
  identity-lock (`rpStorybookIdentityLockViolations`) — the import dialog must
  explain this and offer the logic check (section 6) instead of failing
  silently.
- SillyTavern import stays as-is (AI-based); character cards are the exact,
  lossless path.

## 6. Assistant logic check after character swaps

When a character is imported/replaced (or removed), the scenario texts
(`scenario.summary`, `openingSituation`, `currentSituation`, `introduction`,
event details) still talk about the old cast.

- New assistant action **"Check story logic"**, auto-offered after an import
  that changed the cast (and manually available in the storybook assistant).
- Prompt: redacted storybook (no data URLs, opening history summarized) + the
  diff "removed characters X, added Y" → returns the standard assistant JSON
  Patch with proposed rewrites of the inconsistent fields plus a plain-language
  reply listing what it found.
- User reviews the reply; patches go through the normal
  `commitStorybookToNode` path (identity lock still applies while a story
  runs).

## 7. Implementation stages

1. **Versioning + gate** — semver compatibility in `storybookFormat.cjs`,
   `legacy` flag, format bump to 2.0.0, new `check:storybook-format` fixtures,
   load-time "upgraded, please save" notice. *(Smallest step, fixes future
   breakage forever.)*
2. **Converter, deterministic stage** — `src/storybook/convert/` module +
   conversion dialog with checklist; V1→V2 mapping table.
3. **Converter, AI repair stage** — redacted section-scoped prompts, opening
   history toggles/chunking.
4. **Character card format** — new file type end to end (electron format
   module, save/load IPC, export/import UI, collision handling).
5. **Logic check assistant action.**
6. Docs: OVERVIEW.md file-format section, CODEREVIEW.md entries if debt
   surfaces; update `workflow.default*.json` to the V2 storybook shape.

## 8. Open questions for the maintainer

1. Should the very first V2 release still auto-load 1.19.0 files *directly*
   (they parse cleanly today) and reserve the converter dialog for genuinely
   older/unknown 1.x versions? That would make the upgrade invisible for
   current users.
2. Encrypted legacy files: converting requires the password first — unlock
   then convert in one flow, or require the user to re-save unencrypted first?
3. Character card: should the voice sample (can be large) be optional at
   export ("include voice sample" checkbox)?
4. Which sections should the AI repair be allowed to touch at all? Proposal:
   text fields only, never images/voice/banking numbers.

---

*Reference file for structure analysis: `SaveStorybook_V11.rpgraph-storybook.json`
(exported current V1/1.19.0 storybook, ~3.2 MB with embedded images). Note: it
contains personal story content and should probably not be committed —
consider adding `*.rpgraph-storybook.json` to `.gitignore`.*
