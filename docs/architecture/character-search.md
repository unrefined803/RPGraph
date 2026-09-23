# Character information action

`Ask character information` (`getCharacterList`, LLM request `ask_character_information`) uses a dedicated assistant for questions about known characters, accounts, relationships, and suitable people. It does not use criteria scoring or return JSON profiles. The phone image action uses the related plan-driven assistant described below.

Bundled normal and planning v34 workflows enable character discovery in output channel 0 for RP Prompt Normal, RP AutoTurn, RP Narrator, and RP Narrator AutoTurn. Planning workflows expose the answer to planning and main passes. Event, WhatsUp, Social Media, and Autoplay slots do not enable it.

## Execution

1. An authored `@action:Ask character information` marker inserts a hint requesting `{"action":"ask_character_information","plan":"..."}`. The plan is a self-contained request: desired people, scene facts, app/account requirements, relationships, number of results, and information needed. Necessary context must be included because the assistant does not receive history.
2. `runCharacterSearch` inside `runActionAwarePrompt` makes a separate, non-streamed LLM request using the calling node's connection. Its prompt consists only of the configured assistant instructions, the request, and the directory of all effective characters. It receives no story instructions, raw user input, conversation history, prior action results, or images. Prompt Route and prompt logs retain the assistant instructions and request but replace the directory with the character count and its estimated token size, measured with the run’s TextMetricsApi settings. The request carries this diagnostic representation separately for Turn Trace capture and export; provider dispatch and token calibration still use the complete prompt. No automatic context splitting is performed.
3. The assistant searches the entire directory for recorded matches and semantically suitable alternatives, then answers in concise prose without a fixed word or character limit. It respects the requested result count. Missing prior contact does not disqualify a suitable candidate, but alternatives are explicitly distinguished from established participants. Account results must use enabled accounts on the requested app and include exact character names, app names, account IDs, and profile names, without unrelated accounts from other apps. It reports missing facts or no plausible candidate rather than inventing identities, claiming unrecorded interactions, recommending placeholders, or referring to unseen history. There is no second parameter JSON or deterministic ranking step.
4. The answer insertion template wraps this text, which replaces the action marker on replay. The full directory is never inserted into the planning or main story pass. Empty assistant responses report a warning rather than exposing the request as story output.

## Directory data

`characterSearchDirectory` in `src/characters/search.ts` reads `ExecuteContext.appCharacters`, the effective registry including Storybook characters, library NPCs and saved overrides. If this projection is unavailable, it reads Storybook nodes. It formats a text directory containing:

- Character ID, name, authored age/gender, description, personality, speech style, role, hidden agency, agency tags and meanings.
- Enabled accounts with exact account IDs, profile names, roles, bios, account tags, social privacy mode and post counts. Counts include seeded and live posts, resolved by owner, without copying post content.
- Authored outgoing relationships with target names/IDs, relationship descriptions and app contact/follow flags. Missing or one-sided data never proves mutual friendship.

No image blobs, complete containers, banking data, or chat text are serialized. Hidden agency and anonymous identities are author context, not public character knowledge. The assistant treats directory content as data rather than instructions.

## Configuration and compatibility

The stable internal ID remains `getCharacterList`. Legacy `Get character list` markers and `get_character_list` requests resolve to the renamed action. The short workflow introduction explains its purpose; the first-pass hint specifies the self-contained question format.

The action editor labels are **Character Information Assistant Prompt** and **Assistant Answer Insertion Template**. The first-pass hint stays read-only. Assistant variables are `{{plan}}` and `{{characterDirectory}}`; insertion uses `{{answer}}`. Missing placeholders append the required request, directory, or answer. Substitution is single-pass so data containing template tokens cannot expand further content.

The previous maximum-results setting is removed; the request determines the desired result count. Stored default ranking and assistant instructions (including the former 50–100-word information prompt) and result templates migrate to the new defaults, while custom templates remain editable. Legacy query-only calls are no longer executable.

Validation: `src/nodes/shared/promptActions.characterList.test.ts` covers directory fields, post ownership, template migration, relationship context, prompt isolation, prose replay in planning and main output, no matches and empty responses. Phone-image tests also cover legacy direct-call compatibility.

## Phone image assistant

`Get character phone image list` (`getImageId`, request `get_image_id`) now takes a self-contained plan directly to an isolated image selection assistant in both planning and main passes. There is no intermediate phone-owner/tag parameter request or caption scoring in this path. The plan must name the target character or exact enabled social account ID, platform, desired content, purpose, audience and count, distinguishing any intermediary from the target.

Only characters explicitly mentioned by name, character ID, or enabled account ID are included. Matching ignores case and respects identifier boundaries. Missing identities do not fall back to the active speaker. Their character/account directory and all gallery captions are supplied with recorded direct recipients, social publications (including account ownership), and MatchMe profile usage. Image blobs and raw conversation history are excluded. Diagnostics summarize the directory size rather than copying it.

The assistant returns `{"imageIds":["existing-id"],"answer":"selection rationale"}`. IDs are validated against candidates, deduplicated and capped by the action's maximum image count. Invalid or empty assistant output reports a warning. The replay receives the explanation and existing image result fields (`imageReference`, `imageId`, `imageText`, `imageShownTo`); `{{answer}}` can position the explanation in custom result templates. Existing image attachment and caption visibility settings still apply. The assistant prompt supports `{{plan}}` and `{{characterDirectory}}`. Stored default owner/tag instructions migrate automatically; custom instructions remain editable. Legacy direct owner/tag calls remain supported for compatibility.

Subsequent planning and main steps retain the full image selection result, including the assistant answer, even without repeating the consumed action marker. When a marker already inserts that result, no additional copy is added. Prompt diagnostics show the carried result as an Image selection result section.
