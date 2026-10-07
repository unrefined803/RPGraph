import { portraitAuthoringInstructions } from './portraitInstructions';
import { agencyAuthoringInstructions } from './agency';
import { relationshipAuthoringInstructions } from './relationships';
import { applyAssistantPatchOperation } from '../nodes/rp-storybook/model';
import { parseStorybookAssistantJson } from '../storybook/assistantJson';
import { characterPayload, normalizeCharacterApps, validateCharacterPayload, type Character } from './character';
import { createCharacterContainer } from './creator';
import { validateCharacterAccountDirectory } from './profiles';
import { withCharacterPortrait } from './portrait';
import { faceCropFromEstimate, faceEstimate, type FaceEstimate } from './faceCrop';

export type CharacterDestination = 'characters' | 'npc-characters' | 'account-npc-characters';
export type CharacterAssistantMessage = {
  role: 'user' | 'assistant' | 'error';
  text: string;
  /** Authoring stage the next user message belongs to: a pending question or a failed attempt. */
  stage?: CharacterAuthoringStep;
  /** Stage offered as a Continue action after this reply. */
  nextStage?: CharacterAuthoringStep;
  /** The rejected request, offered as a Retry action on an error. */
  retryMessage?: string;
};
function assertNoEmbeddedMedia(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype', 'dataUrl', 'sampleDataUrl'].includes(key)) {
      throw new Error('Binary media and reserved properties are managed by the application.');
    }
    assertNoEmbeddedMedia(nested);
  }
}

/** Models wrap JSON in fences or prose; take the outermost object and repair known escaping slips. */
function assistantResponseJson(text: string) {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('The model did not return JSON.');
  return parseStorybookAssistantJson(stripped.slice(start, end + 1));
}

/** Rejected attempts stay visible to the model so a repeated request can correct them. */
export function characterAssistantConversation(messages: CharacterAssistantMessage[], limit: number) {
  return messages.slice(-limit).map((message) => `${message.role === 'error' ? 'app error' : message.role}: ${message.text}`).join('\n');
}

const editableFields = new Set(['name', 'age', 'gender', 'description', 'personality', 'speechStyle', 'hiddenAgency', 'agencyTags', 'relationships',
  'role', 'banking', 'phoneSettings', 'comfyConfig', 'apps', 'profileImage', 'customPortraits']);

export function newAssistantCharacter(): Character {
  const id = crypto.randomUUID();
  return { id, name: 'New Character', description: '', personality: '', speechStyle: '', hiddenAgency: '', relationships: [], role: '',
    playable: false, images: [], apps: normalizeCharacterApps({}, undefined, id, 'New Character') };
}

/** The model sees stable media references, never gallery or voice bytes. */
export function characterAssistantProjection(character: Character) {
  const { images, playable: _playable, voiceConfig: _voice, ...fields } = characterPayload(structuredClone(character));
  return { character: fields, images: Object.fromEntries(images.map((image) => [image.id,
    { name: image.name, description: image.description }])) };
}

export function validateAssistantCharacter(character: Character) {
  validateCharacterPayload(character);
  validateCharacterAccountDirectory([character]);
  if (character.banking && (!Number.isFinite(character.banking.startBalance) ||
    !Array.isArray(character.banking.fixedExpenses) || character.banking.fixedExpenses.some((expense) =>
      typeof expense.label !== 'string' || !expense.label.trim() || !Number.isFinite(expense.amount)))) {
    throw new Error('Banking requires a finite balance and named expenses with finite amounts.');
  }
  if (character.comfyConfig && (typeof character.comfyConfig.loraName !== 'string' ||
    typeof character.comfyConfig.appearance !== 'string' ||
    (character.comfyConfig.loraUrl !== undefined && typeof character.comfyConfig.loraUrl !== 'string'))) {
    throw new Error('Image generation settings require text fields.');
  }
  if (character.phoneSettings && typeof character.phoneSettings.wallpaperId !== 'string') {
    throw new Error('Phone settings require a wallpaper ID string.');
  }
  for (const [app, account] of Object.entries(normalizeCharacterApps(character.apps, character.social, character.id, character.name))) {
    if (!account.enabled) continue;
    if ((app !== 'whatsup' && (!account.profileName?.trim() || account.profileName.length > 60)) || account.bio.length > 500) {
      throw new Error(`${app}: enter a profile name of 1–60 characters and a bio of at most 500 characters.`);
    }
    if (app === 'matchme' && !character.apps?.matchme?.profile) throw new Error('MatchMe requires a complete profile.');
    const profile = app === 'matchme' ? (account as NonNullable<Character['apps']>['matchme'])?.profile : undefined;
    if (profile && (profile.interests.length > 150 || profile.name !== account.profileName || profile.bio !== account.bio)) {
      throw new Error('MatchMe profile name and bio must match the account; interests allow at most 150 characters.');
    }
  }
  return createCharacterContainer(character, true);
}

