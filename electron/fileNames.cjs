const fileBaseNameControlCharacters = `${String.fromCharCode(0)}-${String.fromCharCode(31)}`;
const invalidFileBaseNameCharacters = new RegExp(`[<>:"/\\\\|?*${fileBaseNameControlCharacters}]`, 'g');

function safeWorkflowBaseName(value) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/^workflow\./i, '')
    .replace(invalidFileBaseNameCharacters, '-')
    .replace(/[. ]+$/g, '')
    .replace(/(\.rpgraph)?\.json$/i, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  const baseName = cleaned || `workflow-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(baseName)
    ? `workflow-${baseName}`
    : baseName;
}

function safeStorybookBaseName(value) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(invalidFileBaseNameCharacters, '-')
    .replace(/[. ]+$/g, '')
    .replace(/(\.rpgraph-storybook)?\.json$/i, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  const baseName = cleaned || `storybook-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(baseName)
    ? `storybook-${baseName}`
    : baseName;
}

function safeCharacterCardBaseName(value) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(invalidFileBaseNameCharacters, '-')
    .replace(/[. ]+$/g, '')
    .replace(/(\.rpgraph-character)?\.json$/i, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  const baseName = cleaned || `character-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(baseName)
    ? `${baseName}-file`
    : baseName;
}

module.exports = { safeWorkflowBaseName, safeStorybookBaseName, safeCharacterCardBaseName };
