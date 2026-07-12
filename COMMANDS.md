Failed to create stream fd: Operation not permitted
Failed to create stream fd: Operation not permitted
Failed to create stream fd: Operation not permitted
# Commands — deferred JSON reply blocks

Status: implemented (July 2026). Command definitions live in
`src/nodes/shared/promptCommands.ts`, the two-pass runtime in
`src/nodes/shared/promptRun.ts`, the editor dialog in
`src/nodes/shared/PromptTools.tsx` (`PromptCommandModal`), and the default
workflow prompts use `@command:` tokens. `phone_message` stays inline in the
Phone output channel (there it is the primary reply, not a command) and in the
Normal RP channel (there the phoneMessages block is embedded mid-story between
the prose paragraphs, which a deferred command pass cannot do), and the
OnlyFriends Post prompt keeps its fan DMs inline because they are a mandatory
part of that task. This file documents the design.

Planning document for the "Commands" feature. A command is an optional standalone
JSON object the LLM can append to a reply (bank transfer, social comment, …).
Today every prompt in the default workflow embeds the full JSON instructions for
every available block, which makes the prompts very long. The Commands feature
replaces those embedded instructions with a short capability list plus a
request-and-replay mechanism, reusing the existing prompt-action replay loop.

## How it works (Variant 2 — lazy expansion)

1. **Authoring.** The user writes the main prompt, then their own condition
   lines with a command token behind each, mirroring the `@action:` style:

   ```
   <standard prompt>

   When the message requires sending money now, use
   @command:bank_transfer

   When someone comments on an existing Fotogram post, use
   @command:fotogram_post_comment
   ```

   The condition ("when …") is user-authored prompt text; the token is the
   command reference. Like action tokens, `@command:` tokens are highlighted and
   clickable in the editor: the dialog shows the command's short instruction and
   JSON block, both editable.
2. **First pass.** Each token renders as only the literal request line for its
   command, e.g. `[commands: bank_transfer]` — no JSON format and no repeated
   protocol text. The general protocol (do not write the JSON yourself; finish
   the reply, then end the output with one final `[commands: ...]` line, several
   names at once allowed) is written **once per prompt** by the prompt author as
   an "Optional commands:" intro block above the command entries. Prompts follow
   a fixed structure: task description, primary output format, optional
   commands, and the `@action` blocks last.
3. **Second pass (command pass).** The original prompt is NOT repeated. The LLM
   receives: the node's text input (chat history), its own finished reply
   **including** the request line (so it sees what it triggered), and the full
   instruction + JSON block for **only the requested commands**, headed by:
   "You requested these commands for your finished reply. The reply is final —
   do not rewrite or repeat it. Output only the command JSON objects."
   Multiple commands in one request line need only one extra pass.
4. **Output.** The node emits **once**, after the command pass: the reply text
   (request line stripped) plus the command JSON objects appended — exactly the
   combined format the node produces today when the LLM writes everything
   inline. Downstream processing (Banking, Social, Phone) stays unchanged, and
   the output channel fires a single time, like the existing action replay loop.

Mandatory-use rules (e.g. "when money is transferred you MUST …") live in the
user-authored condition line right next to the token, so reliability does not
depend on the LLM remembering a long prompt.

Pre-reply image actions (`@action:Get character phone image list`, create image,
describe input image) are unaffected: they must run before the reply because the
reply text depends on their result. Commands are the post-reply counterpart.

## Naming the feature

- **Primary proposal: Command** — token `@command:<name>`, request line
  `[commands: <name>, <name>]`. Reads like a callable instruction, clearly
  distinct from the existing "Action" concept.
- **Secondary proposal: Reply Command** — same mechanics, longer label for UI
  texts ("Reply Commands" section in the prompt). Token stays `@command:` for
  brevity.
- Other candidates considered: Extra, Add-on, Effect, Directive — all rejected
  as primary because they sound like UI decoration rather than something the
  LLM invokes.

Command names use `snake_case` (command-like, matches the request-line syntax).

## Command list (extracted from the default workflow)

