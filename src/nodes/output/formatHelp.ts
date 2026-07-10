export type OutputFormatHelpKind = 'rp' | 'phone' | 'output-actions' | 'social-media';

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

It is used by Message Format 3 runs. Post slots are Turn Mode 0 = Fotogram and 1 = OnlyFriends. Comment-thread slots are Turn Mode 2 = Fotogram and 3 = OnlyFriends.

A [SOCIAL MEDIA POST] input creates initial reactions:
{"reactions":{"postId":"the post id from the input","likes":14,"comments":[{"from":"Name","text":"comment text"},{"from":"Another Name","text":"comment text"}]}}

A [SOCIAL MEDIA THREAD ACTION] input either adds a user comment or loads more comments. Return new reactions to append plus a very short English history summary:
{"reactions":{"postId":"the post id from the input","additionalLikes":2,"comments":[{"from":"Name","text":"new reply"}]},"summary":"Alex complimented Jamie's photo; Jamie thanked Alex while other people joined the thread."}

Rules:
- Initial-post likes is a plausible total for the app and audience. Thread additionalLikes is a small increase, usually zero to five.
- Fotogram post reactions use zero to two fitting story characters plus two to three invented NPC friends. Thread reactions may include the post author, fitting story characters, or NPC commenters.
- On someone else's Fotogram post, decide naturally whether the author replies, other commenters react, or the user's comment is ignored while unrelated comments appear.
- On the actor's own Fotogram post, replies usually address the actor directly when that fits the new comment.
- OnlyFriends uses invented fans/subscribers only; story characters never appear there. Keep the tone suggestive rather than explicit.
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
} satisfies Record<OutputFormatHelpKind, {
  title: string;
  description: string;
  prompt: string;
}>;
