# Character search action

`Get character list` (`getCharacterList`, LLM name `get_character_list`) is an opt-in prompt action. Its editor exposes the standard first-pass hint, editable follow-up instruction and result insertion template, plus a global runtime setting `maxReturnedCharacters` (default 5, range 1–20). Bundled normal and planning workflows enable it in output channel 0 for RP Prompt Normal, RP AutoTurn, RP Narrator, and RP Narrator AutoTurn. Planning workflows expose the result to both planning and main passes. Event, WhatsUp, Social Media, and Autoplay slots do not enable it.

## Execution

1. An authored `@action:Get character list` marker inserts a hint requesting `{"action":"get_character_list","plan":"..."}`.
2. The follow-up receives the plan and the canonical agency tag catalog with meanings. It returns `{"action":"get_character_list","query":{...}}`.
3. `rankCharacters` in `src/characters/search.ts` searches `ExecuteContext.appCharacters`, the effective registry projection including Storybook characters and NPC library entries. When this projection is unavailable, it uses Storybook node characters. The action does not create characters or change participant state.
4. Results replace the action marker during prompt replay. Both planning steps and main output use the existing action loop.

## Query and ranking

All fields are optional; `{}` lists characters without preferences. Invalid keys, tag IDs, enum values, or boolean types are rejected.

| Field | Values | Match |
| --- | --- | --- |
| `app` | `whatsup`, `fotogram`, `onlyfriends`, `matchme` | Enabled account exists |
| `privacyMode` | Boolean | Selected social account has this privacy setting |
| `hasPosts` | Boolean | Selected social account has or has no authored/live posts |
| `gender` | `woman`, `man`, `nonbinary` | Authored character gender; never inferred |
| `agencyTags` | Array of canonical tag IDs | Character tag or selected enabled account tag; without `app`, any enabled account |

`privacyMode` and `hasPosts` require `app` to be `fotogram` or `onlyfriends`. Privacy hides the real name and profile photo publicly; it does not indicate locked posts. A missing or disabled account never matches either boolean, including `false`. Posts include text-only posts, seeded container posts and timeline publications, matched by account identity before legacy identity fields. Repeated post IDs on the same account count once.

Each criterion and each distinct requested tag contributes one point. No criterion is a hard filter. Partial and zero matches remain eligible, ordered by descending score, then name and character ID for stable ties. Results expose matched and unmatched criteria so the writer cannot mistake a partial match for an exact match.

## Result data

Results contain character ID, name, score, total criteria, matched/unmatched criteria, authored gender/age, description, personality, role, speech style, hidden agency, character tags and enabled accounts. Account summaries include IDs, profile names, bios, privacy, post counts, roles and account tags. Unsupported privacy/post fields are `null`. No images, binary data, banking details, or complete containers are inserted.

Template variables: `{{plan}}` and `{{agencyTags}}` in the follow-up; `{{actionId}}`, `{{query}}`, `{{returnedCount}}`, and `{{characterList}}` in the result. Hidden agency and anonymous identity are author context, not public character knowledge.

Validation: `src/nodes/shared/promptActions.characterList.test.ts` covers ranking, ownership, account state, persistence, parsing and the full action loop in planning and main output.
