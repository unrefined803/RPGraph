# Social Media Apps — Plan

Two new phone apps that share one common code base: **Fotogram** (Instagram-style,
public posts) and **OnlyFriends** (OnlyFans parody, posts must be unlocked/purchased).
This document is the working plan; we refine it before and while implementing.

## Goals

- Both apps are structurally the same app ("social feed"). An improvement to a
  shared feature (likes, comments, posting, feed rendering) automatically applies
  to both. Only branding (colors, name, icon) and a few behavior flags differ.
- Like the Banking app, the apps are simulated in the background during roleplay.
  Most feed content is dummy posts (placeholder images that look "not loaded").
- The only interface to the outside world is compact chat-history activity.
  Meaningful workflow actions write a short summary instead of copying full
  posts or comment threads into narrator context. A later close-app summary can
  combine several local-only interactions such as likes.

## App identities

| | Fotogram | OnlyFriends |
|---|---|---|
| Real-world model | Instagram | OnlyFans |
| Post visibility | All posts public | Posts locked, unlock by paying |
| User role | Always a regular user | Creator **or** paying viewer (to be detailed) |
| Color scheme | Instagram-like purple/orange gradient | OnlyFans-like blue/white |
| Routing | Message Format `3`, shared | Message Format `3`, shared |

## How app interactions work (the mechanism)

Every meaningful action inside a social app is **its own workflow turn**, the
same way a bank transfer is. This is the pattern every future action follows:

1. The app builds a structured input block (e.g. `[SOCIAL MEDIA POST]` with
   app, post id, author, post text, image description) and starts a graph run
   with **Message Format `3`** and the action's **Turn Mode**. Attached images
   travel along so vision models can see them.
2. The **LLM Prompt Switch** routes Message Format 3 to its "Social Media"
   output channel; the Turn Mode picks the prompt slot for exactly this action
   and app. The prompt sees the chat history and character descriptions, so
   reactions fit the story.
3. The switch's Social Media channel is wired to the **Social Media input of
   RP Output**. The model must answer with one JSON object (e.g.
   `{"reactions":{...}}`); the app parses it and applies the result inside the
   app (likes, comments, …).
4. The action and its result are written to the **chat history** as compact
   info lines (`[Fotogram] Name (@handle) posted: "…"`), so the narrator LLM
   knows what happened. Comment turns use the model's one-sentence summary;
   complete threads and invented NPC noise stay inside the app.
5. The data is **persisted as records on chat messages** (`socialPost`,
   `socialThreadAction`, `socialReactions`, later likes), which makes it part of
   the RP save automatically and also lets Opening History imports carry the
   activity with the imported turns.

Because Fotogram and OnlyFriends audiences react differently, **every action
always gets two prompt slots** — one per app.

### Prompt slot map (Message Format 3)

| Turn Mode | Action | Status |
|---|---|---|
| `0` | Fotogram: new post → likes + comments | ✅ implemented |
| `1` | OnlyFriends: new post → likes + fan comments | ✅ implemented |
| `2` | Fotogram: write a comment or load more comments → thread reacts | ✅ implemented |
| `3` | OnlyFriends: write a comment or load more comments → thread reacts | ✅ implemented |
| `4+` | later: like activity, "Load More" feed generation, DMs, close-app summary | open |

Message Format `2` + Turn Mode `0` stays Banking.

## Shared structure

- New shared module, e.g. `src/components/phone-social/` with a common
  `PhoneSocialFeedScreen` used by both apps.
- Each app is a small config object passed to the shared screen:
  - `appId` (`fotogram` / `onlyfriends`), display name, icon, theme colors
  - behavior flags: `postsRequireUnlock`, `allowCreatorRole`, …
- Shared building blocks (one implementation, used by both):
  - feed list, post card (image, caption, likes, comments)
  - like / comment / post-your-own-image interactions
  - dummy-post generation (placeholder images, "not loaded" look)
  - direct messages inside the app (writing to other accounts)
- Per-character accounts: every character (and the player) has their own account
  and their own activity state (posts, likes, comments, DMs). Accounts never mix;
  switching the viewed character switches the account, like the Phone tab does.

## Shared platform (vision)

- Both apps sit on one shared platform simulation. Posts live in a common
  post store ("shared database"): if character A posts something and the
  player switches to character B and opens the app on B's phone, B sees A's
  post too.
- All characters that share phones also share the social platform: the phone
  contacts double as the followed accounts in the left side panel. Additional
  people can be added manually ("Add Person").