Every optional standalone JSON block that prompts in `workflow.default*.json`
currently describe inline. For each: primary name, secondary name, the JSON
block, and the instruction template used in the second pass.

Instruction-template placeholders: `{{commandName}}` and shared header text
"You requested the command(s) below for your finished reply. The reply is final;
do not rewrite or repeat it. Output only the JSON objects described here, each a
complete standalone object, valid JSON with double quotes, no markdown fences."

---

### 1. Bank transfer

- **Primary name:** `bank_transfer`
- **Secondary name:** `send_money`
- **Suggested condition line (user-authored prompt text):** "`bank_transfer` — whenever the input,
  Narrator direction, event, or your reply states or clearly implies that money
  is transferred now, you MUST request this command. Describing the payment in
  text is not sufficient."
- **JSON block:**
  ```json
  {
    "bankTransfers": [
      {
        "from": "sender name",
        "to": "recipient name",
        "amount": 25.5,
        "note": "what the payment is for"
      }
    ]
  }
  ```
- **Instruction (second pass):** You requested `bank_transfer`. Copy the actual
  sender, recipient, and numeric amount from the described transfer, even when
  the story names another currency or one party is an outside contact. Do not
  invent a transfer when no payment occurs. `amount` must be a positive number;
  the Banking app displays ledger amounts in US-dollar format. `note` is
  optional. The transfer appears in every involved Storybook character's Banking
  app and changes their balance. Use full displayed names in `from`/`to`.

### 2. Phone message

- **Primary name:** `phone_message`
- **Secondary name:** `send_phone_message`
- Used as an *extra* block in social DM prompts only. In the Phone prompt the
  phone message is the primary reply, and in Normal RP prompts the
  phoneMessages block stays inline because it is embedded mid-story between
  prose paragraphs.
- **Suggested condition line (user-authored prompt text):** "`phone_message` — a character texts someone who is not
  present in the scene right now. When characters can simply talk, let them talk
  in the prose instead."
- **JSON block:**
  ```json
  {
    "phoneMessages": [
      {
        "from": "sender name",
        "to": "recipient name",
        "message": "message text",
        "isVoiceMessage": false,
        "sendImageId": "stored_image_id"
      }
    ]
  }
  ```
- **Instruction (second pass):** You requested `phone_message`. `isVoiceMessage`
  is optional: true only for a spoken TTS voice message. `sendImageId` is
  optional: only an exact imageId from an action result or recent phone/photo
  history; omit it when none fits. Use full displayed names for known contacts;
  invent a new outside contact name only when no known contact fits. The message
  appears in the involved characters' phone messenger.

### 3. Display image in chat

- **Primary name:** `display_image`
- **Secondary name:** `show_image`
- **Suggested condition line (user-authored prompt text):** "`display_image` — show one stored image in the Chat tab
  when the story beat shows it (looking at a photo, showing a picture, taking a
  new photo). Needs an exact imageId from an action result or recent history."
- **JSON block:**
  ```json
  {
    "displayImageId": "stored_image_id"
  }
  ```
- **Instruction (second pass):** You requested `display_image`. Use only an
  exact imageId from an action result or recent phone/photo history. Do not
  invent image IDs. Do not display more than one image per reply.
- Note: this command depends on image data, so it usually pairs with the
  pre-reply image actions; it may stay inline in image-focused prompts.

### 4. Fotogram post comment

- **Primary name:** `fotogram_post_comment`
- **Secondary name:** `fotogram_comment`
- **Suggested condition line (user-authored prompt text):** "`fotogram_post_comment` — someone writes a comment on a
  specific existing Fotogram post now."
- **JSON block:**
  ```json
  {
    "fotogramPostComment": {
      "postId": "fotogram-post-01",
      "from": "commenter name",
      "text": "comment text"
    }
  }
  ```
- **Instruction (second pass):** You requested `fotogram_post_comment`. Copy
  `postId` exactly from the chat history. The comment appears under that post in
  the social app. Use it only for an actual comment on an existing post.

### 5. OnlyFriends post comment

