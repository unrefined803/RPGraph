export type OutputFormatHelpKind =
  | 'rp'
  | 'phone'
  | 'output-actions'
  | 'social-media'
  | 'direct-actions'
  | 'user-input'
  | 'rp-output';

export const userInputOverview = `USER INPUT OUTPUTS

Text
The current user, Narrator, AutoTurn, event, phone, or app input as text. This is the normal content sent through the story workflow.

Image
The current normalized input images. This output is empty when the turn has no attached image.

Message Format
Selects the broad LLM Prompt Switch route for normal graph runs:
0 = Normal RP
1 = Phone Message
2 = Social Media
3 = Autoplay

Direct Actions does not use Message Format and does not select a Prompt Switch channel.

Turn Mode
Selects the prompt slot inside the chosen normal output channel:
0 = Input with image
1 = Input without image
2 = AutoTurn
3 = Event
4 = Narrator
5 = Narrator AutoTurn

Social Media uses its own slots: 0 = Fotogram post, 1 = OnlyFriends post, 2 = Fotogram comment thread, 3 = OnlyFriends comment thread, 4 = Fotogram DM, 5 = OnlyFriends DM.

Autoplay uses its own slots: 0 = Local Activity, 1 = Remote Activity.

Direct Actions
Carries already-complete app-action JSON. A direct-only run evaluates only this output and the matching RP Output input. Text, Image, Message Format, Turn Mode, and the LLM Prompt Switch are not evaluated, so no LLM is called.

Bank transfer example:
{"bankTransfers":[{"from":"Mia","to":"Alex","amount":20,"note":"Dinner"}]}

Info box example:
{"infoBoxes":[{"title":"Purchase complete","text":"The item was added to the account.","tone":"success"}]}

Direct actions are still recorded as a normal turn, so their changes can be undone or regenerated. The User Input Direct Actions output must be connected to the RP Output Direct Actions input for app-triggered direct runs.`;

export const rpOutputOverview = `RP OUTPUT INPUTS

Normal RP
Visible story prose and dialogue for the Chat tab. It can also contain embedded phoneMessages, bankTransfers, or one displayImageId when the generated story requires them.

Phone Message
One generated phone reply as JSON with from, to, message, and optional isVoiceMessage or sendImageId. This channel can also carry a separate incoming-image caption action.

Social Media
Generated reactions for Fotogram and OnlyFriends posts or comment threads. The app applies the returned likes and comments and records the relevant history.

Autoplay
One autonomous background reaction. It accepts the same plain RP text and embedded phone/app JSON as Normal RP, while remaining a separate graph input.

Output Actions
LLM-generated or graph-generated app commands that accompany a normal run. Supported commands include phone messages, chat messages, choice buttons, info boxes, progress bars, context-capacity bars, bank transfers, setTab, and setPlayer.

Highlighting Context
Optional extra context used only by RP Output speaker and dialogue highlighting analysis. It is not displayed as story text.

Direct Actions
Already-complete app-action JSON that does not need an LLM. It accepts the same command shapes as Output Actions plus the phone-app commit payloads createdPhoneNotes and simulatedAiChats. This input is only evaluated on an explicit direct-only run started by the app (Banking transfer, manual Notes commit, ChatGPD chat commit); normal, phone, social, autoplay, and auto-turn runs never touch it. In a direct-only run, RPGraph starts here and does not evaluate the normal RP, phone, social, routing, translation, speaker-analysis, or preparation paths.

Bank transfer example:
{"bankTransfers":[{"from":"Mia","to":"Alex","amount":20,"note":"Dinner"}]}

Manual phone note example:
{"createdPhoneNotes":[{"characterId":"c1","characterName":"Mia","operation":"create","note":{"id":"note-1","title":"Groceries","text":"Milk, bread","dayLabel":"Sun 12 July","color":"mint"}}]}

ChatGPD chat commit example:
{"simulatedAiChats":[{"characterId":"c1","characterName":"Mia","chat":{"id":"chatgpd-1","title":"Tomatoes","createdAt":"2026-07-12T10:00:00.000Z","messages":[{"role":"user","text":"Are tomatoes fruit?"},{"role":"assistant","text":"Botanically, yes."}]}}]}

Direct-only app actions remain full turns with normal validation, history, undo, and regeneration.`;

