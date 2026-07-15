import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { currentScryptParameters } from './encryptionFormat.cjs';
import {
  currentEncryptedStorybookEnvelopeFormatVersion,
  currentStorybookFormatVersion,
  encryptedStorybookMetadata,
  storybookMetadata,
  storybookVersionStatus,
} from './storybookFormat.cjs';
import {
  characterCardMetadata,
  currentCharacterCardFormatVersion,
  currentEncryptedCharacterCardEnvelopeFormatVersion,
  encryptedCharacterCardMetadata,
} from './characterCardFormat.cjs';

describe('storybook format metadata', () => {
  it('classifies storybook version status', () => {
    assert.equal(storybookVersionStatus(currentStorybookFormatVersion), 'current');
    assert.equal(storybookVersionStatus('1.19.0'), 'legacy');
    assert.equal(storybookVersionStatus('1.0.0'), 'legacy');
    assert.equal(storybookVersionStatus('999.0.0'), 'newer');
    assert.equal(storybookVersionStatus('2.0.1'), 'newer');
    assert.equal(storybookVersionStatus('not-a-version'), 'invalid');
    assert.equal(storybookVersionStatus(undefined), 'invalid');
  });

  it('validates plain storybook metadata and flags legacy versions', () => {
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
  });

  it('validates encrypted storybook envelopes', () => {
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
  });

  it('validates plain character card metadata', () => {
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
    assert.equal(characterCardMetadata({ ...currentCard, character: {} }).compatible, false);
    assert.equal(characterCardMetadata({ ...currentCard, character: [] }).compatible, false);
    assert.equal(characterCardMetadata({}).compatible, false);
  });

  it('validates encrypted character card envelopes', () => {
    const currentCharacterEnvelope = {
      format: 'rpgraph-encrypted-character',
      envelopeFormatVersion: currentEncryptedCharacterCardEnvelopeFormatVersion,
      payloadFormat: 'rpgraph-character',
      payloadFormatVersion: currentCharacterCardFormatVersion,
      characterName: 'Test',
      encryption: 'aes-256-gcm',
      keyDerivation: 'scrypt',
      keyDerivationParameters: currentScryptParameters,
      salt: Buffer.alloc(16).toString('base64'),
      iv: Buffer.alloc(12).toString('base64'),
      authenticationTag: Buffer.alloc(16).toString('base64'),
      ciphertext: Buffer.from('{}').toString('base64'),
    };

    assert.deepEqual(encryptedCharacterCardMetadata(currentCharacterEnvelope), {
      type: 'character-card',
      protection: 'encrypted',
      envelopeFormatVersion: currentEncryptedCharacterCardEnvelopeFormatVersion,
      formatVersion: currentCharacterCardFormatVersion,
      characterName: 'Test',
      legacy: false,
      compatible: true,
    });
    assert.equal(encryptedCharacterCardMetadata({
      ...currentCharacterEnvelope,
      payloadFormatVersion: '0.9.0',
    }).legacy, true);
    assert.equal(encryptedCharacterCardMetadata({
      ...currentCharacterEnvelope,
      characterName: undefined,
    }).compatible, false);
    assert.equal(encryptedCharacterCardMetadata({
      ...currentCharacterEnvelope,
      envelopeFormatVersion: '2.0',
    }).compatible, false);
    assert.equal(encryptedCharacterCardMetadata({
      ...currentCharacterEnvelope,
      ciphertext: 'invalid',
    }).compatible, false);
  });
});
