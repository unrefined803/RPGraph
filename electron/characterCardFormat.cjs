const formatVersions = require('../src/storybook/formatVersions.json');
const { hasCurrentScryptParameters } = require('./encryptionFormat.cjs');
const { semverStatus } = require('./storybookFormat.cjs');

const currentCharacterCardFormatVersion = formatVersions.characterCard;
const currentEncryptedCharacterCardEnvelopeFormatVersion =
  formatVersions.encryptedCharacterCardEnvelope;

function isBase64Bytes(value, expectedLength) {
  if (typeof value !== 'string' || !value) {
    return false;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value && (
    expectedLength === undefined ? bytes.length > 0 : bytes.length === expectedLength
  );
}

function characterCardVersionStatus(value) {
  return semverStatus(value, currentCharacterCardFormatVersion);
}

function characterCardMetadata(card) {
  const formatVersion = typeof card?.version === 'string' ? card.version : undefined;
  const versionStatus = characterCardVersionStatus(formatVersion);
  return {
    type: 'character-card',
    protection: 'plain',
    formatVersion,
    legacy: card?.format === 'rpgraph-character' && versionStatus === 'legacy',
    compatible:
      card?.format === 'rpgraph-character' &&
      (versionStatus === 'current' || versionStatus === 'legacy'),
  };
}

function encryptedCharacterCardMetadata(envelope) {
  const envelopeFormatVersion = typeof envelope?.envelopeFormatVersion === 'string'
    ? envelope.envelopeFormatVersion
    : undefined;
  const formatVersion = typeof envelope?.payloadFormatVersion === 'string'
    ? envelope.payloadFormatVersion
    : undefined;
  const versionStatus = characterCardVersionStatus(formatVersion);
  const versionLoadable = versionStatus === 'current' || versionStatus === 'legacy';
  const envelopeCompatible =
    envelope?.format === 'rpgraph-encrypted-character' &&
    envelopeFormatVersion === currentEncryptedCharacterCardEnvelopeFormatVersion &&
    envelope.payloadFormat === 'rpgraph-character' &&
    typeof envelope.characterName === 'string' &&
    envelope.encryption === 'aes-256-gcm' &&
    envelope.keyDerivation === 'scrypt' &&
    hasCurrentScryptParameters(envelope.keyDerivationParameters) &&
    isBase64Bytes(envelope.salt, 16) &&
    isBase64Bytes(envelope.iv, 12) &&
    isBase64Bytes(envelope.authenticationTag, 16) &&
    isBase64Bytes(envelope.ciphertext);
  return {
    type: 'character-card',
    protection: 'encrypted',
    envelopeFormatVersion,
    formatVersion,
    characterName: typeof envelope?.characterName === 'string'
      ? envelope.characterName
      : undefined,
    legacy: envelopeCompatible && versionStatus === 'legacy',
    compatible: envelopeCompatible && versionLoadable,
  };
}

module.exports = {
  characterCardMetadata,
  characterCardVersionStatus,
  currentCharacterCardFormatVersion,
  currentEncryptedCharacterCardEnvelopeFormatVersion,
  encryptedCharacterCardMetadata,
};