export const rpOutputPrompt = `Normal RP is the main story output for the Chat tab.

Use it for visible prose, dialogue, narration, and the normal RP response. This text becomes the chat bubble.

If the RP response includes a final image description metadata object, RPGraph stores that image description in history and hides the metadata from the visible chat bubble.

Normal RP can also contain a phoneMessages JSON object when the story beat truly includes a phone message. Those messages are added to the Phone tab and shown as linked phone activity inside the chat bubble.

Use embedded phoneMessages only when it clearly belongs in the scene, such as a character sending a text, receiving a reply, ordering something, or getting a confirmation. Ordinary dialogue and narration should stay as normal RP prose.

Normal RP can display exactly one stored Storybook/phone-gallery image in the Chat tab without sending a phone message. Add one hidden metadata object at the end of the RP output:
{"displayImageId":"stored_image_id"}

Use displayImageId only for a fitting image ID returned by an image-list/create-image action or clearly established in recent phone/photo history. It displays the image in Chat and does not add a Phone message.

Embedded phone messages use this shape. sendImageId is optional and attaches an outgoing stored Storybook/phone-history image. isVoiceMessage is optional; set it to true only when the sender records the message as a spoken voice message instead of typing it (omitting it means a normal text message):
{"phoneMessages":[{"from":"sender name","to":"recipient name","message":"message text","isVoiceMessage":true,"sendImageId":"name_image_01"}]}

Use sendImageId only for outgoing stored image attachments in Phone messages. Use displayImageId only for showing one stored image in Normal RP. Do not use imageId for outgoing attachments; imageId is reserved for image action commands in the dedicated Phone Message channel.

Normal RP can also comment on an existing social post. Add one standalone JSON object with the post id from the chat history:
{"fotogramPostComment":{"postId":"fotogram-post-01","from":"commenter name","text":"comment text"}}
{"onlyFriendsPostComment":{"postId":"onlyfriends-post-01","from":"commenter name","text":"comment text"}}
The comment appears under that post in the social app. Use it only when the story clearly has someone comment on a specific existing post.

Normal RP can also send a social direct message when the story has someone message a character privately in a social app:
{"fotogramDirectMessages":[{"from":"sender name","to":"recipient name","text":"message text"}]}
{"onlyFriendsDirectMessages":[{"from":"sender name","to":"recipient name","text":"message text","postId":"onlyfriends-post-01","tip":5}]}
from and to are required here. postId optionally links the DM to an existing post from the chat history. tip is optional, OnlyFriends-only, and credits the recipient's wallet.

Output Actions UI commands such as buttons, info boxes, progress bars, context capacity bars, setTab, and setPlayer only work through the Output Actions input, not through Normal RP.`;

export const phoneOutputPrompt = `Phone Message is the dedicated phone channel.

Use it when the graph is generating one phone reply or one phone event instead of a normal RP scene.

The first JSON object should be one small phone message object with from, to, and message fields. It may also include sendImageId when the replying character sends a stored Storybook/phone-history image as an outgoing attachment, and the optional isVoiceMessage set to true when the character records the reply as a spoken voice message instead of typing it.

Example without outgoing image:
{"from":"Mia","to":"Alex","message":"I am outside. Want me to come up?"}

Example voice message:
{"from":"Mia","to":"Alex","message":"Spoken message text.","isVoiceMessage":true}

Example with outgoing stored image:
{"from":"Mia","to":"Alex","message":"I brought proof. Open the door?","sendImageId":"mia_image_01"}

When the latest incoming phone message includes an attached image, the Phone Message output can include a second JSON object after the reply. That second object is an internal image action for the incoming image:
{"imageId":"new_image","imageAction":"create","caption":"20 to 30 word RP image caption"}
{"imageId":"existing_image_id","imageAction":"update","caption":"full replacement 20 to 30 word RP image caption"}
{"imageId":"existing_image_id","imageAction":"no_change"}

When no incoming image is present, the second object is optional and should only be used for updating an existing stored image when recent phone/chat context clearly establishes a new fact about it:
{"imageId":"existing_image_id","imageAction":"update","caption":"full replacement 20 to 30 word RP image caption"}

Keep these concepts separate: sendImageId is an outgoing attachment in the phone message object. imageId belongs only to image action objects. imageAction objects update/create/no-change captions and are not visible phone messages.

The from field is the sender of the generated phone message. The to field is the recipient. Use exact Storybook or phone contact names when they exist. For event-like messages, an outside contact can also be used when sensible, such as a delivery service, ticket office, pizza place, hotel reception, or other named service.

A phone reply can also comment on an existing social post, for example when someone asks for a comment on their post in the chat. Add one extra standalone JSON object after the reply, with the post id from the chat history:
{"fotogramPostComment":{"postId":"fotogram-post-01","from":"commenter name","text":"comment text"}}
{"onlyFriendsPostComment":{"postId":"onlyfriends-post-01","from":"commenter name","text":"comment text"}}
The comment appears under that post in the social app.

A phone reply can also send a social direct message as an extra standalone JSON object, when the conversation clearly moves into a social app DM:
{"fotogramDirectMessages":[{"from":"sender name","to":"recipient name","text":"message text"}]}
{"onlyFriendsDirectMessages":[{"from":"sender name","to":"recipient name","text":"message text","postId":"onlyfriends-post-01","tip":5}]}
from and to are required here. postId optionally links the DM to an existing post; tip is optional and OnlyFriends-only.

Phone Message is not for prose narration. It should produce the message payload that appears in the Phone tab.`;

