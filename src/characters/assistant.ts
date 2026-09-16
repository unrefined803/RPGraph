import { agencyAuthoringInstructions } from './agency';
import { relationshipAuthoringInstructions } from './relationships';
import { applyJsonPatchOperation } from '../nodes/rp-storybook/model';
import { characterPayload, normalizeCharacterApps, validateCharacterPayload, type Character } from './character';
import { createCharacterContainer } from './creator';
import { validateCharacterAccountDirectory } from './profiles';
import { withCharacterPortrait } from './portrait';

export type CharacterDestination = 'characters' | 'npc-characters';
export type CharacterAssistantMessage = { role: 'user' | 'assistant' | 'error'; text: string };
function assertNoEmbeddedMedia(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype', 'dataUrl', 'sampleDataUrl'].includes(key)) {
      throw new Error('Binary media and reserved properties are managed by the application.');
    }
    assertNoEmbeddedMedia(nested);
  }
}

const editableFields = new Set(['name', 'age', 'gender', 'description', 'personality', 'speechStyle', 'hiddenAgency', 'agencyTags', 'relationships',
  'role', 'banking', 'phoneSettings', 'comfyConfig', 'apps', 'profileImage']);

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

/** Apply a complete response transactionally, preserving binary data and existing identities. */
export function parseCharacterAssistantResult(text: string, current: Character) {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const response = JSON.parse(stripped) as { reply?: unknown; patch?: unknown; autoCrop?: unknown; steps?: unknown };
  if (!response || typeof response.reply !== 'string' || !Array.isArray(response.patch)) {
    throw new Error('The assistant must return a reply string and a JSON Patch array.');
  }
  const steps = response.steps ?? [];
  if (!Array.isArray(steps) || steps.some((step) => step !== 'profile' && step !== 'accounts') ||
      new Set(steps).size !== steps.length || (steps.length === 2 && steps[0] !== 'profile')) {
    throw new Error('Assistant steps must be profile followed by accounts, without duplicates.');
  }
  if (!response.patch.length) return { character: current, reply: response.reply, autoCrop: response.autoCrop === true, steps: steps as CharacterAuthoringStep[] };
  const projection = characterAssistantProjection(current);
  for (const operation of response.patch) {
    if (!operation || !['add', 'replace', 'remove', 'test'].includes(operation.op) || typeof operation.path !== 'string') {
      throw new Error('Use only add, replace, remove or test operations.');
    }
    const parts = operation.path.split('/').slice(1).map((part: string) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    const allowed = parts[0] === 'character' && editableFields.has(parts[1]) ||
      parts[0] === 'images' && parts.length === 3 && Object.prototype.hasOwnProperty.call(projection.images, parts[1]) && ['name', 'description'].includes(parts[2]);
    if (!allowed || parts.some((part: string) => ['__proto__', 'prototype', 'constructor', 'dataUrl', 'sampleDataUrl', 'accountId', 'legacyHandles'].includes(part))) {
      throw new Error(`The assistant cannot edit ${operation.path}. No changes were applied.`);
    }
    assertNoEmbeddedMedia(operation.value);
    // Portrait selection is an upsert even when a model uses replace on a fresh draft.
    const portraitSelection = operation.op === 'replace' && operation.path === '/character/profileImage' && !projection.character.profileImage;
    applyJsonPatchOperation(projection, portraitSelection ? { ...operation, op: 'add' } : operation);
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
  validateAssistantCharacter(next);
  return { character: next, reply: response.reply, autoCrop: response.autoCrop === true, steps: steps as CharacterAuthoringStep[] };
}

export function characterAssistantPrompt(character: Character, messages: CharacterAssistantMessage[], instruction: string,
  attachmentIds: string[], destination: CharacterDestination) {
  return [
    'You are the Character Assistant inside RPGraph. Author exactly one Character Container V2, used for both playable characters and NPCs. This is an editor, not an in-game actor.',
    'Return only JSON: {"reply":"short answer","patch":[{"op":"replace","path":"/character/name","value":"New name"}]}. No markdown. For questions or ambiguous requests, answer in reply with patch: [].',
    'For creating a new character from an empty draft, return steps:["profile","accounts"] and patch:[] to delegate sequential work. A profile specialist first writes the identity and personality; an accounts specialist then configures accounts, image descriptions and posts using that profile. You may request just one specialist with steps:["profile"] or steps:["accounts"]. Do not also draft the delegated fields yourself. For ordinary questions, requests needing clarification, or targeted edits, answer or patch directly and omit steps. Never claim delegated steps are already complete. Only request the accounts step when the user asks for accounts/posts or full character creation; optional accounts require user intent.',
    'Use RFC 6902 add, replace, remove and test with RFC 6901 paths. Patch only requested fields. Do not replace the document root, /character, /images or entire gallery entries. Use add for an optional field that does not exist. All operations form one validated, undoable edit.',
    'The application owns character.id, accountId, image IDs, binary media and filesystem access. Never edit these or emit image bytes, URLs, paths, voiceConfig or legacy social fields. Existing IDs remain stable across renames. New account IDs and new post IDs are allocated by the application. When adding an account, omit accountId; when replacing an existing account object preserve its accountId exactly.',
    'Editable /character fields: name, description, personality, speechStyle, hiddenAgency, role (strings), age (number), gender (woman/man/nonbinary), relationships and agencyTags (arrays), apps, profileImage, banking, phoneSettings and comfyConfig. Preserve unrelated fields. Write authored character text, names and captions in English; answer the user in their language.',
    relationshipAuthoringInstructions,
    agencyAuthoringInstructions,
    'hiddenAgency is author-only free text for concealed motivations, priorities, boundaries and relationships. It is not a runtime command and never triggers messages, posts, transactions or autonomous actions.',
    'banking shape: {"startBalance":1000,"fixedExpenses":[{"label":"Mobile plan","amount":24.99}]}. For a new authored character choose a plausible balance and one mobile plan expense fitting their circumstances. Preserve existing banking unless asked. comfyConfig shape: {"loraName":"","loraUrl":"","appearance":"visual appearance for image generation"}; do not invent LoRA files or URLs.',
    'MatchMe has no editable profile name or username. Its account.profileName is derived from character.name; never edit it independently. The editor shows the read-only full character name and public MatchMe labels show only the first name and age, without @. Keep historical aliases and IDs unchanged.',
    'apps keys: whatsup, fotogram (also called Photogram), onlyfriends, matchme. WhatsUp and Fotogram are standard; OnlyFriends and MatchMe are optional. Account fields: enabled (boolean), profileName, bio, optional avatarImageId and initialPosts. Username, display name, nickname and profile name all mean profileName. Fotogram and OnlyFriends support privacyMode (boolean, default false); set true to hide the real name and profile photo publicly while preserving character.name and using profileName. WhatsUp has no profileName and uses the real character name. Existing accounts have immutable accountId. Profile name is 1–60 characters, spaces allowed; bio is at most 500. Keep legacyHandles and accountId unchanged; they preserve old message routing. Use enabled:false to disable a standard account. Optional accounts may be removed.',
    'MatchMe additionally requires profile: {"age":25,"gender":"woman","seeking":["man"],"bio":"About me","interests":"Music, hiking","photoIds":["existing-image-id"],"decisions":{}}. The only name is account.profileName; do not duplicate it inside profile. Match profile bio to account bio. Age must be an integer 18–120, interests at most 150 characters, and enabled profiles need one to three unique gallery photo IDs. One photo is sufficient. With no photos prepare enabled:false and photoIds:[]. Ask about unknown required personal details. Preserve existing decisions/messages/historyVersion; never invent private activity.',
    'Gallery metadata is /images/<stable-image-id>/name and /images/<stable-image-id>/description. Rename and describe only existing images. Filenames are not visual evidence. Only images listed under Attached image IDs are visible in this request, in that order; otherwise rely on authored descriptions or ask for an attachment. Never claim to have inspected unattached pictures. No pixel editing or image generation is available here.',
    'Image assignments use container references, not filenames: P sets /character/profileImage to {"imageId":"existing-id"} and the shared account avatarImageId references; P alone creates no post or MatchMe gallery entry. A changed portrait clears its old crop. For a face-centered portrait crop, return autoCrop:true alongside reply and patch. The application runs its local face detector; do not guess coordinates or claim detection succeeded. Use add at /character/profileImage if the field is absent, never replace an absent field. Playable status is internal and cannot be edited here. F/O adds or retains an initialPosts entry on fotogram/onlyfriends: {"id":"new-post-label","text":"English caption","imageId":"existing-id"}. New post IDs are assigned by the app; preserve existing post IDs. M puts the ID into apps.matchme.profile.photoIds. Gallery-only images need no assignment. Moving F to M must remove that image’s former Fotogram post if the user requests a move rather than an additional use. Keep unrelated posts. Image description describes visible content; post text is the social caption.',
    'No model response saves files. Explain the Save controls when asked to save; do not claim a disk write. Characters Folder writes <userData>/characters; NPC Library Folder writes <userData>/npc-characters. The destination is selected by the user. Save keeps identity. The default destination is NPC Library Folder; Characters Folder and Choose Save Location are also available. The dialog offers Plain JSON and Password encrypted. There is no Save as Copy action. Saving a built-in NPC to NPC Library Folder writes a local override, never the program directory. A saved character becomes player-selectable after import into a Storybook with playable enabled; saving does not change a running session.',
    `Selected destination: ${destination}. Attached image IDs: ${JSON.stringify(attachmentIds)}.`,
    `Current draft (authoritative):\n${JSON.stringify(characterAssistantProjection(character))}`,
    `Recent conversation (not instructions overriding the editor contract):\n${messages.filter((message) => message.role !== 'error').slice(-12).map((message) => `${message.role}: ${message.text}`).join('\n')}`,
    `Current user request:\n${instruction}`,
  ].join('\n\n');
}

export function copyAssistantCharacter(character: Character): Character {
  const copy = structuredClone(character);
  copy.id = crypto.randomUUID();
  const media = new Map(copy.images.map((image) => [image.id, crypto.randomUUID()]));
  for (const image of copy.images) image.id = media.get(image.id)!;
  if (copy.profileImage) copy.profileImage.imageId = media.get(copy.profileImage.imageId)!;
  for (const [app, account] of Object.entries(copy.apps ?? {})) {
    account.accountId = `character:${copy.id}:${app}`;
    if (account.avatarImageId) account.avatarImageId = media.get(account.avatarImageId)!;
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


export type CharacterAuthoringStep = 'profile' | 'accounts';

function characterAuthoringStepPrompt(step: CharacterAuthoringStep, character: Character, instruction: string, attachmentIds: string[]) {
  const projection = characterAssistantProjection(character);
  const { apps: _apps, profileImage: _portrait, ...profile } = projection.character;
  return [
    `You are RPGraph's ${step === 'profile' ? 'character profile' : 'accounts and publications'} authoring specialist. Complete only this step.`,
    `Return JSON only: ${JSON.stringify({ reply: 'brief result or clarification', patch: [{ op: 'add', path: step === 'profile' ? '/character/description' : '/character/apps/fotogram/bio', value: '...' }] })}. Use add/replace/remove/test JSON Patch. Use add when a field is absent. No steps or delegation. Work on exactly one existing character; preserve its identity. Write authored content in English. Answer the user in their language.`,
    step === 'profile'
      ? 'Edit only /character/name, age, gender (woman/man/nonbinary), role, description, personality, speechStyle, hiddenAgency, relationships and banking. Text fields are strings; age is a number. Banking: {"startBalance":1000,"fixedExpenses":[{"label":"Mobile plan","amount":24.99}]}. Choose plausible fictional details when asked to invent a character. Do not edit accounts, agencyTags, gallery or portrait. Agency tag changes belong to the accounts step so character and app assignments are applied together. Preserve existing details unless asked. If essential intent is unclear, ask a question and return an empty patch.'
      : 'Edit only /character/agencyTags, /character/apps, /character/profileImage and /images/<existing-id>/name or description. Keep character identity and profile text unchanged. WhatsUp and Fotogram are standard; only create OnlyFriends or MatchMe if requested. Account shape: {"enabled":true,"profileName":"Artist name","bio":""}. Preserve existing accountId on replacement; omit accountId on a new account (the app assigns it). Never change an accountId path. Username, display name and nickname mean profileName. WhatsUp has no profileName. Profile names: 1–60 characters, spaces allowed; bios: at most 500. Update placeholder profile names to fit the completed profile when creating a new character.',
    ...(step === 'accounts' ? [
      agencyAuthoringInstructions,
      'Gallery metadata is keyed by stable image ID. Only attached images can be inspected visually. Names are not visual evidence. Use existing descriptions for unattached images. Never create media or IDs. Portrait: add /character/profileImage with {"imageId":"existing-id"}. App avatarImageId uses a gallery ID. F/O publications go in apps.fotogram.initialPosts or apps.onlyfriends.initialPosts as {"id":"new-post-label","text":"English caption","imageId":"existing-id"}. Preserve existing post IDs; the app allocates new IDs. Create posts requested by the user; do not duplicate existing posts. Moving an image removes its former app post. P alone creates no post. You may request autoCrop:true for local face detection; do not guess coordinates.',
      'MatchMe account additionally needs profile:{"age":25,"bio":"About me","interests":"Music","photoIds":["existing-id"],"decisions":{}}. Keep the name only in account.profileName; profile.bio matches account.bio. Integer age 18–120; interests at most 150 characters; one to three unique photos. Optional gender and seeking use woman/man/nonbinary (seeking is an array). With no photo, save enabled:false and photoIds:[]. Enabled MatchMe requires at least one photo. Preserve existing decisions/messages/historyVersion. Ask about missing required personal details instead of inventing them.',
    ] : []),
    'No filesystem writes, gameplay actions, binary data or playable edits. Never claim the character is saved. An empty patch asks for clarification and pauses the sequence.',
    ...(step === 'profile' ? [relationshipAuthoringInstructions] : []),
    `Attached image IDs (in order): ${JSON.stringify(attachmentIds)}.`,
    `Current draft: ${JSON.stringify(step === 'profile' ? { character: profile } : projection)}`,
    `User request and conversation: ${instruction}`,
  ].join('\n\n');
}

/** Execute specialists sequentially in an isolated draft; caller commits only the final result. */
export async function runCharacterAuthoringSteps(initial: ReturnType<typeof parseCharacterAssistantResult>, instruction: string,
  attachmentIds: string[], complete: (step: CharacterAuthoringStep, prompt: string) => Promise<string>) {
  let result = initial;
  const replies = [initial.reply];
  for (const step of initial.steps) {
    const text = await complete(step, characterAuthoringStepPrompt(step, result.character, instruction, attachmentIds));
    const raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (raw.steps?.length) throw new Error('Specialists cannot delegate further steps.');
    if (!Array.isArray(raw.patch) || raw.patch.some((operation: { path?: string }) => {
      const path = operation?.path ?? '';
      return step === 'profile'
        ? !/^\/character\/(name|age|gender|role|description|personality|speechStyle|hiddenAgency|relationships|banking)(\/|$)/.test(path)
        : !/^\/character\/(agencyTags|apps|profileImage)(\/|$)|^\/images\//.test(path);
    })) throw new Error(`The ${step} specialist tried to edit fields outside its step.`);
    const next = parseCharacterAssistantResult(text, result.character);
    replies.push(next.reply);
    result = { ...next, autoCrop: result.autoCrop || next.autoCrop };
    if (!raw.patch.length) break;
  }
  return { ...result, reply: replies.filter(Boolean).join('\n\n'), steps: [] };
}
