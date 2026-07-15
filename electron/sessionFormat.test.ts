import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { currentScryptParameters } from './encryptionFormat.cjs';
import {
  currentEncryptedSessionEnvelopeFormatVersion,
  currentSessionFormatVersion,
  currentWorkflowFormatVersion,
  encryptedSessionMetadata,
  sessionMetadata,
} from './sessionFormat.cjs';

describe('session format metadata', () => {
  it('accepts a current encrypted session envelope and rejects tampered fields', () => {
    const currentEnvelope = {
      format: 'rpgraph-encrypted-session',
      envelopeFormatVersion: currentEncryptedSessionEnvelopeFormatVersion,
      payloadFormat: 'rpgraph-session',
      payloadFormatVersion: currentSessionFormatVersion,
      workflowFormatVersion: '2.0',
      latestTurnNumber: 3,
      encryption: 'aes-256-gcm',
      keyDerivation: 'scrypt',
      keyDerivationParameters: currentScryptParameters,
      salt: Buffer.alloc(16).toString('base64'),
      iv: Buffer.alloc(12).toString('base64'),
      authenticationTag: Buffer.alloc(16).toString('base64'),
      ciphertext: Buffer.from('{}').toString('base64'),
    };

    assert.equal(encryptedSessionMetadata(currentEnvelope).compatible, true);
    assert.equal(encryptedSessionMetadata(currentEnvelope).protection, 'encrypted');
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, encryption: 'other' }).compatible, false);
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, keyDerivation: 'other' }).compatible, false);
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, keyDerivationParameters: undefined }).compatible, false);
    assert.equal(encryptedSessionMetadata({
      ...currentEnvelope,
      keyDerivationParameters: { ...currentScryptParameters, N: 16384 },
    }).compatible, false);
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, salt: '' }).compatible, false);
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, iv: 'invalid' }).compatible, false);
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, authenticationTag: '' }).compatible, false);
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, ciphertext: '' }).compatible, false);
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, payloadFormatVersion: '1.0' }).compatible, false);
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, envelopeFormatVersion: '3.0' }).compatible, false);
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, workflowFormatVersion: currentWorkflowFormatVersion }).compatible, false);
    assert.equal(encryptedSessionMetadata({ ...currentEnvelope, latestTurnNumber: undefined }).compatible, false);
  });

  it('accepts a current plain session and rejects an incompatible version', () => {
    const currentSession = {
      format: 'rpgraph-session',
      formatVersion: currentSessionFormatVersion,
      name: 'Fixture Session',
      savedAt: '2026-06-01T00:00:00.000Z',
      metadata: {
        settings: {
          englishProcessingEnabled: false,
          displayLanguage: 'German',
        },
      },
      workflow: {
        format: 'rpgraph-workflow',
        formatVersion: '2.0',
        graph: {
          nodes: [],
          edges: [],
        },
      },
      timeline: [
        { id: 'message-1', kind: 'message', turnId: 'turn-3', turnNumber: 3 },
      ],
      entities: {
        events: {},
        images: {},
        memory: {},
      },
      runtime: {
        current: { nodes: {}, workflowVariables: {} },
        undo: [],
      },
      ui: {
        phoneSeenByConversation: {},
        bankingSeenByCharacter: {},
        phoneDividerAfterByConversation: {},
      },
    };

    assert.equal(sessionMetadata(currentSession).compatible, true);
    assert.equal(sessionMetadata(currentSession).protection, 'plain');
    assert.equal(sessionMetadata(currentSession).latestTurnNumber, 3);
    assert.equal(sessionMetadata({ ...currentSession, formatVersion: '1.0' }).compatible, false);
  });
});