/** Face positions a vision model reported, keyed by the gallery image they were seen in. */
function assistantFaces(value: unknown, character: Character) {
  const faces = new Map<string, FaceEstimate>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return faces;
  for (const [imageId, entry] of Object.entries(value)) {
    const face = faceEstimate(entry);
    if (face && character.images.some((image) => image.id === imageId)) faces.set(imageId, face);
  }
  return faces;
}

/**
 * Frame every round avatar that shows an image with a reported face: the
 * portrait, the WhatsUp second-account picture and the MatchMe avatar.
 */
function withAssistantFaceCrops(character: Character, faces: Map<string, FaceEstimate>): Character {
  if (!faces.size) return character;
  const crop = (imageId: string | undefined) => {
    const image = character.images.find((entry) => entry.id === imageId);
    const face = image && faces.get(image.id);
    return image && face ? faceCropFromEstimate(image, face) : undefined;
  };
  const next = structuredClone(character);
  const portraitCrop = crop(next.profileImage?.imageId);
  if (next.profileImage && portraitCrop) next.profileImage.crop = portraitCrop;
  for (const portrait of Object.values(next.customPortraits ?? {})) {
    const faceCrop = crop(portrait.imageId);
    if (faceCrop) portrait.crop = faceCrop;
  }
  return next;
}