- Accounts are discoverable across both apps — a character can also be found
  on OnlyFriends, enabling roleplay intrigue (finding, unlocking, liking
  someone's account).
- What flows outward is always attributed to the acting person: when an app
  is closed, the summary describes who did what (who posted, who liked whose
  post, who unlocked what). That requires tracking interactions per account —
  built in a later phase, after the UI basics.

## Storage and image references

The main storage rule is: **social activity belongs to message records; images
belong to the Storybook image library**.

There are three related storage layers:

- **RP Save** stores the playable session. Social posts and reactions are
  attached to chat messages as records, so the timeline reloads the feed
  without a separate social save file.
- **Storybook** stores durable world facts and media. Account usernames belong
  here because they are true for the character independent of one session.
  Images also belong here, inside the character image library that powers the
  phone Gallery.
- **Opening History** stores an imported setup snapshot. Importing the current
  session already copies complete turns with their message records, so social
  posts and reactions come along automatically when they are represented as
  message records.

Photo posts must not store their own raw image copy. A posted image should
always be represented by a Storybook/Gallery image id plus the image
description needed for prompts. The same image can then be used in Chat,
WhatsUp, Fotogram, OnlyFriends, and the Gallery without duplicating the base64
data in every place it appears.

Posting image sources should follow this shape:

- **Choose from Phone Gallery**: use the existing Gallery image id directly.
- **Camera assistant**: save the generated image into the acting character's
  Gallery first, then post by image id.
- **Upload from Computer**: import the uploaded file into the acting
  character's Gallery first, deduplicating by image data when possible, then
  post by image id.
- **Text Post**: store no image id.

Implemented: social post records store `imageId` (the Storybook/Gallery image
id) instead of their own image copy. The pixels live once in the Storybook
image library and are resolved by id wherever the post appears (feed, chat
post card). Uploads from the computer are imported into the acting
character's Gallery first (deduplicated by image data), then posted by id.
Social image ids count as "used by chat history" everywhere images are
protected: the Storybook editor refuses to delete them and the automatic
pruning of inactive received images keeps them. Posts, their linked image
ids, and the player likes all survive "Import Current Chat" round trips.

## Phases

### Phase 1 — UI only (current)

- Add both app icons to the phone desktop (`PhonePanel.tsx` app grid, alongside
  `whatsup`, `gallery`, `camera`, `banking`). ✅
- Build the shared feed screen with static dummy content: scrollable feed,
  placeholder-image posts, like/comment UI, "create post" UI. Each app has a
  separate pool of ten hand-written posts; a Banking-style stable character
  seed picks the same three to five posts on every opening. Every chosen post
  has four or five matching deterministic NPC comments. ✅
- WhatsUp-style two-column layout: left side panel with the followed accounts
  (phone contacts + manually added people, "Add Person", "New Post"), feed on
  the right; clicking an account shows that account's posts. ✅
- Posting flow (same in all social apps): "New Post" first asks for the image
  source — Camera assistant / Choose from Phone Gallery / Upload from Computer /
  Text Post — then the editor shows the picked image on top with the caption
  below. ✅
- OnlyFriends variant: locked posts with an unlock/pay interaction. ✅
- Unlocking is a real purchase (first backend link-up): "Unlock" opens a
  "Pay with Bank Account" confirmation showing the price and the owner's
  current balance; paying sends a normal bank transfer from the owner to the
  post's author (visible in the Banking app, lowers the balance; blocked when
  the balance is too low). ✅
- No LLM, no persistence beyond basic session state; goal is that clicking
  through both apps feels right and both provably share the same components.
  Post/account state is still local to the opened screen; the shared post
  store comes with Phase 2.

### Phase 2 — LLM content generation (started)

Every action in a social app is its own workflow turn. The new **Message
Format 3 = Social Media** routes these turns; each action type gets its own
prompt slot on the "Social Media" output channel of the LLM Prompt Switch,
which is wired to the new **Social Media** input of RP Output.

- Posting runs the workflow; the post is recorded in the chat history
  (`[Fotogram] Name (@handle) posted: "…"`) and the LLM returns JSON reactions
  (likes + comments), which appear on the post. ✅
- Photo posts pass the image to the run (vision models can see it) and include
  the stored gallery image description in the input block, so reactions can
  refer to what the photo actually shows. The input labels separate the
  user-written "Post text" from the "Image description". ✅
