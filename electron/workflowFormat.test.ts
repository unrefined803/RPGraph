import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { formatVersionStatus } from '../shared/formatVersionStatus.cjs';
import { currentScryptParameters } from './encryptionFormat.cjs';
import {
  currentEncryptedWorkflowEnvelopeFormatVersion,
  currentWorkflowFormatVersion,
  encryptedWorkflowMetadata,
  workflowMetadata,
} from './workflowFormat.cjs';

describe('workflow format metadata', () => {
  it('validates plain workflow metadata', () => {
    const currentWorkflow = {
      format: 'rpgraph-workflow',
      formatVersion: currentWorkflowFormatVersion,
    };

    assert.deepEqual(workflowMetadata(currentWorkflow), {
      type: 'workflow',
      protection: 'plain',
      formatVersion: currentWorkflowFormatVersion,
      versionStatus: 'current',
      workflowFormatVersion: currentWorkflowFormatVersion,
      compatible: true,
    });
    assert.equal(workflowMetadata({ ...currentWorkflow, format: 'other' }).compatible, false);
    assert.equal(workflowMetadata({ ...currentWorkflow, formatVersion: '999.0' }).compatible, false);
    assert.deepEqual(workflowMetadata({}), {
      type: 'workflow',
      protection: 'plain',
      formatVersion: undefined,
      versionStatus: 'invalid',
      workflowFormatVersion: undefined,
      compatible: false,
    });
    assert.equal(workflowMetadata({ ...currentWorkflow, formatVersion: '999.0' }).versionStatus, 'newer');
    assert.equal(workflowMetadata({ ...currentWorkflow, formatVersion: '0.1' }).versionStatus, 'unsupported');
  });

  it('classifies format versions against the current and oldest loadable version', () => {
    assert.equal(formatVersionStatus('1.2', '1.2'), 'current');
    assert.equal(formatVersionStatus('1.1', '1.2'), 'unsupported');
    assert.equal(formatVersionStatus('1.1', '1.2', '1.0'), 'legacy');
    assert.equal(formatVersionStatus('1.0', '1.2', '1.0'), 'legacy');
    assert.equal(formatVersionStatus('0.9', '1.2', '1.0'), 'unsupported');
    assert.equal(formatVersionStatus('1.10', '1.9'), 'newer');
    assert.equal(formatVersionStatus('2.0', '1.2', '1.0'), 'newer');
    assert.equal(formatVersionStatus('1.2.0', '1.2'), 'invalid');
    assert.equal(formatVersionStatus(undefined, '1.2'), 'invalid');
  });

  it('validates encrypted workflow envelopes', () => {
    const currentEnvelope = {
      format: 'rpgraph-encrypted-workflow',
      envelopeFormatVersion: currentEncryptedWorkflowEnvelopeFormatVersion,
      payloadFormat: 'rpgraph-workflow',
      payloadFormatVersion: currentWorkflowFormatVersion,
      encryption: 'aes-256-gcm',
      keyDerivation: 'scrypt',
      keyDerivationParameters: currentScryptParameters,
      salt: Buffer.alloc(16).toString('base64'),
      iv: Buffer.alloc(12).toString('base64'),
      authenticationTag: Buffer.alloc(16).toString('base64'),
      ciphertext: Buffer.from('{}').toString('base64'),
    };

    assert.equal(encryptedWorkflowMetadata(currentEnvelope).compatible, true);
    assert.equal(encryptedWorkflowMetadata({ ...currentEnvelope, encryption: 'other' }).compatible, false);
    assert.equal(encryptedWorkflowMetadata({ ...currentEnvelope, keyDerivationParameters: undefined }).compatible, false);
    assert.equal(encryptedWorkflowMetadata({
      ...currentEnvelope,
      keyDerivationParameters: { ...currentScryptParameters, N: 16384 },
    }).compatible, false);
    assert.equal(encryptedWorkflowMetadata({ ...currentEnvelope, envelopeFormatVersion: '999.0' }).compatible, false);
    assert.equal(encryptedWorkflowMetadata({ ...currentEnvelope, payloadFormatVersion: '2.0' }).compatible, false);
  });
});
