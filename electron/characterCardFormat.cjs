const formatVersions = require('../src/storybook/formatVersions.json');
const { semverStatus } = require('./storybookFormat.cjs');

const currentCharacterCardFormatVersion = formatVersions.characterCard;

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

module.exports = {
  characterCardMetadata,
  characterCardVersionStatus,
  currentCharacterCardFormatVersion,
};
