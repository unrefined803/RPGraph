const assert = require('node:assert/strict');
const { currentScryptParameters } = require('./encryptionFormat.cjs');
const {
  currentEncryptedStorybookEnvelopeFormatVersion,
  currentStorybookFormatVersion,
  encryptedStorybookMetadata,
  storybookMetadata,
  storybookVersionStatus,
} = require('./storybookFormat.cjs');

assert.equal(storybookVersionStatus(currentStorybookFormatVersion), 'current');
assert.equal(storybookVersionStatus('1.19.0'), 'legacy');
assert.equal(storybookVersionStatus('1.0.0'), 'legacy');
assert.equal(storybookVersionStatus('999.0.0'), 'newer');
assert.equal(storybookVersionStatus('2.0.1'), 'newer');
assert.equal(storybookVersionStatus('not-a-version'), 'invalid');
assert.equal(storybookVersionStatus(undefined), 'invalid');

const currentStorybook = {
  format: 'rpgraph-storybook',
  version: currentStorybookFormatVersion,
};

assert.deepEqual(storybookMetadata(currentStorybook), {
  type: 'storybook',
  protection: 'plain',
  formatVersion: currentStorybookFormatVersion,
  legacy: false,
  compatible: true,
});
// Older storybooks stay loadable and are flagged legacy for the conversion flow.
const legacyMetadata = storybookMetadata({ ...currentStorybook, version: '1.19.0' });
assert.equal(legacyMetadata.compatible, true);
assert.equal(legacyMetadata.legacy, true);
assert.equal(storybookMetadata({ ...currentStorybook, format: 'other' }).compatible, false);
assert.equal(storybookMetadata({ ...currentStorybook, version: '999.0.0' }).compatible, false);
assert.equal(storybookMetadata({ ...currentStorybook, version: 'broken' }).compatible, false);
assert.equal(storybookMetadata({}).compatible, false);

const currentEnvelope = {
  format: 'rpgraph-encrypted-storybook',
  envelopeFormatVersion: currentEncryptedStorybookEnvelopeFormatVersion,
  payloadFormat: 'rpgraph-storybook',
  payloadFormatVersion: currentStorybookFormatVersion,
  encryption: 'aes-256-gcm',
  keyDerivation: 'scrypt',
  keyDerivationParameters: currentScryptParameters,
  salt: Buffer.alloc(16).toString('base64'),
  iv: Buffer.alloc(12).toString('base64'),
  authenticationTag: Buffer.alloc(16).toString('base64'),
  ciphertext: Buffer.from('{}').toString('base64'),
};

assert.equal(encryptedStorybookMetadata(currentEnvelope).compatible, true);
assert.equal(encryptedStorybookMetadata(currentEnvelope).legacy, false);
const legacyEnvelopeMetadata = encryptedStorybookMetadata({
  ...currentEnvelope,
  payloadFormatVersion: '1.19.0',
});
assert.equal(legacyEnvelopeMetadata.compatible, true);
assert.equal(legacyEnvelopeMetadata.legacy, true);
assert.equal(encryptedStorybookMetadata({ ...currentEnvelope, payloadFormatVersion: '999.0.0' }).compatible, false);
assert.equal(encryptedStorybookMetadata({ ...currentEnvelope, encryption: 'other' }).compatible, false);
assert.equal(encryptedStorybookMetadata({ ...currentEnvelope, envelopeFormatVersion: '3.0' }).compatible, false);
assert.equal(encryptedStorybookMetadata({
  ...currentEnvelope,
  keyDerivationParameters: { ...currentScryptParameters, N: 16384 },
}).compatible, false);
assert.equal(encryptedStorybookMetadata({ ...currentEnvelope, salt: 'invalid' }).compatible, false);

const {
  characterCardMetadata,
  currentCharacterCardFormatVersion,
} = require('./characterCardFormat.cjs');

const currentCard = {
  format: 'rpgraph-character',
  version: currentCharacterCardFormatVersion,
  character: { id: 'test', name: 'Test' },
};

assert.deepEqual(characterCardMetadata(currentCard), {
  type: 'character-card',
  protection: 'plain',
  formatVersion: currentCharacterCardFormatVersion,
  legacy: false,
  compatible: true,
});
assert.equal(characterCardMetadata({ ...currentCard, format: 'other' }).compatible, false);
assert.equal(characterCardMetadata({ ...currentCard, version: '999.0.0' }).compatible, false);
assert.equal(characterCardMetadata({ ...currentCard, version: '0.9.0' }).compatible, true);
assert.equal(characterCardMetadata({ ...currentCard, version: '0.9.0' }).legacy, true);
assert.equal(characterCardMetadata({}).compatible, false);

console.log('storybook and character card format fixtures passed');
