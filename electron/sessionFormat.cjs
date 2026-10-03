const formatVersions = require('../src/session/formatVersions.json');
const workflowFormatVersions = require('../src/workflow/formatVersions.json');
const { hasCurrentScryptParameters } = require('./encryptionFormat.cjs');
const { formatVersionStatus } = require('../shared/formatVersionStatus.cjs');

const currentEncryptedSessionEnvelopeFormatVersion = formatVersions.encryptedSessionEnvelope;
const currentSessionFormatVersion = formatVersions.session;
const currentWorkflowFormatVersion = workflowFormatVersions.workflow;
const currentSessionWorkflowFormatVersion = formatVersions.sessionWorkflow;

function sessionVersionStatus(value) {
  return formatVersionStatus(value, currentSessionFormatVersion, formatVersions.oldestLoadableSession);
}

/**
 * A current RP save embeds exactly the current session workflow format. A
 * legacy save may embed any older one; its migration steps upgrade both.
 */
function sessionVersionsLoadable(formatVersion, workflowFormatVersion) {
  const status = sessionVersionStatus(formatVersion);
  if (status === 'current') {
    return workflowFormatVersion === currentSessionWorkflowFormatVersion;
  }
  return status === 'legacy' &&
    ['current', 'legacy'].includes(
      formatVersionStatus(workflowFormatVersion, currentSessionWorkflowFormatVersion, '0.0'),
    );
}

function sessionTurnNumber(session) {
  if (Array.isArray(session?.timeline)) {
    return session.timeline.reduce((highest, entry) => {
      if (
        entry?.kind === 'message' &&
        typeof entry.turnNumber === 'number' &&
        Number.isFinite(entry.turnNumber)
      ) {
        return Math.max(highest, entry.turnNumber);
      }
      return highest;
    }, 0);
  }
  return 0;
}

function isBase64Bytes(value, expectedLength) {
  if (typeof value !== 'string' || !value) {
    return false;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value && (
    expectedLength === undefined ? bytes.length > 0 : bytes.length === expectedLength
  );
}

function encryptedSessionMetadata(envelope) {
  const envelopeFormatVersion = typeof envelope?.envelopeFormatVersion === 'string'
    ? envelope.envelopeFormatVersion
    : undefined;
  const formatVersion = typeof envelope?.payloadFormatVersion === 'string'
    ? envelope.payloadFormatVersion
    : undefined;
  const workflowFormatVersion = typeof envelope?.workflowFormatVersion === 'string'
    ? envelope.workflowFormatVersion
    : undefined;
  const latestTurnNumber = typeof envelope?.latestTurnNumber === 'number' &&
    Number.isFinite(envelope.latestTurnNumber)
    ? envelope.latestTurnNumber
    : undefined;
  return {
    type: 'session',
    protection: 'encrypted',
    envelopeFormatVersion,
    formatVersion,
    versionStatus: sessionVersionStatus(formatVersion),
    workflowFormatVersion,
    latestTurnNumber,
    compatible:
      envelope?.format === 'rpgraph-encrypted-session' &&
      ['2.1', currentEncryptedSessionEnvelopeFormatVersion].includes(envelopeFormatVersion) &&
      envelope.payloadFormat === 'rpgraph-session' &&
      sessionVersionsLoadable(formatVersion, workflowFormatVersion) &&
      latestTurnNumber !== undefined &&
      envelope.encryption === 'aes-256-gcm' &&
      envelope.keyDerivation === 'scrypt' &&
      hasCurrentScryptParameters(envelope.keyDerivationParameters) &&
      isBase64Bytes(envelope.salt, 16) &&
      isBase64Bytes(envelope.iv, 12) &&
      isBase64Bytes(envelope.authenticationTag, 16) &&
      isBase64Bytes(envelope.ciphertext),
  };
}

function sessionMetadata(session) {
  const formatVersion = typeof session?.formatVersion === 'string'
    ? session.formatVersion
    : undefined;
  const workflowFormatVersion = typeof session?.workflow?.formatVersion === 'string'
    ? session.workflow.formatVersion
    : undefined;
  const latestTurnNumber = sessionTurnNumber(session);
  const compatible =
    session?.format === 'rpgraph-session' &&
    sessionVersionsLoadable(formatVersion, workflowFormatVersion) &&
    session.workflow?.format === 'rpgraph-workflow' &&
    session.workflow?.graph &&
    Array.isArray(session.workflow.graph.nodes) &&
    Array.isArray(session.workflow.graph.edges) &&
    Array.isArray(session.timeline) &&
    session.entities &&
    session.runtime &&
    session.runtime.current &&
    session.runtime.current.workflowVariables &&
    typeof session.runtime.current.workflowVariables === 'object' &&
    !Array.isArray(session.runtime.current.workflowVariables) &&
    session.ui;
  return {
    type: 'session',
    protection: 'plain',
    formatVersion,
    versionStatus: sessionVersionStatus(formatVersion),
    workflowFormatVersion,
    latestTurnNumber,
    compatible: !!compatible,
  };
}

module.exports = {
  currentEncryptedSessionEnvelopeFormatVersion,
  currentSessionFormatVersion,
  currentSessionWorkflowFormatVersion,
  currentWorkflowFormatVersion,
  encryptedSessionMetadata,
  sessionMetadata,
  sessionVersionStatus,
};
