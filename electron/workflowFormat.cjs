const formatVersions = require('../src/workflow/formatVersions.json');
const { hasCurrentScryptParameters } = require('./encryptionFormat.cjs');

const currentEncryptedWorkflowEnvelopeFormatVersion = formatVersions.encryptedWorkflowEnvelope;
const currentWorkflowFormatVersion = formatVersions.workflow;

function isBase64Bytes(value, expectedLength) {
  if (typeof value !== 'string' || !value) {
    return false;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value && (
    expectedLength === undefined ? bytes.length > 0 : bytes.length === expectedLength
  );
}

function workflowMetadata(workflow) {
  const formatVersion = typeof workflow?.formatVersion === 'string'
    ? workflow.formatVersion
    : undefined;
  return {
    type: 'workflow',
    protection: 'plain',
    formatVersion,
    workflowFormatVersion: formatVersion,
    compatible:
      workflow?.format === 'rpgraph-workflow' &&
      formatVersion === currentWorkflowFormatVersion,
  };
}

function encryptedWorkflowMetadata(envelope) {
  const envelopeFormatVersion = typeof envelope?.envelopeFormatVersion === 'string'
    ? envelope.envelopeFormatVersion
    : undefined;
  const formatVersion = typeof envelope?.payloadFormatVersion === 'string'
    ? envelope.payloadFormatVersion
    : undefined;
  return {
    type: 'workflow',
    protection: 'encrypted',
    envelopeFormatVersion,
    formatVersion,
    workflowFormatVersion: formatVersion,
    compatible:
      envelope?.format === 'rpgraph-encrypted-workflow' &&
      ['2.0', currentEncryptedWorkflowEnvelopeFormatVersion].includes(envelopeFormatVersion) &&
      envelope.payloadFormat === 'rpgraph-workflow' &&
      formatVersion === currentWorkflowFormatVersion &&
      envelope.encryption === 'aes-256-gcm' &&
      envelope.keyDerivation === 'scrypt' &&
      hasCurrentScryptParameters(envelope.keyDerivationParameters) &&
      isBase64Bytes(envelope.salt, 16) &&
      isBase64Bytes(envelope.iv, 12) &&
      isBase64Bytes(envelope.authenticationTag, 16) &&
      isBase64Bytes(envelope.ciphertext),
  };
}

module.exports = {
  currentEncryptedWorkflowEnvelopeFormatVersion,
  currentWorkflowFormatVersion,
  encryptedWorkflowMetadata,
  workflowMetadata,
};