- **Primary name:** `onlyfriends_post_comment`
- **Secondary name:** `onlyfriends_comment`
- **Suggested condition line (user-authored prompt text):** "`onlyfriends_post_comment` — someone writes a comment on a
  specific existing OnlyFriends post now."
- **JSON block:**
  ```json
  {
    "onlyFriendsPostComment": {
      "postId": "onlyfriends-post-01",
      "from": "commenter name",
      "text": "comment text"
    }
  }
  ```
- **Instruction (second pass):** Same rules as `fotogram_post_comment`, for the
  OnlyFriends app.

### 6. Fotogram direct message

- **Primary name:** `fotogram_direct_message`
- **Secondary name:** `fotogram_dm`
- **Suggested condition line (user-authored prompt text):** "`fotogram_direct_message` — the story clearly has someone
  message a character privately on Fotogram now."
- **JSON block:**
  ```json
  {
    "fotogramDirectMessages": [
      {
        "from": "sender name",
        "to": "recipient name",
        "text": "message text",
        "postId": "fotogram-post-01"
      }
    ]
  }
  ```
- **Instruction (second pass):** You requested `fotogram_direct_message`.
  `from` and `to` are required. `postId` optionally references an existing post
  from the chat history as the conversation topic; omit it when unrelated. No
  `tip` field on Fotogram.

### 7. OnlyFriends direct message

- **Primary name:** `onlyfriends_direct_message`
- **Secondary name:** `onlyfriends_dm`
- **Suggested condition line (user-authored prompt text):** "`onlyfriends_direct_message` — the story clearly has
  someone message a character privately on OnlyFriends now."
- **JSON block:**
  ```json
  {
    "onlyFriendsDirectMessages": [
      {
        "from": "sender name",
        "to": "recipient name",
        "text": "message text",
        "postId": "onlyfriends-post-01",
        "tip": 5
      }
    ]
  }
  ```
- **Instruction (second pass):** You requested `onlyfriends_direct_message`.
  `from` and `to` are required. `postId` optionally references an existing post.
  `tip` is optional and OnlyFriends-only: a positive number credited to the
  recipient's OnlyFriends wallet (not a bank transfer). Omit `tip` when no tip
  is sent.

---

## Not commands (stay as they are)

- **Primary reply blocks** — the main JSON object a prompt slot requires exactly
  once: the phone message object in the Phone prompt, the
  `onlyFriendsDirectMessage` / `fotogramDirectMessage` reply block in social DM
  prompts, and the `reactions` block (likes + comments) in the social feed
  reaction prompts. These are the answer itself, not an optional extra.
- **Prompt actions** (`@action:` tokens) — pre-reply data fetching and image
  generation; already centrally defined in
  `src/nodes/shared/promptActions.ts`.
- **RP Output Actions UI blocks** (`chatMessages`, `buttons`/choice groups,
  `infoBox`, `progressBar`, `contextCapacity`, `setTab`, `setPlayer` — parsed in
  `src/chat/outputActions.ts`, documented in `src/nodes/output/formatHelp.ts`) —
  currently not used as inline instructions in the default workflow prompts.
  They could become commands later with the same mechanism.

## Open implementation notes

- Reuse the replay loop in `src/nodes/shared/promptRun.ts`; the request line
  `[commands: …]` is the trigger, analogous to an action JSON call.
- Strip the request line from the final visible output, but keep it in the
  reply text shown to the LLM during the command pass.
- The command pass sends: the node's text input (chat history), the finished
  reply with request line, and only the requested command instructions — not
  the original prompt.
- The node emits a single combined output (reply + command JSON) after the
  command pass; no separate second emission on the output channel.
- Cap command passes (one request line per reply; unknown names produce a
  warning like unknown actions do).
- Editor and config UI: highlight `@command:` tokens like `@action:` tokens in
  `src/nodes/shared/JsonSyntaxTextarea.tsx`; clicking a token opens an editable
  view of the command's instruction text and JSON block, analogous to the
  prompt-action dialog in `src/nodes/shared/PromptTools.tsx`.
