const assert = require('node:assert/strict');
const { currentScryptParameters } = require('./encryptionFormat.cjs');
const {
  currentEncryptedWorkflowEnvelopeFormatVersion,
  currentWorkflowFormatVersion,
  encryptedWorkflowMetadata,
  workflowMetadata,
} = require('./workflowFormat.cjs');
const {
  bundledDefaultWorkflowFileNames,
  importedDefaultFileNamesFromState,
  restoreBundledDefaultWorkflows,
} = require('./workflowDefaults.cjs');

assert.deepEqual(
  bundledDefaultWorkflowFileNames([
    'README.md',
    'workflow.default_planning_v1.json',
    'workflow.default_v23.json',
    'workflow.default_v9.json',
  ]),
  [
    'workflow.default_v9.json',
    'workflow.default_v23.json',
    'workflow.default_planning_v1.json',
  ],
);
assert.deepEqual(
  importedDefaultFileNamesFromState({
    importedDefaultFileNames: [
      '/old/path/workflow.default_v23.json',
      'workflow.default_planning_v1.json',
    ],
    importedDefaultFileName: '/legacy/path/workflow.default_v23.json',
  }),
  ['workflow.default_v23.json', 'workflow.default_planning_v1.json'],
);

const currentWorkflow = {
  format: 'rpgraph-workflow',
  formatVersion: currentWorkflowFormatVersion,
};

assert.deepEqual(workflowMetadata(currentWorkflow), {
  type: 'workflow',
  protection: 'plain',
  formatVersion: currentWorkflowFormatVersion,
  workflowFormatVersion: currentWorkflowFormatVersion,
  compatible: true,
});
assert.equal(workflowMetadata({ ...currentWorkflow, format: 'other' }).compatible, false);
assert.equal(workflowMetadata({ ...currentWorkflow, formatVersion: '999.0' }).compatible, false);
assert.deepEqual(workflowMetadata({}), {
  type: 'workflow',
  protection: 'plain',
  formatVersion: undefined,
  workflowFormatVersion: undefined,
  compatible: false,
});

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
assert.equal(encryptedWorkflowMetadata({ ...currentEnvelope, envelopeFormatVersion: '3.0' }).compatible, false);
assert.equal(encryptedWorkflowMetadata({ ...currentEnvelope, payloadFormatVersion: '2.0' }).compatible, false);

void (async () => {
  const restoredPaths = [];
  let activatedFileName = '';
  const primary = await restoreBundledDefaultWorkflows(
    [
      '/app/workflow.default_v23.json',
      '/app/workflow.default_planning_v1.json',
    ],
    async (bundledPath) => {
      restoredPaths.push(bundledPath);
      return { fileName: bundledPath.split('/').pop() };
    },
    async (restored) => {
      activatedFileName = restored.fileName;
    },
  );
  assert.deepEqual(restoredPaths, [
    '/app/workflow.default_v23.json',
    '/app/workflow.default_planning_v1.json',
  ]);
  assert.equal(primary.fileName, 'workflow.default_planning_v1.json');
  assert.equal(activatedFileName, 'workflow.default_planning_v1.json');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