export const outputActionsPrompt = `Return Output Actions JSON only when the app should show extra UI or timeline actions.

Return either {"actions":[...]} or an empty string if no extra action is needed.

Supported actions:
{"type":"phoneMessage","from":"Name","to":"Name","message":"text message"}
{"type":"phoneMessage","from":"Name","to":"Name","message":"text message","sendImageId":"stored_image_id"}
{"type":"phoneMessage","from":"Name","to":"Name","message":"spoken message text","isVoiceMessage":true}
{"type":"chatMessage","speaker":"Name","text":"visible chat bubble text"}
{"type":"setPlayer","name":"Narrator"}
{"type":"buttons","id":"next_scene_choice","prompt":"How should the story continue?","columns":3,"options":[{"id":"ask","label":"Ask","value":"Ask what happened.","player":"Current"},{"id":"leave","label":"Leave","value":"Leave the road.","player":"Narrator"}]}
{"type":"buttons","id":"offer_choices","prompt":"Generate three choices?","columns":1,"options":[{"id":"generate_choices","label":"Generate 3 choices","text":"","player":"Current","messageFormat":2,"turnMode":0}]}
{"type":"infoBox","title":"Quest updated","text":"Find the spare key before midnight.","tone":"info"}
{"type":"progressBar","title":"Trust","min":0,"max":100,"value":42,"text":"Lara is unsure but listening."}
{"type":"contextCapacity","id":"capacity_1","source":{"type":"contextCompression","index":1},"title":"Context Capacity","showLegend":true}
{"type":"setTab","tab":"chat"}
{"type":"setPlayer","name":"Character Name"}

Buttons start the next immediate run when clicked.
Options may set text, player, messageFormat, and turnMode to control the next immediate run.
For player, use "Narrator", "Current", or a character name/id. Unknown players fall back to Narrator.
Phone messages created by Output Actions use the same outgoing image attachment field as other phone messages: sendImageId. It attaches an existing stored Storybook/phone-history image to the generated phone message. Do not use imageId for new prompts; imageId is kept only as an accepted legacy alias here.
Output Actions can create phone messages, but they do not process imageAction caption update commands. Use imageAction only in the dedicated Phone Message output.
Info boxes, progress bars, and context capacity bars are display-only for now; their values are reserved for later.
For contextCapacity, source.index selects the first, second, etc. Context Compression node in the workflow.
Always use valid JSON with double quotes.
Do not wrap the JSON in markdown.`;