- With English processing enabled, the translated post text is stored on the
  social record, so both the app and internal history use the same English
  caption. Without it, the original text is retained. ✅
- Per-app prompt slots on the Social Media channel: **Turn Mode 0 = Fotogram
  Post**, **Turn Mode 1 = OnlyFriends Post**. Fotogram reactions: 0–2 comments
  from real story characters (dynamic, never the author) plus 2–3 invented NPC
  friends. OnlyFriends reactions: 2–5 comments from invented fans only (the
  platform is private; story characters never appear). ✅
- Only story-character comments are written to the chat history; invented NPC
  comments stay in the app (they are unimportant background noise). ✅
- Posts and reactions are persisted on chat messages (`socialPost` /
  `socialReactions` records), so they are part of the RP save and reload with
  the session. ✅
- Photo posts persist only the Storybook/Gallery image id (`imageId`) plus the
  image description; the image itself is stored once in the Storybook image
  library and resolved by id in the feed and the chat post card. ✅
- Accounts live in the Storybook (`characters[].social.fotogramUsername` and
  `.onlyfriendsUsername`, storybook format 1.18.0). A stored username skips
  the app's onboarding; creating an account in either app writes the username
  back into the Storybook. Fotogram accounts are expected for every character
  (the assistant always sets one); OnlyFriends accounts stay empty unless
  created. The bundled default workflow (v8) gives all four characters
  Fotogram usernames. ✅
- OnlyFriends sidebar starts empty (no story-character contacts) because the
  platform is private; accounts can only be added manually. ✅

### Commenting and thread loading (Turn Modes 2 and 3)

Writing a comment and loading more comments both run the workflow. They share
one prompt slot per platform because the structured input identifies the
requested thread action:

- The input block describes the situation: which post (id, author, post text),
  whether it belongs to the actor, current likes, the complete visible comment
  thread including NPC comments, and either the user's new comment or a request
  to generate more comments. This full snapshot is turn-local input and is not
  copied into chat history.
- The prompt is **dynamic** — how the thread reacts depends on whose post it
  is and what the comment says:
  - Comment **under the user's own post**: the repliers mostly address the
    user directly (answering questions, reacting to what they said).
  - Comment **under someone else's post**: either the post's author replies
    (especially when asked something), or other commenters chime in, or the
    comment simply gets **ignored** and the thread just grows with unrelated
    new comments. The LLM decides based on the comment's content.
- The response contains append-only reactions JSON (extra likes plus new
  comments) and one mandatory short `summary` sentence. Full comments appear
  only inside the app; the summary is the only thread text sent to chat history.
- Two prompt slots as always: **Turn Mode 2 = Fotogram Comment Thread** (post
  author, fitting story characters, and NPC friends), **Turn Mode 3 =
  OnlyFriends Comment Thread** (the post author where appropriate plus invented
  fans; unrelated story characters stay out of the private thread).
- User thread actions are persisted as `socialThreadAction` records. Generated
  replies use appendable `socialReactions` records, so comments and loaded
  batches survive closing the app and reloading the RP save. ✅
- With English processing enabled, the translated user comment is stored and
  shown in the app. The UI waits for that translated workflow record instead of
  inserting an optimistic copy in the display language. The user's comment
  remains directly before the generated replies belonging to that action. ✅
- The same controls work on generated posts and deterministic dummy posts. ✅

### Chat post cards and feed UI (implemented)

- Published posts appear in the Chat timeline as interactive **social post
  cards** (app icon, author with avatar/color, image or text, aggregated like
  and comment counts). Clicking a card opens the right app on the phone and
  scrolls to the post; OnlyFriends cards first switch to the post author's
  character so the private feed shows the post. ✅
- The raw reaction/thread history lines are hidden from the Chat view (they
  stay in the LLM history); their engagement is folded into the post card's
  like/comment counters instead, and they no longer count as unread chat
  messages. ✅
- Feed UI v2: post header with author info, locked chip, and the RP timestamp
  of the post's message; caption below the image prefixed with the author
  name; like/comment pill on the image; separate "Open comments" footer
  toggle; text-only posts share the same layout without the image block. ✅
- Selecting an account in the sidebar shows only that account's published
  posts (profile banner + "Latest Posts"); "Your Feed" shows everything plus
  the deterministic dummy posts. Post author avatars resolve to the matching
  Storybook character via handle or name. ✅

