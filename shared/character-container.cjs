const formatVersions = require('../src/storybook/formatVersions.json');

const currentCharacterContainerVersion = formatVersions.characterCard;
const appNames = ['whatsup', 'fotogram', 'onlyfriends', 'matchme'];
const datingGenders = ['woman', 'man', 'nonbinary'];

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalFiniteNumber(value) {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function validateDatingProfile(value, requireImage) {
  const profile = record(value);
  if (!nonEmptyString(profile.name) || !Number.isInteger(profile.age) || profile.age < 18 || profile.age > 120 ||
      !nonEmptyString(profile.bio) || typeof profile.interests !== 'string' || !Array.isArray(profile.photoIds) ||
      profile.photoIds.length === 0 || profile.photoIds.length > 3) {
    throw new Error('Invalid MatchMe profile in character container.');
  }
  if (profile.gender !== undefined && !datingGenders.includes(profile.gender)) {
    throw new Error('Invalid MatchMe gender in character container.');
  }
  if (profile.seeking !== undefined && (!Array.isArray(profile.seeking) ||
      profile.seeking.some((gender) => !datingGenders.includes(gender)))) {
    throw new Error('Invalid MatchMe seeking preference in character container.');
  }
  const photoIds = new Set();
  for (const photoId of profile.photoIds) {
    if (!nonEmptyString(photoId) || photoIds.has(photoId)) {
      throw new Error('MatchMe photoIds require unique gallery image IDs.');
    }
    photoIds.add(photoId);
    requireImage(photoId);
  }
}

/** Validate the canonical Character Container V2 payload and all gallery references. */
function validateCharacterPayload(value) {
  const character = record(value);
  if (!nonEmptyString(character.id) || !nonEmptyString(character.name)) {
    throw new Error('Character Container V2 requires a stable id and name.');
  }
  for (const field of ['description', 'personality', 'speechStyle', 'role']) {
    if (typeof character[field] !== 'string') {
      throw new Error(`Character Container V2 requires a ${field} string.`);
    }
  }
  if (typeof character.playable !== 'boolean') {
    throw new Error('Character Container V2 requires a playable flag.');
  }
  if (!optionalFiniteNumber(character.age) ||
      (character.gender !== undefined && !datingGenders.includes(character.gender))) {
    throw new Error('Character Container V2 has invalid demographic fields.');
  }
  if (!Array.isArray(character.images)) {
    throw new Error('Character Container V2 requires a gallery.');
  }
  const images = new Set();
  for (const raw of character.images) {
    const image = record(raw);
    if (!nonEmptyString(image.id) || images.has(image.id)) {
      throw new Error('Duplicate or missing gallery image id.');
    }
    if (typeof image.name !== 'string' || image.mimeType !== 'image/jpeg' ||
        typeof image.size !== 'number' || !Number.isFinite(image.size) || image.size < 0 ||
        typeof image.description !== 'string' ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl ?? '') ||
        !optionalFiniteNumber(image.width) || !optionalFiniteNumber(image.height)) {
      throw new Error('Gallery images require valid metadata and embedded JPEG base64 data.');
    }
    images.add(image.id);
  }
  const requireImage = (id) => {
    if (!nonEmptyString(id) || !images.has(id)) {
      throw new Error(`Unknown character gallery image: ${String(id)}`);
    }
  };
  if (character.profileImage !== undefined) {
    const profile = record(character.profileImage);
    requireImage(profile.imageId);
    if (profile.crop !== undefined) {
      const crop = record(profile.crop);
      if (![crop.x, crop.y, crop.size].every((value) => typeof value === 'number' &&
          Number.isFinite(value) && value >= 0 && value <= 100) || crop.size <= 0) {
        throw new Error('Portrait crops require finite x, y and size percentages; size must be positive.');
      }
    }
  }
  const accountIds = new Set();
  for (const [app, raw] of Object.entries(record(character.apps))) {
    if (!appNames.includes(app)) throw new Error(`Unknown character app: ${app}`);
    const account = record(raw);
    if (!nonEmptyString(account.accountId) || accountIds.has(account.accountId) ||
        typeof account.enabled !== 'boolean' || typeof account.username !== 'string' ||
        typeof account.displayName !== 'string' || typeof account.bio !== 'string') {
      throw new Error('App accounts require stable IDs, profile strings and an enabled flag.');
    }
    accountIds.add(account.accountId);
    if (account.avatarImageId !== undefined) requireImage(account.avatarImageId);
    if (account.initialPosts !== undefined && !Array.isArray(account.initialPosts)) {
      throw new Error('Initial posts must be an array.');
    }
    const postIds = new Set();
    for (const rawPost of account.initialPosts ?? []) {
      const post = record(rawPost);
      if (!nonEmptyString(post.id) || postIds.has(post.id) || typeof post.text !== 'string') {
        throw new Error('Initial posts require unique IDs and text.');
      }
      postIds.add(post.id);
      if (post.imageId !== undefined) requireImage(post.imageId);
    }
    if (app === 'matchme' && account.profile !== undefined) {
      validateDatingProfile(account.profile, requireImage);
    }
  }
  return character;
}

function validateCharacterContainer(value) {
  const container = record(value);
  if (container.format !== 'rpgraph-character') {
    throw new Error('The file is not an RPGraph character container.');
  }
  if (container.version !== currentCharacterContainerVersion) {
    throw new Error(`Character Container ${String(container.version ?? 'Unknown')} is unsupported; expected ${currentCharacterContainerVersion}.`);
  }
  validateCharacterPayload(container.character);
  return container;
}

module.exports = {
  currentCharacterContainerVersion,
  validateCharacterContainer,
  validateCharacterPayload,
};