export const socialMediaOutputPrompt = `Social Media is the channel for reactions inside the phone social apps (Fotogram, OnlyFriends).

It is used by Message Format 2 runs. Post slots are Turn Mode 0 = Fotogram and 1 = OnlyFriends. Comment-thread slots are Turn Mode 2 = Fotogram and 3 = OnlyFriends. Direct-message slots are Turn Mode 4 = Fotogram and 5 = OnlyFriends.

A [SOCIAL MEDIA POST] input creates initial reactions:
{"reactions":{"postId":"the post id from the input","likes":14,"comments":[{"from":"Name","text":"comment text"},{"from":"Another Name","text":"comment text"}]}}

Post and thread runs may additionally send incoming direct messages to the post author (or thread actor) as one extra standalone JSON object after the reactions:
{"fotogramDirectMessages":[{"from":"Sender Name","text":"message text","postId":"fotogram-post-01"}]}
{"onlyFriendsDirectMessages":[{"from":"Fan Name","text":"message text","postId":"onlyfriends-post-01","tip":5}]}
postId is optional and links the DM to that post as conversation context; omit it for a general DM. tip is optional, OnlyFriends-only, a positive number credited to the recipient's wallet. On Fotogram incoming DMs are rare (zero or one, only when it fits naturally). On OnlyFriends one to two fan DMs per post are expected.

A [SOCIAL MEDIA THREAD ACTION] input either adds a user comment or loads more comments. Return new reactions to append plus a very short English history summary:
{"reactions":{"postId":"the post id from the input","additionalLikes":2,"comments":[{"from":"Name","text":"new reply"}]},"summary":"Alex complimented Jamie's photo; Jamie thanked Alex while other people joined the thread."}

A [FOTOGRAM DIRECT MESSAGE] input asks the recipient to answer one private Fotogram message. Return the app-specific reply block:
{"fotogramDirectMessage":{"text":"Hey! Yes, I would love to."}}

An [ONLYFRIENDS DIRECT MESSAGE] input asks the recipient to answer one private OnlyFriends message. Return the app-specific reply block; tip is optional:
{"onlyFriendsDirectMessage":{"text":"You look amazing!","tip":10}}

A DM reply may be followed by extra standalone JSON objects, each on its own, not nested inside the DM block:
{"phoneMessages":[{"from":"sender name","to":"recipient name","message":"message text"}]}
{"bankTransfers":[{"from":"sender name","to":"recipient name","amount":20,"note":"reason"}]}

Rules:
- Initial-post likes is a plausible total for the app and audience. Thread additionalLikes is a small increase, usually zero to five.
- Fotogram post reactions use zero to two fitting story characters plus two to three invented NPC friends. Thread reactions may include the post author, fitting story characters, or NPC commenters.
- On someone else's Fotogram post, decide naturally whether the author replies, other commenters react, or the user's comment is ignored while unrelated comments appear.
- On the actor's own Fotogram post, replies usually address the actor directly when that fits the new comment.
- OnlyFriends post and thread reactions use invented fans/subscribers only; story characters never appear in those public reactions. Keep the tone suggestive rather than explicit.
- For direct messages, write only as the specified recipient. Respect their established personality and the existing conversation. Never invent a reply from the sender.
- The DM reply must use the app-specific key: fotogramDirectMessage for Fotogram, onlyFriendsDirectMessage for OnlyFriends. A generic directMessage block is rejected.
- tip is only allowed in onlyFriendsDirectMessage, must be a positive number, and is used only when the sender of the reply genuinely decides to tip the conversation partner. It credits the recipient's OnlyFriends wallet and is not a bank transfer.
- Add a standalone phoneMessages object only when the conversation clearly moves to the phone messenger and the reply actually sends a phone message now.
- Add a standalone bankTransfers object only when money is genuinely transferred now. Mentioning money is not a transfer; never invent amounts. When the reply states that money is sent, the bankTransfers object is required in addition to the DM text.
- When the DM input includes a conversation origin, the sender opened the chat from that exact post comment. Use the supplied post caption, image description, attached post image, and original comment as the subject of the conversation.
- Fotogram and OnlyFriends direct-message conversations are separate. OnlyFriends DMs may be more personal, but must remain non-explicit.
- Each comment needs from (a name) and text. An optional handle field overrides the generated @handle.
- Do not repeat existing comments. New comments stay short and natural.
- For thread actions, summary is mandatory, one short sentence, and is the only text sent to chat history. Summarize what the actor did and any meaningful response without copying the full comment thread or listing background NPC noise.
- Always use valid JSON with double quotes. Do not wrap the JSON in markdown. Do not add prose.`;

export const outputFormatHelp = {
  rp: {
    title: 'RP Text Input Format',
    description:
      'Overview of what the Normal RP input accepts and how it is shown in the Chat tab.',
    prompt: rpOutputPrompt,
  },
  phone: {
    title: 'Phone Message Format',
    description:
      'Overview of what the dedicated Phone Message input accepts and how it is shown in the Phone tab.',
    prompt: phoneOutputPrompt,
  },
  'output-actions': {
    title: 'Output Actions Format',
    description:
      'Use this prompt in the Simple Prompt node that writes extra app actions. Phone and chat messages are added to the timeline; choices and UI items are displayed by the app.',
    prompt: outputActionsPrompt,
  },
  'social-media': {
    title: 'Social Media Format',
    description:
      'Use this prompt in the LLM Prompt Switch channel that reacts to social app activity (Fotogram, OnlyFriends). The JSON reactions are applied to the post in the app and recorded in the chat history.',
    prompt: socialMediaOutputPrompt,
  },
  'direct-actions': {
    title: 'Direct Actions Format',
    description:
      'Direct Actions accepts the same app-action JSON as Output Actions plus phone-app commit payloads. It is only evaluated on explicit direct-only runs and never calls an LLM.',
    prompt: outputActionsPrompt,
  },
  'user-input': {
    title: 'User Input Guide',
    description:
      'Current meaning of every User Input output, including prompt routing and the LLM-free Direct Actions path.',
    prompt: userInputOverview,
  },
  'rp-output': {
    title: 'RP Output Guide',
    description:
      'Current meaning of every RP Output input and the difference between normal generated output, Output Actions, and Direct Actions.',
    prompt: rpOutputOverview,
  },
} satisfies Record<OutputFormatHelpKind, {
  title: string;
  description: string;
  prompt: string;
}>;
