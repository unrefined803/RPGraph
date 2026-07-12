const formatVersions = require('../src/storybook/formatVersions.json');
const { hasCurrentScryptParameters } = require('./encryptionFormat.cjs');

const currentEncryptedStorybookEnvelopeFormatVersion = formatVersions.encryptedStorybookEnvelope;
const currentStorybookFormatVersion = formatVersions.storybook;

const storybookVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parsedStorybookVersion(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = storybookVersionPattern.exec(value);
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * 'current' and 'legacy' versions are loadable (legacy ones go through the
 * renderer's conversion/normalization); 'newer' needs an RPGraph update;
 * 'invalid' is not a MAJOR.MINOR.PATCH version.
 */
function semverStatus(value, currentVersion) {
  const version = parsedStorybookVersion(value);
  if (!version) {
    return 'invalid';
  }
  const current = parsedStorybookVersion(currentVersion);
  if (value === currentVersion) {
    return 'current';
  }
  const difference =
    version.major - current.major || version.minor - current.minor || version.patch - current.patch;
  return difference > 0 ? 'newer' : 'legacy';
}

function storybookVersionStatus(value) {
  return semverStatus(value, currentStorybookFormatVersion);
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

function storybookMetadata(storybook) {
  const formatVersion = typeof storybook?.version === 'string'
    ? storybook.version
    : undefined;
  const versionStatus = storybookVersionStatus(formatVersion);
  const versionLoadable = versionStatus === 'current' || versionStatus === 'legacy';
  return {
    type: 'storybook',
    protection: 'plain',
    formatVersion,
    legacy: storybook?.format === 'rpgraph-storybook' && versionStatus === 'legacy',
    compatible:
      storybook?.format === 'rpgraph-storybook' &&
      versionLoadable,
  };
}

function encryptedStorybookMetadata(envelope) {
  const envelopeFormatVersion = typeof envelope?.envelopeFormatVersion === 'string'
    ? envelope.envelopeFormatVersion
    : undefined;
  const formatVersion = typeof envelope?.payloadFormatVersion === 'string'
    ? envelope.payloadFormatVersion
    : undefined;
  const versionStatus = storybookVersionStatus(formatVersion);
  const versionLoadable = versionStatus === 'current' || versionStatus === 'legacy';
  const envelopeCompatible =
    envelope?.format === 'rpgraph-encrypted-storybook' &&
    envelopeFormatVersion === currentEncryptedStorybookEnvelopeFormatVersion &&
    envelope.payloadFormat === 'rpgraph-storybook' &&
    envelope.encryption === 'aes-256-gcm' &&
    envelope.keyDerivation === 'scrypt' &&
    hasCurrentScryptParameters(envelope.keyDerivationParameters) &&
    isBase64Bytes(envelope.salt, 16) &&
    isBase64Bytes(envelope.iv, 12) &&
    isBase64Bytes(envelope.authenticationTag, 16) &&
    isBase64Bytes(envelope.ciphertext);
  return {
    type: 'storybook',
    protection: 'encrypted',
    envelopeFormatVersion,
    formatVersion,
    legacy: envelopeCompatible && versionStatus === 'legacy',
    compatible: envelopeCompatible && versionLoadable,
  };
}

module.exports = {
  currentEncryptedStorybookEnvelopeFormatVersion,
  currentStorybookFormatVersion,
  encryptedStorybookMetadata,
  semverStatus,
  storybookMetadata,
  storybookVersionStatus,
};