/** Apply a complete response transactionally, preserving binary data and existing identities. */
export function parseCharacterAssistantResult(text: string, current: Character) {
  const response = assistantResponseJson(text) as { reply?: unknown; patch?: unknown; faces?: unknown; steps?: unknown };
  if (!response || typeof response.reply !== 'string' || !Array.isArray(response.patch)) {
    throw new Error('The assistant must return a reply string and a JSON Patch array.');
  }
  const steps = response.steps ?? [];
  if (!Array.isArray(steps) || steps.some((step) => step !== 'profile' && step !== 'accounts') ||
      new Set(steps).size !== steps.length || (steps.length === 2 && steps[0] !== 'profile')) {
    throw new Error('Assistant steps must be profile followed by accounts, without duplicates.');
  }
  const faces = assistantFaces(response.faces, current);
  if (!response.patch.length) {
    const framed = withAssistantFaceCrops(current, faces);
    if (framed !== current) validateAssistantCharacter(framed);
    return { character: framed, reply: response.reply, steps: steps as CharacterAuthoringStep[] };
  }
  const projection = characterAssistantProjection(current);
  for (const [index, operation] of response.patch.entries()) {
    if (!operation || !['add', 'replace', 'remove', 'test'].includes(operation.op) || typeof operation.path !== 'string') {
      throw new Error('Use only add, replace, remove or test operations.');
    }
    const parts = operation.path.split('/').slice(1).map((part: string) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    const allowed = parts[0] === 'character' && editableFields.has(parts[1]) ||
      parts[0] === 'images' && parts.length === 3 && Object.prototype.hasOwnProperty.call(projection.images, parts[1]) && ['name', 'description'].includes(parts[2]);
    if (!allowed || parts.some((part: string) => ['__proto__', 'prototype', 'constructor', 'dataUrl', 'sampleDataUrl', 'accountId', 'legacyHandles', 'avatarImageId', 'avatarCrop'].includes(part))) {
      throw new Error(`The assistant cannot edit ${operation.path}. No changes were applied.`);
    }
    assertNoEmbeddedMedia(operation.value);
    try {
      // A fresh draft lacks optional fields such as age or the portrait; replace on those is an upsert.
      applyAssistantPatchOperation(projection, operation);
    } catch (error) {
      throw Object.assign(new Error(`Patch operation ${index + 1} (${operation.path}) failed: ${error instanceof Error ? error.message : String(error)}`), { cause: error });
    }
  }
  const next = { ...current, ...projection.character, images: current.images.map((image) => ({ ...image, ...projection.images[image.id] })) } as Character;
  // Optional fields removed by a patch must not survive the merge with the source.
  for (const field of editableFields) {
    if (!Object.prototype.hasOwnProperty.call(projection.character, field)) delete (next as unknown as Record<string, unknown>)[field];
  }
  next.playable = false;
  delete next.social;
  if (!next.apps || typeof next.apps !== 'object' || Array.isArray(next.apps)) throw new Error('apps must be an object.');
  const defaults = normalizeCharacterApps({}, undefined, current.id, next.name);
  next.apps = { ...defaults, ...next.apps };
  for (const [app, account] of Object.entries(next.apps)) {
    if (!account || typeof account !== 'object' || Array.isArray(account)) throw new Error('App accounts must be objects.');
    const previous = current.apps?.[app as keyof NonNullable<Character['apps']>];
    if (previous && account.accountId !== previous.accountId) throw new Error('Existing account IDs cannot change.');
    account.accountId = previous?.accountId ?? `character:${current.id}:${app}`;
    if (previous) {
      account.legacyHandles = normalizeCharacterApps(current.apps, current.social, current.id, current.name)[app as keyof NonNullable<Character['apps']>]?.legacyHandles;
    }
    const existingPosts = new Set(previous?.initialPosts?.map((post) => post.id));
    for (const post of account.initialPosts ?? []) {
      if (!existingPosts.has(post.id)) post.id = crypto.randomUUID();
    }
  }
  if (next.profileImage) {
    const image = next.images.find((entry) => entry.id === next.profileImage?.imageId);
    if (!image) throw new Error('The portrait must reference an existing gallery image.');
    if (current.profileImage?.imageId !== next.profileImage.imageId) delete next.profileImage.crop;
    next.profileImage = { ...next.profileImage, dataUrl: image.dataUrl };
  }
  for (const [id, portrait] of Object.entries(next.customPortraits ?? {})) {
    const image = next.images.find((entry) => entry.id === portrait.imageId);
    if (!image) throw new Error('Custom portraits must reference existing gallery images.');
    if (current.customPortraits?.[id as keyof NonNullable<Character['customPortraits']>]?.imageId !== portrait.imageId) delete portrait.crop;
    portrait.dataUrl = image.dataUrl;
  }
  const framed = withAssistantFaceCrops(next, faces);
  validateAssistantCharacter(framed);
  return { character: framed, reply: response.reply, steps: steps as CharacterAuthoringStep[] };
}

export function characterAssistantPrompt(character: Character, messages: CharacterAssistantMessage[], instruction: string,
  attachmentIds: string[], destination: CharacterDestination) {
  return [
    'You are the Character Assistant inside RPGraph. Author exactly one Character Container V2, used for both playable characters and NPCs. This is an editor, not an in-game actor.',
    'Return only JSON: {"reply":"short answer","patch":[{"op":"replace","path":"/character/name","value":"New name"}]}. No markdown. For questions or ambiguous requests, answer in reply with patch: [].',
    'Creating a new character is staged work. For a request to create or invent a character, return steps:["profile"] and patch:[]: a profile specialist then writes the identity and personality, and the app offers the user the following stages itself: describing the gallery images, then accounts, profile names, image assignments and agency tags. Do not draft the profile, image descriptions, accounts or agencyTags yourself in that reply, and do not announce them as done. For a larger request about only the accounts, posts, image assignments or agency tags of an existing character you may return steps:["accounts"]. For ordinary questions, requests needing clarification, or targeted edits, answer or patch directly and omit steps. Never claim delegated work is already complete.',
    'Use RFC 6902 add, replace, remove and test with RFC 6901 paths. Patch only requested fields. Do not replace the document root, /character, /images or entire gallery entries. Use add for a field that is not shown in the current draft (a new draft has no age, gender, agencyTags, banking or profileImage yet); add also overwrites an existing value. All operations form one validated, undoable edit.',
    'The application owns character.id, accountId, image IDs, binary media and filesystem access. Never edit these or emit image bytes, URLs, paths, voiceConfig or legacy social fields. Existing IDs remain stable across renames. New account IDs and new post IDs are allocated by the application. When adding an account, omit accountId; when replacing an existing account object preserve its accountId exactly.',
    'Editable /character fields: name, description, personality, speechStyle, hiddenAgency, role (strings), age (number), gender (woman/man/nonbinary), relationships and agencyTags (arrays), apps, profileImage, banking, phoneSettings and comfyConfig. Preserve unrelated fields. Write authored character text, names and captions in English; answer the user in their language.',
    relationshipAuthoringInstructions,
    agencyAuthoringInstructions,
    'hiddenAgency is author-only free text for concealed motivations, priorities, boundaries and relationships. It is not a runtime command and never triggers messages, posts, transactions or autonomous actions.',
    'banking shape: {"startBalance":1000,"fixedExpenses":[{"label":"Mobile plan","amount":24.99}]}. For a new authored character choose a plausible balance and one mobile plan expense fitting their circumstances. Preserve existing banking unless asked. comfyConfig shape: {"loraName":"","loraUrl":"","appearance":"visual appearance for image generation"}; do not invent LoRA files or URLs.',
    'MatchMe has an optional editable account.profileName. When omitted, use the real character.name; an explicit name takes precedence even when it differs from the real identity. Default new dating profiles to the real name, adult age and gender unless a different persona is requested. Dating profile age and gender may differ from character-level age and gender. Keep the real character identity unchanged when editing an app persona. Public MatchMe labels show the dating first name and age, without @. Keep historical aliases and IDs unchanged.',
    'apps keys: whatsup, fotogram (also called Photogram), onlyfriends, matchme. WhatsUp and Fotogram are standard; OnlyFriends and MatchMe are optional. Account fields: enabled (boolean), profileName, bio, optional portraitId and initialPosts. Username, display name, nickname and profile name all mean profileName. Fotogram and OnlyFriends support privacyMode (boolean, default false); set true to hide the real name publicly while showing the selected portrait, preserving character.name and using profileName. WhatsUp has no profileName and uses the real character name. Existing accounts have immutable accountId. Profile name is 1–60 characters, spaces allowed; bio is at most 500. Keep legacyHandles and accountId unchanged; they preserve old message routing. Use enabled:false to disable a standard account. Optional accounts may be removed.',
    'WhatsUp second account: apps.whatsup.alias is {"name":"Other Name","portraitId":"custom1"}. The custom portrait must already exist. The second name is a separate link to the same inbox; use 1–60 characters, distinct from the real name. Add it only when requested or required by the character concept. Removing alias removes the second account. Preserve existing identities and conversations.',
    'MatchMe additionally requires profile: {"age":25,"gender":"woman","seeking":["man"],"bio":"About me","interests":"Music, hiking","photoIds":["existing-image-id"],"decisions":{}}. The only name is account.profileName; do not duplicate it inside profile. Match profile bio to account bio. Age must be an integer 18–120, interests at most 150 characters, and enabled profiles need one to three unique gallery photo IDs. One photo is sufficient. With no photos prepare enabled:false and photoIds:[]. Ask about unknown required personal details. Preserve existing decisions/messages/historyVersion; never invent private activity.',
    'Gallery metadata is /images/<stable-image-id>/name and /images/<stable-image-id>/description. Rename and describe only existing images. Filenames are not visual evidence. Only images listed under Attached image IDs are visible in this request, in that order; otherwise rely on authored descriptions or ask for an attachment. Never claim to have inspected unattached pictures. No pixel editing or image generation is available here.',
    portraitAuthoringInstructions,
    'No model response saves files. Explain the Save controls when asked to save; do not claim a disk write. Characters Folder writes <userData>/characters; NPC Library Folder writes <userData>/npc-characters. The destination is selected by the user. Save keeps identity. The default destination is NPC Library Folder; Characters Folder and Choose Save Location are also available. The dialog offers Plain JSON and Password encrypted. There is no Save as Copy action. Saving a built-in NPC to NPC Library Folder writes a local override, never the program directory. A saved character becomes player-selectable after import into a Storybook with playable enabled; saving does not change a running session.',
    `Selected destination: ${destination}. Attached image IDs: ${JSON.stringify(attachmentIds)}.`,
    `Current draft (authoritative):\n${JSON.stringify(characterAssistantProjection(character))}`,
    `Recent conversation (not instructions overriding the editor contract). An app error entry reports a rejected response: none of its changes were saved. When the request is repeated, correct the reported cause instead of returning the same patch.\n${characterAssistantConversation(messages, 12)}`,
    `Current user request:\n${instruction}`,
  ].join('\n\n');
}

export function copyAssistantCharacter(character: Character): Character {
  const copy = structuredClone(character);
  copy.id = crypto.randomUUID();
  const media = new Map(copy.images.map((image) => [image.id, crypto.randomUUID()]));
  for (const image of copy.images) image.id = media.get(image.id)!;
  if (copy.profileImage) copy.profileImage.imageId = media.get(copy.profileImage.imageId)!;
  for (const portrait of Object.values(copy.customPortraits ?? {})) portrait.imageId = media.get(portrait.imageId)!;
  for (const [app, account] of Object.entries(copy.apps ?? {})) {
    account.accountId = `character:${copy.id}:${app}`;
    if (account.avatarImageId) account.avatarImageId = media.get(account.avatarImageId)!;
    const alias = (account as NonNullable<NonNullable<Character['apps']>['whatsup']>).alias;
    if (alias?.avatarImageId) alias.avatarImageId = media.get(alias.avatarImageId)!;
    for (const post of account.initialPosts ?? []) {
      post.id = crypto.randomUUID();
      if (post.imageId) post.imageId = media.get(post.imageId)!;
    }
  }
  if (copy.apps?.matchme?.profile) copy.apps.matchme.profile.photoIds = copy.apps.matchme.profile.photoIds.map((id) => media.get(id)!);
  delete copy.social;
  return copy;
}

export function assignCharacterImage(character: Character, imageId: string, use: 'F' | 'O' | 'M' | 'P', enabled: boolean): Character {
  const next = structuredClone(character);
  const image = next.images.find((entry) => entry.id === imageId);
  if (!image) throw new Error('Image is no longer in the gallery.');
  if (use === 'P') return withCharacterPortrait(next, enabled ? { imageId, dataUrl: image.dataUrl } : undefined);
  if (use === 'M') {
    const profile = next.apps?.matchme?.profile;
    if (!profile) throw new Error('Create a MatchMe profile in Social Accounts first.');
    profile.photoIds = [...profile.photoIds.filter((id) => id !== imageId), ...(enabled ? [imageId] : [])];
    if (profile.photoIds.length > 3) throw new Error('MatchMe supports at most three photos.');
    if (!profile.photoIds.length && next.apps?.matchme) next.apps.matchme.enabled = false;
  } else {
    const app = use === 'F' ? 'fotogram' : 'onlyfriends';
    const account = next.apps?.[app];
    if (!account) throw new Error(`Create the ${app} account in Social Accounts first.`);
    const posts = account.initialPosts ?? [];
    account.initialPosts = enabled
      ? posts.some((post) => post.imageId === imageId) ? posts : [...posts, { id: crypto.randomUUID(), text: image.description, imageId }]
      : posts.filter((post) => post.imageId !== imageId);
    if (enabled) account.enabled = true;
  }
  return next;
}


export type CharacterAuthoringStep = 'profile' | 'images' | 'accounts';

/** A new draft keeps its generated Fotogram name until the accounts stage has run. */
export function accountsStagePending(character: Character) {
  const placeholder = normalizeCharacterApps({}, undefined, character.id, 'New Character').fotogram?.profileName;
  return character.apps?.fotogram?.profileName === placeholder;
}

/** Gallery images the assistant has not described yet. */
export function undescribedCharacterImages(character: Character) {
  return character.images.filter((image) => !image.description.trim());
}

/** Images one stage request shows to the model. */
export const imageStageBatchSize = 6;

/**
 * Stage to offer after a reply. Images are described once the profile says who the
 * character is and before accounts use them; each stage starts only when the user continues.
 */
export function nextCharacterAuthoringStage(previous: Character, next: Character, ran: CharacterAuthoringStep | undefined,
  options: { vision: boolean; requested?: CharacterAuthoringStep }): CharacterAuthoringStep | undefined {
  if (next.name === 'New Character' && !next.description.trim()) return undefined;
  const remaining = undescribedCharacterImages(next).length;
  // A description run that made no progress must not offer itself again.
  if (options.vision && remaining && !(ran === 'images' && remaining >= undescribedCharacterImages(previous).length)) return 'images';
  const changed = JSON.stringify(characterAssistantProjection(next)) !== JSON.stringify(characterAssistantProjection(previous));
  return ran !== 'accounts' && (options.requested === 'accounts' || (changed && accountsStagePending(next))) ? 'accounts' : undefined;
}

const stepRoles: Record<CharacterAuthoringStep, string> = {
  profile: 'character profile', images: 'image description', accounts: 'accounts, image assignment and agency tags',
};
const stepExamplePaths: Record<CharacterAuthoringStep, string> = {
  profile: '/character/description', images: '/images/existing-image-id/description', accounts: '/character/apps/fotogram/bio',
};
const stepScopes: Record<CharacterAuthoringStep, RegExp> = {
  profile: /^\/character\/(name|age|gender|role|description|personality|speechStyle|hiddenAgency|relationships|banking)(\/|$)/,
  images: /^\/images\/[^/]+\/(name|description)$/,
  accounts: /^\/character\/(agencyTags|apps|profileImage|customPortraits)(\/|$)|^\/images\//,
};

function characterAuthoringStepPrompt(step: CharacterAuthoringStep, character: Character, instruction: string, attachmentIds: string[]) {
  const projection = characterAssistantProjection(character);
  const { apps: _apps, profileImage: _portrait, customPortraits: _customPortraits, agencyTags: _tags, ...profile } = projection.character;
  const galleryEmpty = character.images.length === 0;
  const instructions: Record<CharacterAuthoringStep, string[]> = {
    profile: [
      'Edit only /character/name, age, gender (woman/man/nonbinary), role, description, personality, speechStyle, hiddenAgency, relationships and banking. Text fields are strings; age is a number. Banking: {"startBalance":1000,"fixedExpenses":[{"label":"Mobile plan","amount":24.99}]}. For a new character set name, age, gender, role, description, personality, speechStyle and banking; use the details the user gave and choose plausible fictional details for the rest. Attached images show the character: let the visible appearance inform the description. Do not edit accounts, agencyTags, gallery or portrait, and do not describe or rename images, even when the request mentions them: later stages handle them, so do not claim them in reply. Preserve existing details unless asked. If essential intent is unclear, ask a question and return an empty patch.',
      relationshipAuthoringInstructions,
    ],
    images: [
      'Edit only /images/<attached-image-id>/description and /images/<attached-image-id>/name. Describe every attached image: one add operation for its description and one for a short readable name. A description states the visible content in one or two English sentences: who is shown, clothing, pose, setting and mood. The character profile below tells you who this character is; when a person in the image plausibly is this character, name them. Describe other people neutrally and never invent names for them. Describe only what is visible, never filenames. Do not assign portraits, avatars or posts and do not edit the character or accounts: the accounts stage uses your descriptions afterwards. If no image is attached, return an empty patch and say that the images must be attached.',
    ],
    accounts: [
      'Edit only /character/agencyTags, /character/apps, /character/profileImage, /character/customPortraits and /images/<existing-id>/name or description. Keep character identity and profile text unchanged. WhatsUp and Fotogram are standard; only create OnlyFriends or MatchMe if requested. Account shape: {"enabled":true,"profileName":"Artist name","bio":""}. Preserve existing accountId on replacement; omit accountId on a new account (the app assigns it). Never change an accountId path. Username, display name and nickname mean profileName. WhatsUp has no profileName. Profile names: 1–60 characters, spaces allowed; bios: at most 500.',
    'WhatsUp second account: apps.whatsup.alias is {"name":"Other Name","portraitId":"custom1"}. The custom portrait must already exist. The second name is a separate link to the same inbox; use 1–60 characters, distinct from the real name. Add it only when requested or required by the character concept. Removing alias removes the second account. Preserve existing identities and conversations.',
      ...(accountsStagePending(character) ? [
        'This character was just created. Its Fotogram profileName starting with "new.character." is an app placeholder: always replace it with a profile name that fits the character, and write a short Fotogram bio.',
        'Before patching, check the user request and conversation for two decisions: (1) which optional accounts the character gets (OnlyFriends, MatchMe, or none) and (2) its agency tags. Statements such as "only the standard accounts", "no other accounts" or "you choose" are decisions. If a decision was never addressed, return patch [] and ask for exactly the missing decisions in one short question; propose a concrete answer (for example two fitting tag IDs with their meaning) so the user can simply agree. When both are decided, do everything in one patch: Fotogram profile name and bio, the chosen optional accounts, the image assignments, and /character/agencyTags.',
      ] : []),
      galleryEmpty
        ? 'The gallery is empty. Still create the accounts and tags, without portrait, avatars or image posts, and tell the user in reply that no images exist yet and that adding some enables a portrait, profile photos and image posts. MatchMe needs a photo: if it was requested, save it as a disabled draft (enabled:false, photoIds:[]) and say that it becomes active once a photo is added.'
        : 'Use the gallery when configuring accounts. Attached images are visible to you: look at them, and use descriptions for the others. Unless the user names a specific image for a use, decide yourself which image fits where. Portrait (/character/profileImage, when none is set): the image that shows the character alone and most clearly, ideally the face. Fotogram: an everyday or lifestyle image that suits a public feed, as a post or custom portrait. MatchMe: one to three flattering photos that clearly show the character. OnlyFriends: images that suit that account. One image may serve several uses, and not every image must be used. Mention in reply which image you chose for what. An image that is neither attached nor described is unknown: do not assign it, and tell the user to describe it first.',
      agencyAuthoringInstructions,
      portraitAuthoringInstructions,
      'MatchMe account additionally needs profile:{"age":25,"bio":"About me","interests":"Music","photoIds":["existing-id"],"decisions":{}}. Keep the optional dating name only in account.profileName; omitted names default to character.name. Dating age and gender can differ from the real character, but default to the real adult identity unless otherwise requested. profile.bio matches account.bio. Integer age 18–120; interests at most 150 characters; one to three unique photos. Optional gender and seeking use woman/man/nonbinary (seeking is an array). With no photo, save enabled:false and photoIds:[]. Enabled MatchMe requires at least one photo. Preserve existing decisions/messages/historyVersion. Ask about missing required personal details instead of inventing them.',
    ],
  };
  return [
    `You are RPGraph's ${stepRoles[step]} authoring specialist. Complete only this step.`,
    `Return JSON only: ${JSON.stringify({ reply: 'brief result or clarification', patch: [{ op: 'add', path: stepExamplePaths[step], value: '...' }] })}. Use add/replace/remove/test JSON Patch. Use add when a field is not shown in the current draft; add also overwrites an existing value. No steps or delegation. Work on exactly one existing character; preserve its identity. Write authored content in English. Answer the user in their language.`,
    ...instructions[step],
    'No filesystem writes, gameplay actions, binary data or playable edits. Never claim the character is saved. An empty patch asks for clarification and pauses the work.',
    `Attached image IDs (in order): ${JSON.stringify(attachmentIds)}.`,
    `Current draft: ${JSON.stringify(step === 'profile' ? { character: profile } : step === 'images' ? { character: profile, images: projection.images } : projection)}`,
    `User request and conversation: ${instruction}`,
  ].join('\n\n');
}

/** Run one specialist on a draft; the caller commits its result before offering the next stage. */
export async function runCharacterAuthoringStep(step: CharacterAuthoringStep, character: Character, instruction: string,
  attachmentIds: string[], complete: (prompt: string) => Promise<string>) {
  const text = await complete(characterAuthoringStepPrompt(step, character, instruction, attachmentIds));
  const raw = assistantResponseJson(text) as { steps?: unknown[]; patch?: unknown };
  if (raw.steps?.length) throw new Error('Specialists cannot delegate further steps.');
  if (!Array.isArray(raw.patch)) throw new Error(`The ${step} specialist must return a JSON Patch array.`);
  const outside = raw.patch.map((operation: { path?: string }) => operation?.path ?? '').filter((path) => !stepScopes[step].test(path));
  if (outside.length) throw new Error(`The ${step} specialist tried to edit fields outside its step: ${outside.join(', ') || 'missing path'}.`);
  const result = parseCharacterAssistantResult(text, character);
  // An empty patch is a clarifying question; the stage stays open for the answer.
  return { character: result.character, reply: result.reply, asked: raw.patch.length === 0 };
}