When commenters appear, they should also become visible in the app's account
sidebar as "recently seen" people. The main playable characters are pinned as
favorites, and later any NPC account can also be favorited so it stays near the
top. This is shared by both apps:

- **Fotogram**: story characters and NPC commenters can appear as recent
  accounts because the platform is public.
- **OnlyFriends**: fan commenters can appear as recent accounts even though the
  default sidebar starts empty. This does not mean they are full phone contacts
  yet; it only means the user has seen them in the social app.

Later, those recently seen or favorited accounts can become DM targets.

### Backlog (rough order)

1. ~~Persist likes so they survive reopening and land in the RP save.~~ Done:
   player likes are stored per character and app in the session's UI state
   (`socialLikesByAccount`, session format 2.8); the feed and the chat post
   card count one like per liking character. "Import Current Chat" snapshots
   the likes into the Storybook opening history (`openingHistory.socialLikes`)
   and loading an opening history restores them.
2. ~~Replace social photo `imageDataUrl` storage with Storybook/Gallery image
   id references.~~ Done: posts store `imageId`; camera and gallery picks
   already carry Gallery ids, computer uploads are imported into the acting
   character's Gallery first (deduplicated).
3. Track recently seen accounts from comments and allow favorites in the social
   sidebar. Player characters start as favorites; NPCs can be favorited later
   and eventually become DM targets.
4. Rename "Import Current Chat" to "Import Current Session" and describe that
   it imports chat, phone, bank transfers, events, and social message records.
5. "Load More" in the feed (separate from the implemented comment-thread
   button): generate additional feed posts per account via a prompt slot instead
   of deterministic dummy posts.
6. Shared post store across characters (character A's post visible on
   character B's phone) — the vision section below.
7. OnlyFriends creator role from the Storybook (creator posts & earns; viewer
   pays & unlocks) and unlock money actually reaching the creator's account.
8. Close-app summary (Phase 3): summarize the session in the app and emit it
   into the chat history like bank transfers.
9. Username fields in the storybook creator dialog (currently only the
   storybook assistant / app onboarding set them).
10. DMs inside the apps (writing to other accounts).
11. Opening a chat post card while the viewed phone character has no account
    in that app lands on the onboarding screen instead of the post (Fotogram
    only; OnlyFriends cards switch to the post author first). Decide whether
    the card should pick an account-holding character automatically.
12. Unified image linking beyond the social apps: WhatsUp/chat messages
    already reference the Storybook image id (`phoneImageIds`) but still embed
    a full `imageAttachments` copy on every message record, duplicating the
    base64 data in saves and opening histories. Migrating them to pure id
    links (like social posts) is a larger refactor across rendering, vision
    runs, and the opening-history fixtures — discuss before starting.

### Phase 3 — Workflow integration

- On app close, the LLM summarizes the session inside the app ("was on Fotogram,
  posted X, liked Y, wrote to Z…").
- The summary is emitted into the chat history as an info box, so the narrator
  LLM knows what happened (same as bank transfers).
- Routes as further Turn Modes on Message Format `3` (see the prompt slot map).

## Accounts and Storybook

- Whether a character has an account is written in RP Storybook. If the
  Storybook says nothing about an account, the character has none.
- Creating an account is deliberately simple: a "Create account" step where the
  user picks a nickname — same flow in both apps.
- For OnlyFriends, the Storybook entry also records the role: regular user or
  creator.
- User comments already live in session message records, and player likes are
  stored in the session's UI state per character and app. Manually added
  people, recently seen commenters, favorites, and unlocks are session/app
  state, not durable Storybook facts, and should follow the same persistence
  pattern without turning every passerby NPC into a permanent Storybook
  character.
- Recently seen accounts are created by activity. If someone comments under a
  Fotogram post or OnlyFriends post, that account can appear in the sidebar.
  Favorites pin important accounts above recent accounts. The main playable
  characters are favorites by default, and NPC accounts can be favorited later.

## Open questions

(Concrete work items live in the Backlog above; these are undecided designs.)

- OnlyFriends creator role: what exactly changes in the UI for a creator
  (posting & earning vs. paying & unlocking)?
- ~~Should unlocking OnlyFriends posts spend Banking money (shared wallet)?~~
  Answered: yes — unlocks pay via the Banking pipeline (implemented in Phase 1).
- How many dummy accounts/posts per session, and are generated feed posts
  persisted or regenerated per visit?
- Exact JSON shape of the close-app summary entries (Phase 3).
- Exact session-state shape for recent accounts and favorites.
