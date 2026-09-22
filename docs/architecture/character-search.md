# Character search action

`Get character list` (`getCharacterList`, LLM request `get_character_list`) uses a dedicated character-selection assistant. It does not use criteria scoring or return JSON profiles. The phone image search action keeps its existing implementation.

Bundled normal and planning v34 workflows enable character discovery in output channel 0 for RP Prompt Normal, RP AutoTurn, RP Narrator, and RP Narrator AutoTurn. Planning workflows expose the answer to planning and main passes. Event, WhatsUp, Social Media, and Autoplay slots do not enable it.

## Execution

1. An authored `@action:Get character list` marker inserts a hint requesting `{"action":"get_character_list","plan":"..."}`. The plan is a self-contained request: desired people, scene facts, app/account requirements, relationships, number of results, and information needed. Necessary context must be included because the assistant does not receive history.
2. `runCharacterSearch` inside `runActionAwarePrompt` makes a separate, non-streamed LLM request using the calling node's connection. Its prompt consists only of the configured assistant instructions, the request, and the directory of all effective characters. It receives no story instructions, raw user input, conversation history, prior action results, or images. Prompt Route and prompt logs retain the assistant instructions and request but replace the directory with the character count and its estimated token size, measured with the run’s TextMetricsApi settings. The request carries this diagnostic representation separately for Turn Trace capture and export; provider dispatch and token calibration still use the complete prompt. No automatic context splitting is performed.
3. The assistant compares the request with the authored data and answers in prose, about 50–100 words total, with at most three fitting characters. These are prompt-level output limits. The answer includes only relevant facts, exact names and applicable account identifiers, a brief reason, and uncertainty where needed. It reports no match or fewer matches rather than inventing characters or relationships. There is no second parameter JSON or deterministic ranking step.
4. The answer insertion template wraps this text, which replaces the action marker on replay. The full directory is never inserted into the planning or main story pass. Empty assistant responses report a warning rather than exposing the request as story output.

## Directory data

`characterSearchDirectory` in `src/characters/search.ts` reads `ExecuteContext.appCharacters`, the effective registry including Storybook characters, library NPCs and saved overrides. If this projection is unavailable, it reads Storybook nodes. It formats a text directory containing:

- Character ID, name, authored age/gender, description, personality, speech style, role, hidden agency, agency tags and meanings.
- Enabled accounts with exact account IDs, profile names, roles, bios, account tags, social privacy mode and post counts. Counts include seeded and live posts, resolved by owner, without copying post content.
- Authored outgoing relationships with target names/IDs, relationship descriptions and app contact/follow flags. Missing or one-sided data never proves mutual friendship.

No image blobs, complete containers, banking data, or chat text are serialized. Hidden agency and anonymous identities are author context, not public character knowledge. The assistant treats directory content as data rather than instructions.

## Configuration and compatibility

The action editor labels are **Character Search Assistant Prompt** and **Assistant Answer Insertion Template**. The first-pass hint stays read-only. Assistant variables are `{{plan}}` and `{{characterDirectory}}`; insertion uses `{{answer}}`. Missing placeholders append the required request, directory, or answer. Substitution is single-pass so data containing template tokens cannot expand further content.

The previous maximum-results setting is removed; the assistant prompt specifies at most three characters. Stored default ranking instructions and result templates migrate to the new defaults, while custom templates remain editable. Legacy query-only calls are no longer executable.

Validation: `src/nodes/shared/promptActions.characterList.test.ts` covers directory fields, post ownership, template migration, relationship context, prompt isolation, prose replay in planning and main output, no matches and empty responses. Existing phone-image action tests cover the unchanged image path.
