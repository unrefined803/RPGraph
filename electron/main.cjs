const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage } = require('electron');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { currentScryptParameters } = require('./encryptionFormat.cjs');
const {
  currentEncryptedSessionEnvelopeFormatVersion,
  currentSessionFormatVersion,
  currentSessionWorkflowFormatVersion,
  encryptedSessionMetadata,
  sessionMetadata,
} = require('./sessionFormat.cjs');
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
const {
  currentEncryptedStorybookEnvelopeFormatVersion,
  currentStorybookFormatVersion,
  encryptedStorybookMetadata,
  storybookMetadata,
  storybookVersionStatus,
} = require('./storybookFormat.cjs');
const {
  characterCardMetadata,
  characterCardVersionStatus,
  currentCharacterCardFormatVersion,
  currentEncryptedCharacterCardEnvelopeFormatVersion,
  encryptedCharacterCardMetadata,
} = require('./characterCardFormat.cjs');

const developmentUrl = 'http://localhost:5173';
const projectRootPath = path.join(__dirname, '..');
function sortComfyWorkflowPaths(paths) {
  return [...paths].sort((left, right) => {
    const leftDefault = left.includes('/higgs_audio_v3-tts.json') || left.includes('/Krea2.json');
    const rightDefault = right.includes('/higgs_audio_v3-tts.json') || right.includes('/Krea2.json');
    if (leftDefault !== rightDefault) {
      return leftDefault ? -1 : 1;
    }
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function bundledComfyWorkflowsForRole(role) {
  const relativeDir = `comfy-workflows/api-workflows-with-variables/${role}`;
  const absoluteDir = path.join(projectRootPath, relativeDir);
  try {
    return sortComfyWorkflowPaths(
      fsSync.readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.json'))
        .map((entry) => `${relativeDir}/${entry.name}`),
    ).map((apiWorkflowPath) => ({ role, apiWorkflowPath }));
  } catch {
    return [];
  }
}

const bundledComfyWorkflows = [
  ...bundledComfyWorkflowsForRole('image'),
  ...bundledComfyWorkflowsForRole('voice'),
];
const maxComfyVoiceSampleBytes = 24 * 1024 * 1024;
const windowCloseCleanupTimeoutMs = 8000;
const appIconPath = path.join(
  __dirname,
  process.platform === 'win32'
    ? '../src/assets/app-icons/rpgraph.ico'
    : '../src/assets/app-icons/rpgraph.png',
);
const jsonFileExtension = '.json';
const maxSelectedImageBytes = 32 * 1024 * 1024;
const maxSelectedImagesTotalBytes = 96 * 1024 * 1024;
const sessionCipherAad = Buffer.from('rpgraph-encrypted-session:v2.1');
const workflowCipherAad = Buffer.from('rpgraph-encrypted-workflow:v2');
const storybookCipherAad = Buffer.from('rpgraph-encrypted-storybook:v1');
const characterCardCipherAad = Buffer.from('rpgraph-encrypted-character:v1');
const approvedWorkflowPaths = new Set();
const approvedFilePaths = new Set();
const approvedComfyWorkflowPaths = new Set(
  bundledComfyWorkflows.map((workflow) => path.resolve(projectRootPath, workflow.apiWorkflowPath)),
);

function resolveProjectPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    throw new Error('Project path is missing.');
  }
  const resolved = path.resolve(projectRootPath, relativePath);
  const relative = path.relative(projectRootPath, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Project path must stay inside the application folder.');
  }
  return resolved;
}

function bundledDefaultWorkflowPaths() {
  const names = bundledDefaultWorkflowFileNames(fsSync.readdirSync(projectRootPath));
  if (names.length === 0) {
    throw new Error('No workflow.default*.json file was found in the app directory.');
  }
  return names.map((name) => {
    const resolved = path.resolve(projectRootPath, name);
    approvedWorkflowPaths.add(resolved);
    return resolved;
  });
}

function bundledDefaultWorkflowPath() {
  const paths = bundledDefaultWorkflowPaths();
  return paths[paths.length - 1];
}
const activeLlmRequests = new Map();
const pendingCancelledLlmRequests = new Set();
const fileBaseNameControlCharacters = `${String.fromCharCode(0)}-${String.fromCharCode(31)}`;
const invalidFileBaseNameCharacters = new RegExp(`[<>:"/\\\\|?*${fileBaseNameControlCharacters}]`, 'g');
let settingsWriteQueue = Promise.resolve();
let windowStateSaveTimer;

function configureLinuxVideoAcceleration() {
  if (process.platform !== 'linux') {
    return;
  }

  app.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder,VaapiVideoEncoder');
  app.commandLine.appendSwitch('disable-accelerated-video-decode');
}

function configureLinuxChromiumLogging() {
  if (process.platform !== 'linux') {
    return;
  }
  // Chromium's compositor logs harmless "Frame latency is negative" errors on
  // Linux (sub-millisecond display timing rounding). Chromium has no
  // per-message filter, so raise the terminal log threshold to FATAL.
  // Node-side console output from this file is unaffected.
  app.commandLine.appendSwitch('log-level', '3');
}

configureLinuxVideoAcceleration();
configureLinuxChromiumLogging();

app.setName('RPgraph Studio');
if (process.platform === 'win32') {
  app.setAppUserModelId('studio.rpgraph.app');
} else if (process.platform === 'linux') {
  app.setDesktopName('rpgraph-studio.desktop');
}

function normalizedWorkflowPath(filePath) {
  if (
    typeof filePath !== 'string' ||
    !filePath ||
    filePath.includes('\0') ||
    !filePath.toLowerCase().endsWith('.json')
  ) {
    throw new Error('Invalid workflow file path.');
  }
  return path.resolve(filePath);
}

function approveWorkflowPath(filePath) {
  const resolved = normalizedWorkflowPath(filePath);
  approvedWorkflowPaths.add(resolved);
  return resolved;
}

function validateWorkflowPath(filePath) {
  const resolved = normalizedWorkflowPath(filePath);
  if (!approvedWorkflowPaths.has(resolved)) {
    throw new Error('Workflow path was not selected through the application.');
  }
  return resolved;
}

function normalizedFilePath(filePath) {
  if (
    typeof filePath !== 'string' ||
    !filePath ||
    filePath.includes('\0') ||
    !filePath.toLowerCase().endsWith('.json')
  ) {
    throw new Error('Invalid RPGraph file path.');
  }
  return path.resolve(filePath);
}

function approveFilePath(filePath) {
  const resolved = normalizedFilePath(filePath);
  approvedFilePaths.add(resolved);
  return resolved;
}

function validateFilePath(filePath) {
  const resolved = normalizedFilePath(filePath);
  if (!approvedFilePaths.has(resolved)) {
    throw new Error('RPGraph file path was not selected through the application.');
  }
  return resolved;
}

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function apiKeyEncryptionAvailable() {
  return Boolean(safeStorage?.isEncryptionAvailable?.());
}

function encryptedApiKeyPayload(apiKey) {
  if (!apiKey) {
    return undefined;
  }
  if (!apiKeyEncryptionAvailable()) {
    return undefined;
  }
  return {
    format: 'electron-safe-storage',
    value: safeStorage.encryptString(apiKey).toString('base64'),
  };
}

function decryptedApiKeyPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (payload.format !== 'electron-safe-storage' || typeof payload.value !== 'string') {
    return '';
  }
  if (!apiKeyEncryptionAvailable()) {
    return '';
  }
  return safeStorage.decryptString(Buffer.from(payload.value, 'base64'));
}

function settingsHasEncryptedApiKeys(settings) {
  return Boolean(
    settings &&
      typeof settings === 'object' &&
      Array.isArray(settings.connections) &&
      settings.connections.some((connection) => Boolean(connection?.apiKeyEncrypted)),
  );
}

function settingsForDisk(settings) {
  const encryptedSettings = structuredClone(settings);
  if (!Array.isArray(encryptedSettings.connections)) {
    return encryptedSettings;
  }
  encryptedSettings.apiKeyStorage = apiKeyEncryptionAvailable() ? 'encrypted' : 'plain';
  encryptedSettings.connections = encryptedSettings.connections.map((connection) => {
    const nextConnection = { ...connection };
    const encryptedApiKey = encryptedApiKeyPayload(nextConnection.apiKey);
    if (encryptedApiKey) {
      nextConnection.apiKeyEncrypted = encryptedApiKey;
      nextConnection.apiKey = '';
    } else if (nextConnection.apiKey) {
      delete nextConnection.apiKeyEncrypted;
    } else if (!nextConnection.apiKeyEncrypted) {
      delete nextConnection.apiKeyEncrypted;
    }
    return nextConnection;
  });
  return encryptedSettings;
}

function settingsFromDisk(settings) {
  if (!settings || typeof settings !== 'object' || !Array.isArray(settings.connections)) {
    return settings;
  }
  return {
    ...settings,
    apiKeyStorage: undefined,
    connections: settings.connections.map((connection) => {
      if (!connection || typeof connection !== 'object') {
        return connection;
      }
      const apiKey = connection.apiKey || decryptedApiKeyPayload(connection.apiKeyEncrypted);
      if (connection.apiKeyEncrypted && !apiKeyEncryptionAvailable()) {
        return {
          ...connection,
          apiKey,
        };
      }
      const rest = { ...connection };
      delete rest.apiKeyEncrypted;
      return {
        ...rest,
        apiKey,
      };
    }),
  };
}

function windowStateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function imageDialogStateFilePath() {
  return path.join(app.getPath('userData'), 'image-dialog-state.json');
}

function workflowStateFilePath() {
  return path.join(app.getPath('userData'), 'workflow-state.json');
}

function filesDirectory() {
  return path.join(app.getPath('userData'), 'files');
}

function charactersDirectory() {
  return path.join(app.getPath('userData'), 'characters');
}

function storedFileDirectory(storage) {
  return storage === 'characters' ? charactersDirectory() : filesDirectory();
}

async function listedFilesInDirectory(directory, storage) {
  await fs.mkdir(directory, { recursive: true });
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(jsonFileExtension))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const stats = await fs.stat(filePath);
        const metadata = await readStoredFileMetadata(filePath);
        return {
          fileName: entry.name,
          name: metadata.characterName || storedJsonName(entry.name),
          updatedAt: stats.mtime.toISOString(),
          storage,
          ...metadata,
        };
      }),
  );
}

function isStoredFilePath(filePath) {
  return path.dirname(path.resolve(filePath)) === path.resolve(filesDirectory());
}

async function loadImageDialogDirectory() {
  try {
    const contents = await fs.readFile(imageDialogStateFilePath(), 'utf8');
    const state = JSON.parse(contents);
    if (typeof state.lastDirectory !== 'string' || !state.lastDirectory) {
      return app.getPath('pictures');
    }
    const directoryStats = await fs.stat(state.lastDirectory);
    return directoryStats.isDirectory() ? state.lastDirectory : app.getPath('pictures');
  } catch {
    return app.getPath('pictures');
  }
}

async function saveImageDialogDirectory(directory) {
  const filePath = imageDialogStateFilePath();
  const contents = `${JSON.stringify({ lastDirectory: directory }, null, 2)}\n`;
  await writeTextFileAtomically(filePath, contents);
}

function imageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  return mimeTypes[extension] ?? 'application/octet-stream';
}

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function validWindowBounds(bounds) {
  return (
    bounds &&
    typeof bounds.x === 'number' &&
    typeof bounds.y === 'number' &&
    typeof bounds.width === 'number' &&
    typeof bounds.height === 'number' &&
    bounds.width >= 980 &&
    bounds.height >= 620
  );
}

async function loadWindowState() {
  try {
    const contents = await fs.readFile(windowStateFilePath(), 'utf8');
    const state = JSON.parse(contents);
    return {
      bounds: validWindowBounds(state.bounds) ? state.bounds : undefined,
      isMaximized: state.isMaximized === true,
      isFullScreen: state.isFullScreen === true,
    };
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error('Unable to read window state:', error);
    }
    return { isMaximized: true, isFullScreen: false };
  }
}

function saveWindowState(window) {
  if (window.isDestroyed()) {
    return;
  }
  const state = {
    bounds: window.getNormalBounds(),
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen(),
  };
  const filePath = windowStateFilePath();
  try {
    fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
    fsSync.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('Unable to save window state:', error);
  }
}

function scheduleWindowStateSave(window) {
  clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => saveWindowState(window), 180);
}

function safeSessionBaseName(value) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(invalidFileBaseNameCharacters, '-')
    .replace(/[. ]+$/g, '')
    .replace(/(\.rpgraph-session)?\.json$/i, '')
    .slice(0, 80);
  const baseName = cleaned || `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(baseName)
    ? `session-${baseName}`
    : baseName;
}

function safeWorkflowBaseName(value) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(invalidFileBaseNameCharacters, '-')
    .replace(/[. ]+$/g, '')
    .replace(/(\.rpgraph)?\.json$/i, '')
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
    .slice(0, 80);
  const baseName = cleaned || `storybook-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(baseName)
    ? `storybook-${baseName}`
    : baseName;
}

function validatedStoredFileName(fileName) {
  if (
    typeof fileName !== 'string' ||
    path.basename(fileName) !== fileName ||
    !fileName.toLowerCase().endsWith(jsonFileExtension)
  ) {
    throw new Error('Invalid RPGraph file name.');
  }
  return fileName;
}

function safeCharacterCardBaseName(value) {
  const cleaned = String(value ?? '')
    .trim()
    .replace(invalidFileBaseNameCharacters, '-')
    .replace(/[. ]+$/g, '')
    .replace(/(\.rpgraph-character)?\.json$/i, '')
    .slice(0, 80);
  const baseName = cleaned || `character-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(baseName)
    ? `${baseName}-file`
    : baseName;
}

function storedJsonName(fileName) {
  return fileName.replace(/(\.rpgraph-storybook|\.rpgraph-character|\.rpgraph-session|\.rpgraph)?\.json$/i, '');
}

function storedFileMetadata(value) {
  if (value?.format === 'rpgraph-storybook') {
    return storybookMetadata(value);
  }
  if (value?.format === 'rpgraph-encrypted-storybook') {
    return encryptedStorybookMetadata(value);
  }
  if (value?.format === 'rpgraph-character') {
    return characterCardMetadata(value);
  }
  if (value?.format === 'rpgraph-encrypted-character') {
    return encryptedCharacterCardMetadata(value);
  }
  if (value?.format === 'rpgraph-workflow') {
    return workflowMetadata(value);
  }
  if (value?.format === 'rpgraph-encrypted-workflow') {
    return encryptedWorkflowMetadata(value);
  }
  if (value?.format === 'rpgraph-session') {
    return sessionMetadata(value);
  }
  if (value?.format === 'rpgraph-encrypted-session') {
    return encryptedSessionMetadata(value);
  }
  return { type: 'unknown', protection: 'unknown', compatible: false };
}

async function readStoredFileMetadata(filePath) {
  try {
    return storedFileMetadata(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch {
    return { type: 'unknown', protection: 'unknown', compatible: false };
  }
}

async function assertOverwriteType(filePath, expectedType) {
  let metadata;
  try {
    metadata = storedFileMetadata(JSON.parse(await fs.readFile(filePath, 'utf8')));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw new Error(`Cannot overwrite an unreadable file with a ${expectedType}. Choose another name.`, {
      cause: error,
    });
  }
  if (metadata.type !== expectedType) {
    throw new Error(
      `Cannot overwrite a ${metadata.type} file with a ${expectedType}. Choose another name.`,
    );
  }
}

async function writeTextFileAtomically(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(temporaryPath);
    } catch (cleanupError) {
      if (!cleanupError || cleanupError.code !== 'ENOENT') {
        console.error('Unable to clean up temporary file:', cleanupError);
      }
    }
    throw error;
  }
}

async function writeNewTextFileAtomically(filePath, contents) {
  // Detect name conflicts up front; the temp-file rename in
  // writeTextFileAtomically would silently overwrite an existing file. The
  // check-then-write race is acceptable for this single-user desktop app.
  if (fsSync.existsSync(filePath)) {
    const error = new Error(`File already exists: ${filePath}`);
    error.code = 'EEXIST';
    throw error;
  }
  await writeTextFileAtomically(filePath, contents);
}

async function loadWorkflowState() {
  try {
    const state = JSON.parse(await fs.readFile(workflowStateFilePath(), 'utf8'));
    return {
      lastWorkflowFileName:
        typeof state.lastWorkflowFileName === 'string'
          ? path.basename(state.lastWorkflowFileName)
          : '',
      importedDefaultFileNames: importedDefaultFileNamesFromState(state),
    };
  } catch {
    return { lastWorkflowFileName: '', importedDefaultFileNames: [] };
  }
}

async function saveWorkflowState(partialState) {
  const state = { ...(await loadWorkflowState()), ...partialState };
  await writeTextFileAtomically(workflowStateFilePath(), `${JSON.stringify(state, null, 2)}\n`);
}

async function saveLastWorkflowFileName(fileName) {
  await saveWorkflowState({ lastWorkflowFileName: validatedStoredFileName(fileName) });
}

async function workflowFiles() {
  const directory = filesDirectory();
  await fs.mkdir(directory, { recursive: true });
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(jsonFileExtension))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const stats = await fs.stat(filePath);
        const metadata = await readStoredFileMetadata(filePath);
        return {
          fileName: entry.name,
          name: storedJsonName(entry.name),
          filePath,
          updatedAt: stats.mtime.toISOString(),
          ...metadata,
        };
      }),
  );
  return files
    .filter((file) => file.type === 'workflow')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function restoreDefaultWorkflowFile() {
  return ensureBundledDefaultWorkflowFiles(false);
}

async function refreshDefaultWorkflowFile() {
  return ensureBundledDefaultWorkflowFiles(true);
}

async function ensureDefaultWorkflowFile(
  overwriteExisting,
  bundledPath = bundledDefaultWorkflowPath(),
  activate = true,
) {
  const bundledFileName = path.basename(bundledPath);
  const directory = filesDirectory();
  await fs.mkdir(directory, { recursive: true });
  const baseName = bundledFileName.replace(/\.json$/i, '');
  let fileName = `${baseName}${jsonFileExtension}`;
  let filePath = path.join(directory, fileName);
  for (let index = 2; fsSync.existsSync(filePath); index += 1) {
    const metadata = await readStoredFileMetadata(filePath);
    if (metadata.type === 'workflow' && metadata.protection === 'plain' && metadata.compatible) {
      if (overwriteExisting) {
        const contents = await fs.readFile(bundledPath, 'utf8');
        await writeTextFileAtomically(filePath, contents);
      }
      approveWorkflowPath(filePath);
      const state = await loadWorkflowState();
      await saveWorkflowState({
        ...(activate ? { lastWorkflowFileName: validatedStoredFileName(fileName) } : {}),
        importedDefaultFileNames: Array.from(new Set([
          ...state.importedDefaultFileNames,
          bundledFileName,
        ])),
      });
      return { fileName, name: storedJsonName(fileName), filePath };
    }
    fileName = `${baseName}-${index}${jsonFileExtension}`;
    filePath = path.join(directory, fileName);
  }
  const contents = await fs.readFile(bundledPath, 'utf8');
  await writeNewTextFileAtomically(filePath, contents);
  approveWorkflowPath(filePath);
  const state = await loadWorkflowState();
  await saveWorkflowState({
    ...(activate ? { lastWorkflowFileName: validatedStoredFileName(fileName) } : {}),
    importedDefaultFileNames: Array.from(new Set([
      ...state.importedDefaultFileNames,
      bundledFileName,
    ])),
  });
  return { fileName, name: storedJsonName(fileName), filePath };
}

async function ensureBundledDefaultWorkflowFiles(overwriteExisting) {
  return restoreBundledDefaultWorkflows(
    bundledDefaultWorkflowPaths(),
    (bundledPath) => ensureDefaultWorkflowFile(overwriteExisting, bundledPath, false),
    (primary) => saveLastWorkflowFileName(primary.fileName),
  );
}

async function importMissingBundledDefaultWorkflows() {
  const bundledPaths = bundledDefaultWorkflowPaths();
  const initialState = await loadWorkflowState();
  const importedNames = new Set(initialState.importedDefaultFileNames);
  const imported = [];
  for (const bundledPath of bundledPaths) {
    const bundledFileName = path.basename(bundledPath);
    if (importedNames.has(bundledFileName)) {
      continue;
    }
    imported.push(await ensureDefaultWorkflowFile(false, bundledPath, false));
  }
  if (!initialState.lastWorkflowFileName && imported.length > 0) {
    await saveLastWorkflowFileName(imported[imported.length - 1].fileName);
  }
  return imported;
}

async function loadStoredWorkflowFile(fileName, password = '') {
  const filePath = approveFilePath(path.join(filesDirectory(), validatedStoredFileName(fileName)));
  const { metadata, value } = await readRpgraphFile(filePath, password);
  if (metadata.type !== 'workflow') {
    throw new Error('The selected file is not a workflow.');
  }
  if (metadata.protection === 'plain') {
    approveWorkflowPath(filePath);
  }
  await saveLastWorkflowFileName(fileName);
  return {
    fileName,
    name: storedJsonName(fileName),
    filePath,
    ...metadata,
    value,
  };
}

function unsupportedSessionFormatError(envelope) {
  const { envelopeFormatVersion, formatVersion } = encryptedSessionMetadata(envelope);
  if (envelopeFormatVersion !== currentEncryptedSessionEnvelopeFormatVersion) {
    return new Error(
      `This encrypted RP save uses Envelope Format ${envelopeFormatVersion ?? 'Unknown'}, which is incompatible with supported Envelope Format ${currentEncryptedSessionEnvelopeFormatVersion}.`,
    );
  }
  return new Error(
    `This RP save uses RP Save Format v${formatVersion ?? 'Unknown'}, which is incompatible with supported RP Save Format v${currentSessionFormatVersion}.`,
  );
}

function unsupportedWorkflowFormatError(envelope) {
  const { envelopeFormatVersion, formatVersion } = encryptedWorkflowMetadata(envelope);
  if (envelopeFormatVersion !== currentEncryptedWorkflowEnvelopeFormatVersion) {
    return new Error(
      `This encrypted workflow uses Envelope Format ${envelopeFormatVersion ?? 'Unknown'}, which is incompatible with supported Envelope Format ${currentEncryptedWorkflowEnvelopeFormatVersion}.`,
    );
  }
  return new Error(
    `This workflow uses Workflow File Format ${formatVersion ?? 'Unknown'}, which is incompatible with supported Workflow File Format ${currentWorkflowFormatVersion}.`,
  );
}

function unsupportedStorybookFormatError(envelope) {
  const { envelopeFormatVersion, formatVersion } = encryptedStorybookMetadata(envelope);
  if (envelopeFormatVersion !== currentEncryptedStorybookEnvelopeFormatVersion) {
    return new Error(
      `This encrypted storybook uses Envelope Format ${envelopeFormatVersion ?? 'Unknown'}, which is incompatible with supported Envelope Format ${currentEncryptedStorybookEnvelopeFormatVersion}.`,
    );
  }
  return new Error(storybookFormatVersionErrorText(formatVersion));
}

function unsupportedCharacterCardFormatError(envelope) {
  const { envelopeFormatVersion, formatVersion } = encryptedCharacterCardMetadata(envelope);
  if (envelopeFormatVersion !== currentEncryptedCharacterCardEnvelopeFormatVersion) {
    return new Error(
      `This encrypted character card uses Envelope Format ${envelopeFormatVersion ?? 'Unknown'}, which is incompatible with supported Envelope Format ${currentEncryptedCharacterCardEnvelopeFormatVersion}.`,
    );
  }
  return new Error(
    `This character card uses Format ${formatVersion ?? 'Unknown'}, which is incompatible with supported Format ${currentCharacterCardFormatVersion}.`,
  );
}

function storybookFormatVersionErrorText(formatVersion) {
  if (storybookVersionStatus(formatVersion) === 'newer') {
    return `This storybook uses Storybook Format ${formatVersion}, which is newer than the supported Storybook Format ${currentStorybookFormatVersion}. Update RPGraph to open it.`;
  }
  return `This storybook uses Storybook Format ${formatVersion ?? 'Unknown'}, which is incompatible with supported Storybook Format ${currentStorybookFormatVersion}.`;
}

function unsupportedStoredFileError(value, metadata) {
  if (metadata.type === 'workflow') {
    if (metadata.protection === 'encrypted' &&
      metadata.envelopeFormatVersion !== currentEncryptedWorkflowEnvelopeFormatVersion) {
      return new Error(
        `This encrypted workflow uses Envelope Format ${metadata.envelopeFormatVersion ?? 'Unknown'}, which is incompatible with supported Envelope Format ${currentEncryptedWorkflowEnvelopeFormatVersion}.`,
      );
    }
    return new Error(
      `This workflow uses Workflow File Format ${metadata.formatVersion ?? 'Unknown'}, which is incompatible with supported Workflow File Format ${currentWorkflowFormatVersion}.`,
    );
  }
  if (metadata.type === 'session') {
    if (metadata.protection === 'encrypted' &&
      metadata.envelopeFormatVersion !== currentEncryptedSessionEnvelopeFormatVersion) {
      return new Error(
        `This encrypted RP save uses Envelope Format ${metadata.envelopeFormatVersion ?? 'Unknown'}, which is incompatible with supported Envelope Format ${currentEncryptedSessionEnvelopeFormatVersion}.`,
      );
    }
    return new Error(
      `This RP save uses RP Save Format v${metadata.formatVersion ?? 'Unknown'}, which is incompatible with supported RP Save Format v${currentSessionFormatVersion}.`,
    );
  }
  if (metadata.type === 'storybook') {
    if (metadata.protection === 'encrypted' &&
      metadata.envelopeFormatVersion !== currentEncryptedStorybookEnvelopeFormatVersion) {
      return new Error(
        `This encrypted storybook uses Envelope Format ${metadata.envelopeFormatVersion ?? 'Unknown'}, which is incompatible with supported Envelope Format ${currentEncryptedStorybookEnvelopeFormatVersion}.`,
      );
    }
    return new Error(storybookFormatVersionErrorText(metadata.formatVersion));
  }
  if (metadata.type === 'character-card') {
    if (metadata.protection === 'encrypted' &&
      metadata.envelopeFormatVersion !== currentEncryptedCharacterCardEnvelopeFormatVersion) {
      return new Error(
        `This encrypted character card uses Envelope Format ${metadata.envelopeFormatVersion ?? 'Unknown'}, which is incompatible with supported Envelope Format ${currentEncryptedCharacterCardEnvelopeFormatVersion}.`,
      );
    }
    return new Error(
      `This character card uses Format ${metadata.formatVersion ?? 'Unknown'}, which is incompatible with supported Format ${currentCharacterCardFormatVersion}.`,
    );
  }
  return new Error('This is not a supported RPGraph file.');
}

async function deriveFileKey(password, salt, parameters) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      32,
      { ...parameters, maxmem: 128 * 1024 * 1024 },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

function requiredEncryptionPassword(password) {
  if (typeof password !== 'string' || !password) {
    throw new Error('Password-protected files require a password or PIN.');
  }
  return password;
}

async function encryptSession(session, password) {
  if (
    !session ||
    session.format !== 'rpgraph-session' ||
    session.formatVersion !== currentSessionFormatVersion ||
    session.workflow?.formatVersion !== currentSessionWorkflowFormatVersion ||
    !Array.isArray(session.timeline)
  ) {
    throw new Error(
      `Only RPGraph RP Save Format v${currentSessionFormatVersion} payloads can be encrypted.`,
    );
  }
  requiredEncryptionPassword(password);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveFileKey(password, salt, currentScryptParameters);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(sessionCipherAad);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), 'utf8'),
    cipher.final(),
  ]);
  const latestTurnNumber = session.timeline.reduce((highest, entry) => (
    entry?.kind === 'message' && typeof entry.turnNumber === 'number' && Number.isFinite(entry.turnNumber)
      ? Math.max(highest, entry.turnNumber)
      : highest
  ), 0);

  return {
    format: 'rpgraph-encrypted-session',
    envelopeFormatVersion: currentEncryptedSessionEnvelopeFormatVersion,
    payloadFormat: session.format,
    payloadFormatVersion: session.formatVersion,
    workflowFormatVersion: session.workflow.formatVersion,
    latestTurnNumber,
    encryption: 'aes-256-gcm',
    keyDerivation: 'scrypt',
    keyDerivationParameters: currentScryptParameters,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authenticationTag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

async function encryptWorkflow(workflow, password) {
  if (
    !workflow ||
    workflow.format !== 'rpgraph-workflow' ||
    workflow.formatVersion !== currentWorkflowFormatVersion
  ) {
    throw new Error(
      `Only RPGraph Workflow File Format ${currentWorkflowFormatVersion} payloads can be encrypted.`,
    );
  }
  requiredEncryptionPassword(password);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveFileKey(password, salt, currentScryptParameters);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(workflowCipherAad);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(workflow), 'utf8'),
    cipher.final(),
  ]);

  return {
    format: 'rpgraph-encrypted-workflow',
    envelopeFormatVersion: currentEncryptedWorkflowEnvelopeFormatVersion,
    payloadFormat: workflow.format,
    payloadFormatVersion: workflow.formatVersion,
    encryption: 'aes-256-gcm',
    keyDerivation: 'scrypt',
    keyDerivationParameters: currentScryptParameters,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authenticationTag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

async function encryptStorybook(storybook, password) {
  if (
    !storybook ||
    storybook.format !== 'rpgraph-storybook' ||
    storybook.version !== currentStorybookFormatVersion
  ) {
    throw new Error(
      `Only RPGraph Storybook Format ${currentStorybookFormatVersion} payloads can be encrypted.`,
    );
  }
  requiredEncryptionPassword(password);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveFileKey(password, salt, currentScryptParameters);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(storybookCipherAad);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(storybook), 'utf8'),
    cipher.final(),
  ]);

  return {
    format: 'rpgraph-encrypted-storybook',
    envelopeFormatVersion: currentEncryptedStorybookEnvelopeFormatVersion,
    payloadFormat: storybook.format,
    payloadFormatVersion: storybook.version,
    encryption: 'aes-256-gcm',
    keyDerivation: 'scrypt',
    keyDerivationParameters: currentScryptParameters,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authenticationTag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

async function encryptCharacterCard(card, password) {
  if (
    !card ||
    card.format !== 'rpgraph-character' ||
    characterCardVersionStatus(card.version) !== 'current' ||
    !characterCardMetadata(card).compatible
  ) {
    throw new Error(
      `Only RPGraph Character Card Format ${currentCharacterCardFormatVersion} payloads can be encrypted.`,
    );
  }
  requiredEncryptionPassword(password);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveFileKey(password, salt, currentScryptParameters);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(characterCardCipherAad);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(card), 'utf8'),
    cipher.final(),
  ]);

  return {
    format: 'rpgraph-encrypted-character',
    envelopeFormatVersion: currentEncryptedCharacterCardEnvelopeFormatVersion,
    payloadFormat: card.format,
    payloadFormatVersion: card.version,
    characterName: typeof card.character.name === 'string' ? card.character.name : '',
    encryption: 'aes-256-gcm',
    keyDerivation: 'scrypt',
    keyDerivationParameters: currentScryptParameters,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authenticationTag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

async function decryptSession(envelope, password) {
  if (!envelope || envelope.format !== 'rpgraph-encrypted-session') {
    throw new Error('This is not a supported encrypted session file.');
  }
  if (!encryptedSessionMetadata(envelope).compatible) {
    throw unsupportedSessionFormatError(envelope);
  }
  if (
    envelope.encryption !== 'aes-256-gcm' ||
    envelope.keyDerivation !== 'scrypt'
  ) {
    throw new Error('This RPGraph session file uses an unsupported format version.');
  }
  requiredEncryptionPassword(password);

  try {
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const key = await deriveFileKey(password, salt, envelope.keyDerivationParameters);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(sessionCipherAad);
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    const session = JSON.parse(decrypted.toString('utf8'));
    if (
      !session ||
      session.format !== envelope.payloadFormat ||
      session.formatVersion !== envelope.payloadFormatVersion ||
      session.workflow?.formatVersion !== envelope.workflowFormatVersion ||
      !Array.isArray(session.timeline) ||
      session.timeline.reduce((highest, entry) => (
        entry?.kind === 'message' && typeof entry.turnNumber === 'number' && Number.isFinite(entry.turnNumber)
          ? Math.max(highest, entry.turnNumber)
          : highest
      ), 0) !== envelope.latestTurnNumber
    ) {
      throw new Error('Encrypted session metadata does not match its payload.');
    }
    return session;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Encrypted session metadata does not match its payload.'
    ) {
      throw error;
    }
    throw new Error('Unable to unlock session. The password is incorrect or the file is damaged.', {
      cause: error,
    });
  }
}

async function decryptWorkflow(envelope, password) {
  if (!envelope || envelope.format !== 'rpgraph-encrypted-workflow') {
    throw new Error('This is not a supported encrypted workflow file.');
  }
  if (!encryptedWorkflowMetadata(envelope).compatible) {
    throw unsupportedWorkflowFormatError(envelope);
  }
  requiredEncryptionPassword(password);

  try {
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const key = await deriveFileKey(password, salt, envelope.keyDerivationParameters);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(workflowCipherAad);
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    const workflow = JSON.parse(decrypted.toString('utf8'));
    if (
      !workflow ||
      workflow.format !== envelope.payloadFormat ||
      workflow.formatVersion !== envelope.payloadFormatVersion
    ) {
      throw new Error('Encrypted workflow metadata does not match its payload.');
    }
    return workflow;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Encrypted workflow metadata does not match its payload.'
    ) {
      throw error;
    }
    throw new Error('Unable to unlock workflow. The password is incorrect or the file is damaged.', {
      cause: error,
    });
  }
}

async function decryptStorybook(envelope, password) {
  if (!envelope || envelope.format !== 'rpgraph-encrypted-storybook') {
    throw new Error('This is not a supported encrypted storybook file.');
  }
  if (!encryptedStorybookMetadata(envelope).compatible) {
    throw unsupportedStorybookFormatError(envelope);
  }
  requiredEncryptionPassword(password);

  try {
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const key = await deriveFileKey(password, salt, envelope.keyDerivationParameters);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(storybookCipherAad);
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    const storybook = JSON.parse(decrypted.toString('utf8'));
    if (
      !storybook ||
      storybook.format !== envelope.payloadFormat ||
      storybook.version !== envelope.payloadFormatVersion
    ) {
      throw new Error('Encrypted storybook metadata does not match its payload.');
    }
    return storybook;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Encrypted storybook metadata does not match its payload.'
    ) {
      throw error;
    }
    throw new Error('Unable to unlock storybook. The password is incorrect or the file is damaged.', {
      cause: error,
    });
  }
}

async function decryptCharacterCard(envelope, password) {
  if (!envelope || envelope.format !== 'rpgraph-encrypted-character') {
    throw new Error('This is not a supported encrypted character card.');
  }
  if (!encryptedCharacterCardMetadata(envelope).compatible) {
    throw unsupportedCharacterCardFormatError(envelope);
  }
  requiredEncryptionPassword(password);

  try {
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const key = await deriveFileKey(password, salt, envelope.keyDerivationParameters);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(characterCardCipherAad);
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    const card = JSON.parse(decrypted.toString('utf8'));
    if (
      !card ||
      card.format !== envelope.payloadFormat ||
      card.version !== envelope.payloadFormatVersion ||
      (typeof card.character?.name === 'string' ? card.character.name : '') !== envelope.characterName
    ) {
      throw new Error('Encrypted character card metadata does not match its payload.');
    }
    return card;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Encrypted character card metadata does not match its payload.'
    ) {
      throw error;
    }
    throw new Error(
      'Unable to unlock character card. The password is incorrect or the file is damaged.',
      { cause: error },
    );
  }
}

async function readRpgraphFile(filePath, password) {
  const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const metadata = storedFileMetadata(value);
  if (!metadata.compatible) {
    throw unsupportedStoredFileError(value, metadata);
  }
  if (metadata.type === 'workflow') {
    return {
      metadata,
      value: metadata.protection === 'encrypted'
        ? await decryptWorkflow(value, password)
        : value,
    };
  }
  if (metadata.type === 'storybook') {
    return {
      metadata,
      value: metadata.protection === 'encrypted'
        ? await decryptStorybook(value, password)
        : value,
    };
  }
  if (metadata.type === 'session') {
    return {
      metadata,
      value: metadata.protection === 'encrypted'
        ? await decryptSession(value, password)
        : value,
    };
  }
  if (metadata.type === 'character-card') {
    return {
      metadata,
      value: metadata.protection === 'encrypted'
        ? await decryptCharacterCard(value, password)
        : value,
    };
  }
  throw new Error('This is not a supported RPGraph file.');
}

function endpoint(baseUrl, route) {
  return `${baseUrl.replace(/\/+$/, '')}/${route}`;
}

function lmStudioBaseUrl(connection) {
  const baseUrl = typeof connection?.baseUrl === 'string' && connection.baseUrl.trim()
    ? connection.baseUrl.trim()
    : 'http://localhost:1234/v1';
  const parsed = new URL(baseUrl);
  if (parsed.pathname.replace(/\/+$/, '') === '/v1') {
    parsed.pathname = '/';
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function lmStudioEndpoint(connection, route) {
  return `${lmStudioBaseUrl(connection)}/api/v1/${route}`;
}

function lmStudioV0Endpoint(connection, route) {
  return `${lmStudioBaseUrl(connection)}/api/v0/${route}`;
}

function nativeProviderBaseUrl(connection, defaultBaseUrl) {
  const baseUrl = typeof connection?.baseUrl === 'string' && connection.baseUrl.trim()
    ? connection.baseUrl.trim()
    : defaultBaseUrl;
  const parsed = new URL(baseUrl);
  if (parsed.pathname.replace(/\/+$/, '') === '/v1') {
    parsed.pathname = '/';
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function ollamaBaseUrl(connection) {
  return nativeProviderBaseUrl(connection, 'http://localhost:11434/v1');
}

function llamaCppBaseUrl(connection) {
  return nativeProviderBaseUrl(connection, 'http://localhost:8080/v1');
}

function llamaCppEndpoint(connection, route) {
  return `${llamaCppBaseUrl(connection)}/${route}`;
}

function llamaCppModelEntries(result) {
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.models)) return result.models;
  return Array.isArray(result) ? result : [];
}

function llamaCppNormalizedModel(model) {
  const id = [model?.id, model?.model].find((value) => typeof value === 'string' && value.trim())?.trim();
  if (!id) return null;
  const architecture = model?.architecture && typeof model.architecture === 'object' ? model.architecture : {};
  const inputModalities = stringArray(architecture.input_modalities);
  const rawStatus = typeof model?.status?.value === 'string' ? model.status.value : model?.status;
  const status = ['unloaded', 'loading', 'loaded', 'sleeping', 'failed'].includes(rawStatus) ? rawStatus : 'unknown';
  return {
    id,
    name: typeof model?.name === 'string' && model.name.trim() ? model.name.trim() : id,
    text: inputModalities.includes('text'),
    vision: inputModalities.includes('image'),
    status,
  };
}

function ollamaEndpoint(connection, route) {
  return `${ollamaBaseUrl(connection)}/api/${route}`;
}

function lmStudioModelEntries(result) {
  if (Array.isArray(result?.data)) {
    return result.data;
  }
  if (Array.isArray(result?.models)) {
    return result.models;
  }
  return Array.isArray(result) ? result : [];
}

function lmStudioModelKey(model) {
  return [model?.key, model?.model_key, model?.id, model?.model]
    .find((value) => typeof value === 'string' && value.trim());
}

function lmStudioModelDisplayName(model, key) {
  return [model?.display_name, model?.name, model?.path, key]
    .find((value) => typeof value === 'string' && value.trim()) ?? key;
}

function lmStudioNormalizedModel(model) {
  const id = lmStudioModelKey(model);
  if (!id) {
    return null;
  }
  const capabilities = model?.capabilities && typeof model.capabilities === 'object'
    ? model.capabilities
    : {};
  const type = typeof model?.type === 'string' ? model.type : undefined;
  return {
    id: id.trim(),
    name: lmStudioModelDisplayName(model, id).trim(),
    type,
    vision: capabilities.vision === true || type === 'vlm',
    trainedForToolUse: capabilities.trained_for_tool_use === true,
  };
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string')
    : [];
}

function ollamaModelId(model) {
  return [model?.model, model?.name]
    .find((value) => typeof value === 'string' && value.trim())
    ?.trim() ?? '';
}

function ollamaNormalizedModel(model, capabilities) {
  const id = ollamaModelId(model);
  if (!id) {
    return null;
  }
  // Older Ollama versions omit `capabilities` in /api/show; treat those
  // models as plain text models instead of dropping them.
  if (capabilities.length > 0 && !capabilities.includes('completion')) {
    return null;
  }
  return {
    id,
    name: typeof model?.name === 'string' && model.name.trim() ? model.name.trim() : id,
    vision: capabilities.includes('vision'),
    trainedForToolUse: capabilities.includes('tools'),
  };
}

function openRouterNormalizedModel(model) {
  const id = typeof model?.id === 'string' ? model.id.trim() : '';
  if (!id) {
    return null;
  }
  const architecture = model?.architecture && typeof model.architecture === 'object'
    ? model.architecture
    : {};
  const inputModalities = stringArray(architecture.input_modalities);
  const outputModalities = stringArray(architecture.output_modalities);
  return {
    id,
    name: typeof model?.name === 'string' && model.name.trim() ? model.name.trim() : id,
    text: outputModalities.includes('text'),
    vision: inputModalities.includes('image'),
    image: outputModalities.includes('image'),
    voice: outputModalities.includes('audio') || outputModalities.includes('speech') || Array.isArray(model?.supported_voices),
    inputModalities,
    outputModalities,
    supportedVoices: stringArray(model?.supported_voices),
    supportedParameters: stringArray(model?.supported_parameters),
    contextLength: Number.isFinite(model?.context_length) ? model.context_length : undefined,
    pricing: model?.pricing,
  };
}

const geminiTtsVoices = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

function geminiModelId(model) {
  const name = typeof model?.name === 'string' ? model.name.trim() : '';
  const baseModelId = typeof model?.baseModelId === 'string' ? model.baseModelId.trim() : '';
  return (baseModelId || name.replace(/^models\//, '')).trim();
}

function geminiNativeModelsUrl(connection) {
  const baseUrl = typeof connection?.baseUrl === 'string' && connection.baseUrl.trim()
    ? connection.baseUrl.trim()
    : 'https://generativelanguage.googleapis.com/v1beta';
  const parsed = new URL(baseUrl);
  parsed.pathname = parsed.pathname.replace(/\/openai\/?$/, '').replace(/\/+$/, '');
  if (!parsed.pathname) {
    parsed.pathname = '/v1beta';
  }
  parsed.pathname = `${parsed.pathname}/models`;
  parsed.search = '';
  parsed.searchParams.set('pageSize', '1000');
  if (typeof connection?.apiKey === 'string' && connection.apiKey.trim()) {
    parsed.searchParams.set('key', connection.apiKey.trim());
  }
  parsed.hash = '';
  return parsed.toString();
}

function geminiNativeBaseUrl(connection) {
  const baseUrl = typeof connection?.baseUrl === 'string' && connection.baseUrl.trim()
    ? connection.baseUrl.trim()
    : 'https://generativelanguage.googleapis.com/v1beta';
  const parsed = new URL(baseUrl);
  parsed.pathname = parsed.pathname.replace(/\/openai\/?$/, '').replace(/\/+$/, '');
  if (!parsed.pathname) {
    parsed.pathname = '/v1beta';
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function geminiApiUrl(connection, route) {
  const model = typeof connection?.model === 'string' && connection.model.trim()
    ? connection.model.trim().replace(/^models\//, '')
    : 'gemini-2.5-flash';
  const url = new URL(`${geminiNativeBaseUrl(connection)}/models/${encodeURIComponent(model)}:${route}`);
  if (typeof connection?.apiKey === 'string' && connection.apiKey.trim()) {
    url.searchParams.set('key', connection.apiKey.trim());
  }
  if (route === 'streamGenerateContent') {
    url.searchParams.set('alt', 'sse');
  }
  return url.toString();
}

function geminiNormalizedModel(model) {
  const id = geminiModelId(model);
  if (!id) {
    return null;
  }
  const supportedGenerationMethods = stringArray(model?.supportedGenerationMethods);
  const description = `${model?.displayName ?? ''} ${model?.description ?? ''} ${id}`.toLowerCase();
  const canGenerate = supportedGenerationMethods.includes('generateContent');
  const isImage = description.includes('image') || description.includes('imagen');
  const isAudio = description.includes('audio') || description.includes('speech') || description.includes('tts');
  const hasVision = canGenerate && !description.includes('embedding') && !isAudio;
  const inputModalities = ['text'];
  if (hasVision || isImage) {
    inputModalities.push('image');
  }
  if (isAudio) {
    inputModalities.push('audio');
  }
  const outputModalities = [];
  if (canGenerate && !isImage && !isAudio) {
    outputModalities.push('text');
  }
  if (isImage) {
    outputModalities.push('image');
  }
  if (isAudio) {
    outputModalities.push('audio');
  }
  return {
    id,
    name: typeof model?.displayName === 'string' && model.displayName.trim()
      ? model.displayName.trim()
      : id,
    text: outputModalities.includes('text'),
    vision: hasVision,
    image: outputModalities.includes('image'),
    voice: outputModalities.includes('audio'),
    inputModalities,
    outputModalities,
    supportedVoices: isAudio ? geminiTtsVoices : [],
    supportedParameters: isAudio ? ['temperature'] : [],
    contextLength: Number.isFinite(model?.inputTokenLimit) ? model.inputTokenLimit : undefined,
    supportedGenerationMethods,
  };
}

function lmStudioLoadedInstanceIds(models, preferredModel) {
  const preferred = typeof preferredModel === 'string' ? preferredModel.trim() : '';
  const entries = lmStudioModelEntries(models);
  const loaded = entries
    .filter((model) => typeof model?.instance_id === 'string' && model.instance_id.trim())
    .filter((model) => {
      if (!preferred) {
        return true;
      }
      const key = lmStudioModelKey(model);
      return !key || key === preferred || model.instance_id === preferred;
    })
    .map((model) => model.instance_id.trim());
  return [...new Set(loaded)];
}

function lmStudioEntryMatchesModel(entry, modelKey) {
  return [
    lmStudioModelKey(entry),
    entry?.identifier,
    entry?.identifier?.split?.(':')[0],
    entry?.modelKey,
    entry?.path,
    entry?.instance_id,
  ].some((value) => typeof value === 'string' && value.trim() === modelKey);
}

// Returns true/false when a source could report the loaded state, or null
// when no source is available. The /api/v1 model list only catalogs
// downloaded models, so loadedness comes from /api/v0 or the lms CLI.
async function lmStudioModelLoadedState(connection, model, abort) {
  try {
    const result = await requestLmStudioV0Json(connection, 'models', {}, abort);
    const entry = lmStudioModelEntries(result).find((candidate) =>
      lmStudioEntryMatchesModel(candidate, model));
    if (entry && typeof entry.state === 'string') {
      return entry.state === 'loaded';
    }
  } catch {
    // Fall through to the CLI check below.
  }
  try {
    const { stdout } = await runLmStudioCli(['ps', '--json']);
    const parsed = JSON.parse(stdout);
    const entries = Array.isArray(parsed) ? parsed : lmStudioModelEntries(parsed);
    return entries.some((entry) => lmStudioEntryMatchesModel(entry, model));
  } catch {
    return null;
  }
}

function lmStudioCliName() {
  return process.platform === 'win32' ? 'lms.cmd' : 'lms';
}

// With a shell, cmd.exe would expand %VAR% inside quotes and an embedded
// quote would break out of the argument, so those characters are rejected.
function quotedWindowsCliArgument(value) {
  if (/["%\r\n]/.test(value)) {
    throw new Error(`Unsupported character in LM Studio CLI argument: ${value}`);
  }
  return `"${value}"`;
}

function runLmStudioCli(args) {
  // Node refuses to spawn .cmd files without a shell (CVE-2024-27980
  // hardening), so Windows runs the CLI through a shell with each argument
  // quoted; other platforms execute the binary directly.
  const useShell = process.platform === 'win32';
  return new Promise((resolve, reject) => {
    execFile(
      lmStudioCliName(),
      useShell ? args.map(quotedWindowsCliArgument) : args,
      { timeout: 60 * 1000, windowsHide: true, shell: useShell },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr || stdout || error.message;
          reject(new Error(message.trim()));
          return;
        }
        resolve({
          stdout: String(stdout ?? '').trim(),
          stderr: String(stderr ?? '').trim(),
        });
      },
    );
  });
}

function linuxMemoryStats() {
  if (process.platform !== 'linux') {
    return null;
  }
  try {
    const fields = Object.fromEntries(
      fsSync.readFileSync('/proc/meminfo', 'utf8')
        .split('\n')
        .map((line) => {
          const match = /^([A-Za-z_()]+):\s+(\d+)\s+kB$/.exec(line.trim());
          return match ? [match[1], Number(match[2]) * 1024] : null;
        })
        .filter(Boolean),
    );
    const totalBytes = fields.MemTotal;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return null;
    }
    const availableBytes = Number.isFinite(fields.MemAvailable) ? fields.MemAvailable : os.freemem();
    const cachedBytes =
      (Number.isFinite(fields.Cached) ? fields.Cached : 0) +
      (Number.isFinite(fields.Buffers) ? fields.Buffers : 0) +
      (Number.isFinite(fields.SReclaimable) ? fields.SReclaimable : 0);
    return {
      totalBytes,
      usedBytes: Math.max(0, totalBytes - availableBytes),
      cachedBytes: Math.max(0, cachedBytes),
    };
  } catch {
    return null;
  }
}

function memoryStats() {
  const linuxStats = linuxMemoryStats();
  if (linuxStats) {
    return linuxStats;
  }
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  return {
    totalBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes),
  };
}

function runNvidiaSmiMemoryQuery() {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 2500, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const rows = String(stdout ?? '')
          .trim()
          .split(/\r?\n/)
          .map((line) => line.split(',').map((value) => Number(value.trim())))
          .filter(([used, total]) => Number.isFinite(used) && Number.isFinite(total) && total > 0);
        if (rows.length === 0) {
          resolve(null);
          return;
        }
        const mibToBytes = 1024 * 1024;
        const totals = rows.reduce(
          (sum, [used, total]) => ({
            usedBytes: sum.usedBytes + used * mibToBytes,
            totalBytes: sum.totalBytes + total * mibToBytes,
          }),
          { usedBytes: 0, totalBytes: 0 },
        );
        resolve({
          ...totals,
          source: 'nvidia-smi',
        });
      },
    );
  });
}

function isAllowedNavigationUrl(url) {
  if (process.argv.includes('--dev')) {
    return url.startsWith(developmentUrl);
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:' &&
      path.normalize(parsed.pathname).startsWith(path.normalize(path.join(__dirname, '../dist')));
  } catch {
    return false;
  }
}

function requestHeaders(connection) {
  const headers = { 'Content-Type': 'application/json' };
  if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  }
  return headers;
}

function chatMessageContent(prompt, images) {
  if (!Array.isArray(images) || images.length === 0) {
    return prompt;
  }
  return [
    { type: 'text', text: prompt },
    ...images
      .filter((image) => image && typeof image.dataUrl === 'string' && image.dataUrl)
      .map((image) => ({
        type: 'image_url',
        image_url: { url: image.dataUrl },
      })),
  ];
}

function geminiInlineDataPart(image) {
  if (!image || typeof image.dataUrl !== 'string') {
    return null;
  }
  const match = image.dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    return null;
  }
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2].replace(/\s+/g, ''),
    },
  };
}

function geminiRequestBody(request) {
  const parts = [
    { text: request.prompt },
    ...(Array.isArray(request.images)
      ? request.images.map(geminiInlineDataPart).filter(Boolean)
      : []),
  ];
  const generationConfig = {};
  if (typeof request.temperature === 'number' && Number.isFinite(request.temperature)) {
    generationConfig.temperature = request.temperature;
  }
  if (typeof request.topP === 'number' && Number.isFinite(request.topP)) {
    generationConfig.topP = request.topP;
  }
  if (Number.isInteger(request.maxTokens) && request.maxTokens > 0) {
    generationConfig.maxOutputTokens = request.maxTokens;
  }
  return {
    contents: [{ role: 'user', parts }],
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };
}

function textFromGeminiContent(content) {
  if (!content || typeof content !== 'object' || !Array.isArray(content.parts)) {
    return '';
  }
  return content.parts
    .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('');
}

function textFromGeminiCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return '';
  }
  return textFromGeminiContent(candidate.content);
}

function emptyGeminiTextError(candidate) {
  const finishReason = typeof candidate?.finishReason === 'string' ? candidate.finishReason : '';
  return new Error(
    finishReason
      ? `The Gemini response does not contain any text (finishReason: ${finishReason}).`
      : 'The Gemini response does not contain any text.',
  );
}

const supportedReasoningEfforts = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

function chatCompletionReasoningOptions(connection) {
  const effort = connection?.reasoningEffort;
  if (!supportedReasoningEfforts.has(effort)) {
    return {};
  }
  if (connection?.providerKind === 'llama-cpp') {
    if (effort === 'none') {
      return {
        chat_template_kwargs: { enable_thinking: false },
        thinking_budget_tokens: 0,
      };
    }
    return {
      chat_template_kwargs: { enable_thinking: true },
    };
  }
  return {
    reasoning: { effort },
  };
}

function chatCompletionSamplingOptions(request) {
  const options = {
    temperature: typeof request.temperature === 'number' ? request.temperature : 0.8,
  };
  if (typeof request.topP === 'number' && Number.isFinite(request.topP)) {
    options.top_p = request.topP;
  }
  if (typeof request.presencePenalty === 'number' && Number.isFinite(request.presencePenalty)) {
    options.presence_penalty = request.presencePenalty;
  }
  if (typeof request.frequencyPenalty === 'number' && Number.isFinite(request.frequencyPenalty)) {
    options.frequency_penalty = request.frequencyPenalty;
  }
  return options;
}

function textFromChatContentPart(part) {
  if (!part || typeof part !== 'object') {
    return '';
  }
  if (typeof part.text === 'string') {
    return part.text;
  }
  if (typeof part.refusal === 'string') {
    return part.refusal;
  }
  if (typeof part.content === 'string') {
    return part.content;
  }
  if (Array.isArray(part.content)) {
    return textFromChatContent(part.content);
  }
  return '';
}

function textFromChatContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(textFromChatContentPart).filter(Boolean).join('');
  }
  return '';
}

function textFromChatMessage(message) {
  if (!message || typeof message !== 'object') {
    return '';
  }
  return textFromChatContent(message.content) ||
    textFromChatContent(message.content_parts) ||
    (typeof message.refusal === 'string' ? message.refusal : '') ||
    (typeof message.text === 'string' ? message.text : '');
}

function textFromChatChoice(choice) {
  if (!choice || typeof choice !== 'object') {
    return '';
  }
  return textFromChatMessage(choice.message) ||
    textFromChatMessage(choice.delta) ||
    (typeof choice.text === 'string' ? choice.text : '');
}

function emptyChatCompletionTextError(choice) {
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : '';
  const details = [];
  if (finishReason) {
    details.push(`finish_reason: ${finishReason}`);
  }
  if (finishReason === 'length') {
    details.push('the output token limit may be too low for this model');
  }
  return new Error(
    details.length
      ? `The LLM response does not contain any text (${details.join('; ')}).`
      : 'The LLM response does not contain any text.',
  );
}

function firstFiniteNumber(...values) {
  return values.find((value) => typeof value === 'number' && Number.isFinite(value));
}

function usageReasoningTokens(usage) {
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }
  return firstFiniteNumber(
    usage.completion_tokens_details?.reasoning_tokens,
    usage.output_tokens_details?.reasoning_tokens,
    usage.reasoning_tokens,
    usage.internal_reasoning_tokens,
    usage.internal_reasoning,
    usage.thoughtsTokenCount,
  );
}

function llmStatsFromUsage(usage, durationMs) {
  const inputTokens = firstFiniteNumber(usage?.prompt_tokens, usage?.input_tokens, usage?.promptTokenCount);
  const rawOutputTokens = firstFiniteNumber(
    usage?.completion_tokens,
    usage?.output_tokens,
    usage?.candidatesTokenCount,
  );
  const totalTokens = firstFiniteNumber(usage?.total_tokens, usage?.totalTokenCount);
  const inferredExtraOutputTokens =
    inputTokens !== undefined && rawOutputTokens !== undefined && totalTokens !== undefined
      ? Math.max(0, totalTokens - inputTokens - rawOutputTokens)
      : 0;
  const outputTokens =
    rawOutputTokens !== undefined
      ? rawOutputTokens + inferredExtraOutputTokens
      : inputTokens !== undefined && totalTokens !== undefined
        ? Math.max(0, totalTokens - inputTokens)
        : undefined;
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: usageReasoningTokens(usage),
    totalTokens,
    durationMs,
  };
}

function llmRequestId(request) {
  return typeof request?.requestId === 'number' && Number.isFinite(request.requestId)
    ? request.requestId
    : undefined;
}

function createLlmAbortController(request) {
  const requestId = llmRequestId(request);
  const controller = new AbortController();
  const cancelHandlers = new Set();
  let timeout;
  const handle = {
    signal: controller.signal,
    abort: (reason = 'cancelled') => {
      for (const cancelHandler of cancelHandlers) {
        try {
          cancelHandler(reason);
        } catch {
          // Best effort: still abort the shared signal below.
        }
      }
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    },
    onCancel: (cancelHandler) => {
      cancelHandlers.add(cancelHandler);
      return () => cancelHandlers.delete(cancelHandler);
    },
    dispose: () => {
      clearTimeout(timeout);
      cancelHandlers.clear();
      if (requestId !== undefined) {
        activeLlmRequests.delete(requestId);
        pendingCancelledLlmRequests.delete(requestId);
      }
    },
  };
  if (requestId !== undefined) {
    activeLlmRequests.set(requestId, handle);
  }
  timeout = setTimeout(() => handle.abort('timeout'), 15 * 60 * 1000);
  if (requestId !== undefined && pendingCancelledLlmRequests.has(requestId)) {
    queueMicrotask(() => handle.abort('cancelled'));
  }
  return handle;
}

function cancelledLlmError() {
  return new Error('The LLM request was cancelled.');
}

function cancelledLlmIpcResult() {
  return { __rpgraphLlmCancelled: true };
}

function failedLlmIpcResult(error) {
  const normalized = normalizeLlmError(error);
  return {
    __rpgraphLlmError: true,
    name: normalized instanceof Error ? normalized.name : 'Error',
    message: normalized instanceof Error ? normalized.message : String(normalized),
  };
}

function normalizeLlmError(error) {
  if (error instanceof Error && error.name === 'AbortError') {
    return cancelledLlmError();
  }
  if (error instanceof TypeError && String(error.message).includes('aborted')) {
    return cancelledLlmError();
  }
  return error;
}

function nodeHttpClient(url) {
  if (url.protocol === 'http:') {
    return http;
  }
  if (url.protocol === 'https:') {
    return https;
  }
  throw new Error(`Unsupported LLM endpoint protocol: ${url.protocol}`);
}

function streamChunkBytes(chunk) {
  return chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk));
}

// Responses are accumulated in memory, so a faulty or malicious provider
// could otherwise grow an endless response until the app crashes.
const maxProviderResponseBytes = 512 * 1024 * 1024;

async function* limitedResponseChunks(stream) {
  let totalBytes = 0;
  for await (const chunk of stream) {
    const bytes = streamChunkBytes(chunk);
    totalBytes += bytes.length;
    if (totalBytes > maxProviderResponseBytes) {
      const error = new Error(
        'The provider response exceeded the 512 MB safety limit and was aborted.',
      );
      stream.destroy(error);
      throw error;
    }
    yield bytes;
  }
}

async function readNodeStreamText(stream) {
  const decoder = new TextDecoder();
  let text = '';
  for await (const bytes of limitedResponseChunks(stream)) {
    text += decoder.decode(bytes, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function readNodeStreamBuffer(stream) {
  const chunks = [];
  for await (const bytes of limitedResponseChunks(stream)) {
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function requestLlmResponse(url, init, abort) {
  if (abort.signal.aborted) {
    return Promise.reject(cancelledLlmError());
  }

  const parsedUrl = new URL(url);
  const client = nodeHttpClient(parsedUrl);
  return new Promise((resolve, reject) => {
    let responseStream;
    const request = client.request(
      parsedUrl,
      {
        method: init.method ?? 'GET',
        headers: init.headers,
        agent: false,
      },
      (response) => {
        responseStream = response;
        response.on('error', () => {});
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          statusText: response.statusMessage ?? '',
          headers: response.headers,
          body: response,
          text: () => readNodeStreamText(response),
          buffer: () => readNodeStreamBuffer(response),
          json: async () => JSON.parse(await readNodeStreamText(response)),
        });
      },
    );
    const destroy = () => {
      const error = cancelledLlmError();
      request.destroy(error);
      if (responseStream && !responseStream.destroyed) {
        responseStream.destroy(error);
      }
    };

    abort.onCancel(destroy);
    request.on('error', (error) => {
      reject(abort.signal.aborted ? cancelledLlmError() : error);
    });

    if (init.body === undefined) {
      request.end();
    } else {
      request.end(init.body);
    }
  });
}

async function readError(response) {
  const body = await response.text();
  return body || `${response.status} ${response.statusText}`;
}

async function requestLmStudioJson(connection, route, init, abort) {
  const response = await requestLlmResponse(lmStudioEndpoint(connection, route), {
    ...init,
    headers: requestHeaders(connection),
  }, abort);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}

async function requestLmStudioV0Json(connection, route, init, abort) {
  const response = await requestLlmResponse(lmStudioV0Endpoint(connection, route), {
    ...init,
    headers: requestHeaders(connection),
  }, abort);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}

async function requestOllamaJson(connection, route, init, abort) {
  const response = await requestLlmResponse(ollamaEndpoint(connection, route), {
    ...init,
    headers: requestHeaders(connection),
  }, abort);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}

async function requestLlamaCppJson(connection, route, init, abort) {
  const response = await requestLlmResponse(llamaCppEndpoint(connection, route), {
    ...init,
    headers: requestHeaders(connection),
  }, abort);
  if (!response.ok) throw new Error(await readError(response));
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}

async function llamaCppModels(connection, abort) {
  const result = await requestLlamaCppJson(connection, 'models', {}, abort);
  return llamaCppModelEntries(result).map(llamaCppNormalizedModel).filter(Boolean);
}

async function waitForLlamaCppStatus(connection, modelId, expected, abort) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const model = (await llamaCppModels(connection, abort)).find((entry) => entry.id === modelId);
    if (model?.status === expected) return model;
    if (expected === 'unloaded' && !model) return null;
    if (expected === 'loaded' && model?.status === 'failed') {
      throw new Error(`llama.cpp failed to load model "${modelId}".`);
    }
    await delay(250, abort);
  }
  throw new Error(`Timed out waiting for llama.cpp model "${modelId}" to become ${expected}.`);
}

async function ensureLlamaCppModelLoaded(connection, abort) {
  if (connection?.providerKind !== 'llama-cpp') return;
  const modelId = typeof connection?.model === 'string' ? connection.model.trim() : '';
  if (!modelId) throw new Error('Choose a model ID before loading a llama.cpp model.');
  const current = (await llamaCppModels(connection, abort)).find((model) => model.id === modelId);
  if (current?.status === 'loaded') return;
  if (current?.status !== 'loading') {
    await requestLlamaCppJson(connection, 'models/load', { method: 'POST', body: JSON.stringify({ model: modelId }) }, abort);
  }
  await waitForLlamaCppStatus(connection, modelId, 'loaded', abort);
}

function comfyBaseUrl(baseUrl) {
  const parsed = new URL(
    typeof baseUrl === 'string' && baseUrl.trim()
      ? baseUrl.trim()
      : 'http://127.0.0.1:8188',
  );
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('ComfyUI URL must use http or https.');
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function comfyEndpoint(baseUrl, route) {
  return endpoint(comfyBaseUrl(baseUrl), route);
}

function normalizedComfyWorkflowPath(filePath) {
  if (
    typeof filePath !== 'string' ||
    !filePath ||
    filePath.includes('\0') ||
    !filePath.toLowerCase().endsWith('.json')
  ) {
    throw new Error('Invalid ComfyUI workflow file path.');
  }
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(path.join(__dirname, '..', filePath));
  return resolved;
}

function approveComfyWorkflowPath(filePath) {
  const resolved = normalizedComfyWorkflowPath(filePath);
  approvedComfyWorkflowPaths.add(resolved);
  return resolved;
}

function validateComfyWorkflowPath(filePath) {
  const resolved = normalizedComfyWorkflowPath(filePath);
  const bundledDirectory = path.resolve(path.join(__dirname, '../comfy-workflows'));
  if (
    !approvedComfyWorkflowPaths.has(resolved) &&
    !resolved.startsWith(`${bundledDirectory}${path.sep}`)
  ) {
    throw new Error('ComfyUI workflow path was not selected through the application.');
  }
  return resolved;
}

function isComfyApiPrompt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const entries = Object.values(value);
  return entries.length > 0 && entries.every((entry) =>
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    typeof entry.class_type === 'string' &&
    entry.inputs &&
    typeof entry.inputs === 'object' &&
    !Array.isArray(entry.inputs),
  );
}

function comfyPromptFromWorkflow(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && isComfyApiPrompt(value.prompt)) {
    return value.prompt;
  }
  if (isComfyApiPrompt(value)) {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.nodes)) {
    throw new Error('This looks like a ComfyUI UI workflow. Export/save it in API format first.');
  }
  throw new Error('This JSON does not look like a ComfyUI API workflow.');
}

function extractComfyWorkflowPlaceholders(value, placeholders = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
      placeholders.add(String(match[1]).toLowerCase());
    }
    return placeholders;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => extractComfyWorkflowPlaceholders(entry, placeholders));
    return placeholders;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => extractComfyWorkflowPlaceholders(entry, placeholders));
  }
  return placeholders;
}

function comfyWorkflowRole(role) {
  return role === 'voice' ? 'voice' : 'image';
}

function comfyWorkflowInspection(value, workflowPath = '', role = 'image') {
  let format = 'unknown';
  let prompt = null;
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.nodes)) {
    format = 'ui';
  } else if (value && typeof value === 'object' && !Array.isArray(value) && isComfyApiPrompt(value.prompt)) {
    format = 'api';
    prompt = value.prompt;
  } else if (isComfyApiPrompt(value)) {
    format = 'api';
    prompt = value;
  }

  const placeholders = Array.from(extractComfyWorkflowPlaceholders(prompt ?? value)).sort();
  const placeholderSet = new Set(placeholders);
  const hasCheckpoint = placeholderSet.has('checkpoint');
  const hasDiffusionModel = placeholderSet.has('diffusion_model');
  const hasLora = placeholders.some((placeholder) => /^lora(_\d+)?$/.test(placeholder));
  const missing = [];

  if (format !== 'api') {
    missing.push(format === 'ui' ? 'API workflow export' : 'ComfyUI API workflow JSON');
  }
  if (placeholders.length === 0) {
    missing.push('RPGraph placeholders');
  }
  if (comfyWorkflowRole(role) === 'voice') {
    for (const required of ['speech_text', 'voice_audio']) {
      if (!placeholderSet.has(required)) {
        missing.push(required);
      }
    }
  } else {
    for (const required of ['width', 'height', 'prompt', 'vae', 'text_encoder']) {
      if (!placeholderSet.has(required)) {
        missing.push(required);
      }
    }
    if (!hasCheckpoint && !hasDiffusionModel) {
      missing.push('checkpoint or diffusion_model');
    }
    if (!hasLora) {
      missing.push('at least one lora placeholder');
    }
  }

  const modelSource = hasCheckpoint && hasDiffusionModel
    ? 'both'
    : hasCheckpoint
      ? 'checkpoint'
      : hasDiffusionModel
        ? 'diffusion_model'
        : 'missing';

  return {
    ok: format === 'api' && missing.length === 0,
    format,
    role: comfyWorkflowRole(role),
    modelSource,
    placeholders,
    missing: Array.from(new Set(missing)),
    workflowPath,
    fileName: workflowPath ? path.basename(workflowPath) : '',
  };
}

function assertComfyWorkflowCompatible(value, workflowPath = '', role = 'image') {
  const inspection = comfyWorkflowInspection(value, workflowPath, role);
  if (!inspection.ok) {
    throw new Error(
      `ComfyUI workflow is not compatible with RPGraph. Missing: ${inspection.missing.join(', ')}.`,
    );
  }
  return inspection;
}

function comfyVoiceWorkflowRepairPrompt(workflowJson, inspection) {
  return `You are fixing a ComfyUI voice generation workflow for RPGraph.

Return only a valid RFC 6902 JSON Patch array. Do not wrap it in Markdown. Do not explain. Do not return the complete workflow.

The patch must transform the provided workflow into a ComfyUI API workflow: an object whose node IDs map to nodes with class_type and inputs. Do not transform it into the ComfyUI UI graph format with nodes/links.

Keep the original workflow logic as much as possible, but make it RPGraph-compatible by using these exact placeholders:
- Text to speak: {{speech_text}} as the spoken text input of the text-to-speech node.
- Reference voice clip: {{voice_audio}} as the audio file name of the LoadAudio node that provides the voice to clone. Remove any audioUI preview inputs from that node.
- Do not invent other RPGraph placeholder names.
- The workflow must save its generated audio as an output. Replace preview-only audio nodes (like PreviewAudio) with a saving node such as SaveAudioMP3 with a filename_prefix input.

Current RPGraph check:
- Format: ${inspection.format}
- Missing: ${inspection.missing.join(', ') || 'none'}
- Existing placeholders: ${inspection.placeholders.join(', ') || 'none'}

Workflow JSON:
${workflowJson}`;
}

function comfyWorkflowRepairPrompt(workflowJson, inspection) {
  if (inspection.role === 'voice') {
    return comfyVoiceWorkflowRepairPrompt(workflowJson, inspection);
  }
  return `You are fixing a ComfyUI workflow for RPGraph.

Return only a valid RFC 6902 JSON Patch array. Do not wrap it in Markdown. Do not explain. Do not return the complete workflow.

The patch must transform the provided workflow into a ComfyUI API workflow: an object whose node IDs map to nodes with class_type and inputs. Do not transform it into the ComfyUI UI graph format with nodes/links.

Keep the original workflow logic as much as possible, but make it RPGraph-compatible by using these exact placeholders:
- Width: {{width}}
- Height: {{height}}
- Positive prompt text: {{prompt}}
- VAE file name: {{vae}}
- Text encoder or CLIP file name: {{text_encoder}}
- Use exactly the model loader style that fits this workflow:
  - If it loads a checkpoint, use {{checkpoint}} for the checkpoint file name.
  - If it loads a diffusion/UNET model, use {{diffusion_model}} for the diffusion model file name.
- Add at least one LoRA loader for character LoRAs. Use {{lora_01}} as the LoRA file name and {{lora_strength_01}} as its strength.
- If you add more optional LoRA slots, use {{lora_02}}, {{lora_strength_02}}, {{lora_03}}, {{lora_strength_03}}, {{lora_04}}, {{lora_strength_04}}.
- If a LoRA slot can be disabled, make it accept "None" as the model name.
- Do not invent other RPGraph placeholder names.

Current RPGraph check:
- Format: ${inspection.format}
- Missing: ${inspection.missing.join(', ') || 'none'}
- Existing placeholders: ${inspection.placeholders.join(', ') || 'none'}

Workflow JSON:
${workflowJson}`;
}

function extractJsonValueFromText(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    throw new Error('The LLM returned empty JSON.');
  }

  const candidates = [trimmed];
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.push(match[1].trim());
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate or balanced object extraction below.
    }
  }

  const start = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  const valueStart = [start, arrayStart].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (valueStart === undefined) {
    throw new Error('The LLM response did not contain JSON.');
  }

  const openChar = trimmed[valueStart];
  const closeChar = openChar === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = valueStart; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(trimmed.slice(valueStart, index + 1));
      }
    }
  }

  throw new Error('The LLM response JSON was incomplete.');
}

function extractJsonObjectFromText(text) {
  const value = extractJsonValueFromText(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }
  return value;
}

function decodeJsonPointerPath(pathValue) {
  if (pathValue === '') {
    return [];
  }
  if (typeof pathValue !== 'string' || !pathValue.startsWith('/')) {
    throw new Error('JSON Patch path must start with /.');
  }
  return pathValue
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function jsonPatchParent(target, pathValue) {
  const parts = decodeJsonPointerPath(pathValue);
  if (parts.length === 0) {
    throw new Error('JSON Patch path cannot target the document root.');
  }
  let parent = target;
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== 'object') {
      throw new Error(`JSON Patch path does not exist: ${pathValue}`);
    }
    parent = parent[part];
  }
  return { parent, key: parts[parts.length - 1] };
}

function applyJsonPatchOperation(target, operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new Error('JSON Patch entries must be objects.');
  }
  const op = operation.op;
  if (op !== 'add' && op !== 'replace' && op !== 'remove') {
    throw new Error(`Unsupported JSON Patch operation: ${String(op)}`);
  }
  const { parent, key } = jsonPatchParent(target, operation.path);
  if (!parent || typeof parent !== 'object') {
    throw new Error(`JSON Patch path has no parent: ${operation.path}`);
  }
  if (Array.isArray(parent)) {
    if (op === 'add' && key === '-') {
      parent.push(operation.value);
      return;
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length + (op === 'add' ? 1 : 0)) {
      throw new Error(`Invalid JSON Patch array index: ${operation.path}`);
    }
    if (op === 'remove') {
      parent.splice(index, 1);
    } else if (op === 'add') {
      parent.splice(index, 0, operation.value);
    } else {
      parent[index] = operation.value;
    }
    return;
  }
  if (op === 'remove') {
    delete parent[key];
    return;
  }
  parent[key] = operation.value;
}

function applyJsonPatchDocument(value, patch) {
  if (!Array.isArray(patch)) {
    throw new Error('The LLM must return a JSON Patch array.');
  }
  let target = structuredClone(value);
  for (const operation of patch) {
    if (operation?.path === '') {
      if (operation.op !== 'replace' && operation.op !== 'add') {
        throw new Error(`Unsupported JSON Patch root operation: ${String(operation.op)}`);
      }
      target = operation.value;
      continue;
    }
    applyJsonPatchOperation(target, operation);
  }
  return target;
}

async function repairComfyWorkflowWithLlm(workflowPath, connection, abort, role = 'image') {
  const contents = await fs.readFile(workflowPath, 'utf8');
  const parsedWorkflow = JSON.parse(contents);
  const inspection = comfyWorkflowInspection(parsedWorkflow, workflowPath, role);
  if (inspection.ok) {
    return {
      ok: true,
      changed: false,
      inspection,
      workflowJson: JSON.stringify(parsedWorkflow, null, 2),
    };
  }

  const model = typeof connection?.model === 'string' ? connection.model.trim() : '';
  if (!model) {
    throw new Error('Choose an LLM provider with a model before fixing the ComfyUI workflow.');
  }

  await freeComfyMemoryForLocalLlm(connection);
  await ensureLlamaCppModelLoaded(connection, abort);
  const response = await requestLlmResponse(endpoint(connection.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: requestHeaders(connection),
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: comfyWorkflowRepairPrompt(contents, inspection),
      }],
      ...chatCompletionReasoningOptions(connection),
      temperature: 0.1,
    }),
  }, abort);

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const result = await response.json();
  const choice = result.choices?.[0];
  const patchResult = extractJsonValueFromText(textFromChatChoice(choice));
  const patch = Array.isArray(patchResult)
    ? patchResult
    : Array.isArray(patchResult?.patch)
      ? patchResult.patch
      : null;
  const fixedWorkflow = patch
    ? applyJsonPatchDocument(parsedWorkflow, patch)
    : patchResult && typeof patchResult === 'object' && !Array.isArray(patchResult)
      ? patchResult
      : null;
  if (!fixedWorkflow) {
    throw new Error('The LLM must return a JSON Patch array.');
  }
  const fixedInspection = comfyWorkflowInspection(fixedWorkflow, workflowPath, role);
  if (!fixedInspection.ok) {
    throw new Error(`The LLM returned a workflow that is still incompatible. Missing: ${fixedInspection.missing.join(', ')}.`);
  }

  return {
    ok: true,
    changed: true,
    inspection: fixedInspection,
    workflowJson: `${JSON.stringify(fixedWorkflow, null, 2)}\n`,
  };
}

function comfyDimension(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(4096, Math.max(64, Math.round(value)))
    : fallback;
}

function comfyWorkflowVariables(request) {
  const loraSlots = Array.isArray(request?.loraSlots) ? request.loraSlots : [];
  const loraVariables = Object.fromEntries(
    [0, 1, 2, 3].flatMap((index) => {
      const slot = loraSlots[index];
      const fallbackName = '';
      const fallbackStrength = 1;
      const suffix = String(index + 1).padStart(2, '0');
      const slotName = typeof slot?.name === 'string' && slot.name.trim()
        ? slot.name.trim()
        : fallbackName;
      const runtimeSlotName = slotName === 'Character LoRA' ? 'None' : slotName;
      return [
        [
          `lora_${suffix}`,
          runtimeSlotName,
        ],
        [
          `lora_strength_${suffix}`,
          typeof slot?.strength === 'number' && Number.isFinite(slot.strength)
            ? Math.max(0, slot.strength)
            : fallbackStrength,
        ],
      ];
    }),
  );
  return {
    width: comfyDimension(request?.width, 832),
    height: comfyDimension(request?.height, 1216),
    prompt: typeof request?.prompt === 'string' ? request.prompt.trim() : '',
    checkpoint: typeof request?.checkpointName === 'string' ? request.checkpointName.trim() : '',
    diffusion_model: typeof request?.diffusionModelName === 'string' ? request.diffusionModelName.trim() : '',
    vae: typeof request?.vaeName === 'string' ? request.vaeName.trim() : '',
    text_encoder: typeof request?.textEncoderName === 'string' ? request.textEncoderName.trim() : '',
    ...loraVariables,
  };
}

function replaceComfyWorkflowPlaceholders(value, variables) {
  if (typeof value === 'string') {
    const exact = value.trim().match(/^\{\{\s*([a-z0-9_]+)\s*\}\}$/i);
    if (exact) {
      const key = exact[1].toLowerCase();
      return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : value;
    }
    return value.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, key) => {
      const normalizedKey = String(key).toLowerCase();
      return Object.prototype.hasOwnProperty.call(variables, normalizedKey)
        ? String(variables[normalizedKey])
        : match;
    });
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replaceComfyWorkflowPlaceholders(entry, variables));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        replaceComfyWorkflowPlaceholders(entry, variables),
      ]),
    );
  }
  return value;
}

async function requestComfyJson(baseUrl, route, init, abort) {
  const response = await requestLlmResponse(comfyEndpoint(baseUrl, route), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  }, abort);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}

// ComfyUI generation keeps models loaded so successive jobs do not reload them
// every time. The
// memory is freed lazily: right before the next local LLM request needs the
// VRAM, plus a short settle delay so the memory is actually released before
// the local LLM starts loading. The pending state is persisted because
// ComfyUI keeps the model loaded across RPGraph restarts.
let pendingComfyFreeBaseUrl = '';
let pendingComfyFreeLoaded = false;
const comfyFreeSettleMs = 1500;

function comfyModelStatePath() {
  return path.join(app.getPath('userData'), 'comfy-model-state.json');
}

async function pendingComfyFree() {
  if (!pendingComfyFreeLoaded) {
    pendingComfyFreeLoaded = true;
    try {
      const parsed = JSON.parse(await fs.readFile(comfyModelStatePath(), 'utf8'));
      if (!pendingComfyFreeBaseUrl && typeof parsed?.pendingFreeBaseUrl === 'string') {
        pendingComfyFreeBaseUrl = parsed.pendingFreeBaseUrl;
      }
    } catch {
      // First run or unreadable state file; nothing pending.
    }
  }
  return pendingComfyFreeBaseUrl;
}

function setPendingComfyFree(baseUrl) {
  pendingComfyFreeBaseUrl = typeof baseUrl === 'string' ? baseUrl : '';
  pendingComfyFreeLoaded = true;
  void fs
    .writeFile(comfyModelStatePath(), JSON.stringify({ pendingFreeBaseUrl: pendingComfyFreeBaseUrl }))
    .catch(() => {});
}

function isLocalLlmBaseUrl(value) {
  try {
    const hostname = new URL(String(value || '')).hostname;
    return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname);
  } catch {
    return false;
  }
}

async function freeComfyMemoryForLocalLlm(connection) {
  const comfyBaseUrl = await pendingComfyFree();
  const providerKind = typeof connection?.providerKind === 'string' ? connection.providerKind : '';
  const shouldFreeBeforeLlm =
    providerKind === 'lm-studio' ||
    providerKind === 'ollama' ||
    providerKind === 'llama-cpp' ||
    isLocalLlmBaseUrl(connection?.baseUrl);
  if (!comfyBaseUrl || !shouldFreeBeforeLlm) {
    return;
  }
  const abort = { signal: new AbortController().signal };
  try {
    await requestComfyJson(comfyBaseUrl, 'free', {
      method: 'POST',
      body: JSON.stringify({
        unload_models: true,
        free_memory: true,
      }),
    }, abort);
    setPendingComfyFree('');
    await new Promise((resolve) => setTimeout(resolve, comfyFreeSettleMs));
  } catch {
    // ComfyUI may already be gone; keep the pending marker so the next local
    // LLM request can try again if the voice model is still occupying VRAM.
  }
}

function isGeminiProviderConnection(connection) {
  const providerKind = typeof connection?.providerKind === 'string' ? connection.providerKind : '';
  const baseUrl = typeof connection?.baseUrl === 'string' ? connection.baseUrl.toLowerCase() : '';
  return providerKind === 'gemini' || baseUrl.includes('generativelanguage.googleapis.com');
}

function isComfyConnectionUnavailable(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  if (code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET') {
    return true;
  }
  const cause = error && typeof error === 'object' ? error.cause : null;
  return Boolean(cause && cause !== error && isComfyConnectionUnavailable(cause));
}

const comfyModelCategories = new Set([
  'checkpoints',
  'loras',
  'vae',
  'text_encoders',
  'diffusion_models',
  'controlnet',
  'upscale_models',
]);

function comfyModelCategory(value) {
  if (typeof value !== 'string' || !comfyModelCategories.has(value)) {
    throw new Error('Unsupported ComfyUI model category.');
  }
  return value;
}

async function requestComfyOutputFile(baseUrl, file, abort, fallbackMimeType) {
  const params = new URLSearchParams();
  params.set('filename', file.filename);
  params.set('type', file.type || 'output');
  if (file.subfolder) {
    params.set('subfolder', file.subfolder);
  }

  const response = await requestLlmResponse(
    `${comfyEndpoint(baseUrl, 'view')}?${params.toString()}`,
    { headers: {} },
    abort,
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const contentType = Array.isArray(response.headers['content-type'])
    ? response.headers['content-type'][0]
    : response.headers['content-type'];
  const mimeType = contentType && contentType !== 'application/octet-stream'
    ? contentType
    : fallbackMimeType;
  const buffer = await response.buffer();
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

const comfyAudioMimeTypesByExtension = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
};

function comfyAudioMimeType(filename) {
  const extension = typeof filename === 'string'
    ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    : '';
  return comfyAudioMimeTypesByExtension[extension] ?? 'audio/mpeg';
}

async function deleteComfyServerFile(baseUrl, file, abort) {
  const body = JSON.stringify({
    filename: file.filename,
    subfolder: file.subfolder || '',
    type: file.type || 'output',
  });
  try {
    await requestComfyJson(baseUrl, 'delete', {
      method: 'POST',
      body,
    }, abort);
    return true;
  } catch {
    const params = new URLSearchParams();
    params.set('filename', file.filename);
    params.set('type', file.type || 'output');
    if (file.subfolder) {
      params.set('subfolder', file.subfolder);
    }
    try {
      const response = await requestLlmResponse(
        `${comfyEndpoint(baseUrl, 'view')}?${params.toString()}`,
        { method: 'DELETE', headers: {} },
        abort,
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

async function comfyServerFileExists(baseUrl, file, abort) {
  const params = new URLSearchParams();
  params.set('filename', file.filename);
  params.set('type', file.type || 'output');
  if (file.subfolder) {
    params.set('subfolder', file.subfolder);
  }
  try {
    const response = await requestLlmResponse(
      `${comfyEndpoint(baseUrl, 'view')}?${params.toString()}`,
      { method: 'GET', headers: {} },
      abort,
    );
    response.body.destroy();
    return response.ok;
  } catch {
    return false;
  }
}

// ComfyUI builds without a delete route can report success while deleting
// nothing, so only the follow-up existence check is trusted.
async function deleteComfyServerFileVerified(baseUrl, file, abort) {
  await deleteComfyServerFile(baseUrl, file, abort);
  return !(await comfyServerFileExists(baseUrl, file, abort));
}

function comfyVoiceSampleFromDataUrl(dataUrl) {
  const match = typeof dataUrl === 'string'
    ? dataUrl.match(/^data:(audio\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i)
    : null;
  if (!match) {
    throw new Error('The voice sample must be a base64 audio data URL.');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    throw new Error('The voice sample is empty.');
  }
  if (buffer.length > maxComfyVoiceSampleBytes) {
    throw new Error(
      `The voice sample is too large: ${formatMegabytes(buffer.length)}. ` +
        `The limit is ${formatMegabytes(maxComfyVoiceSampleBytes)}.`,
    );
  }
  return { buffer, mimeType: match[1].toLowerCase() };
}

// ComfyUI's upload route is named "image" for historical reasons; it stores
// any file. With cleanup enabled the sample goes to the temp directory, which
// ComfyUI empties itself (stock ComfyUI has no HTTP route to delete files);
// LoadAudio reads it via the "name [temp]" annotation. Without cleanup it goes
// to the input directory, which LoadAudio reads by default.
async function uploadComfyVoiceSample(baseUrl, sampleDataUrl, abort, useTempStorage) {
  const sample = comfyVoiceSampleFromDataUrl(sampleDataUrl);
  const contentHash = crypto.createHash('sha256').update(sample.buffer).digest('hex').slice(0, 16);
  const fileName = `rpgraph-voice-${contentHash}.mp3`;
  const boundary = `----rpgraph-${crypto.randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="${fileName}"\r\n` +
        `Content-Type: ${sample.mimeType}\r\n\r\n`,
    ),
    sample.buffer,
    Buffer.from(
      `\r\n--${boundary}\r\n` +
        'Content-Disposition: form-data; name="overwrite"\r\n\r\n' +
        'true\r\n' +
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="type"\r\n\r\n' +
        `${useTempStorage ? 'temp' : 'input'}\r\n` +
        `--${boundary}--\r\n`,
    ),
  ]);

  const response = await requestLlmResponse(comfyEndpoint(baseUrl, 'upload/image'), {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  }, abort);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const result = JSON.parse((await response.text()) || '{}');
  const uploadedName = typeof result?.name === 'string' && result.name.trim() ? result.name : fileName;
  const subfolder = typeof result?.subfolder === 'string' && result.subfolder ? result.subfolder : '';
  // The response reports where the file was actually stored; a server that
  // ignored the requested temp storage falls back to the input directory.
  const storedType = result?.type === 'temp' || result?.type === 'output' ? result.type : 'input';
  const relativeName = subfolder ? `${subfolder}/${uploadedName}` : uploadedName;
  return {
    voiceAudioName: storedType === 'input' ? relativeName : `${relativeName} [${storedType}]`,
    file: { filename: uploadedName, subfolder, type: storedType },
  };
}

// Core save nodes write into ComfyUI's output folder, and stock ComfyUI has
// no HTTP route to delete files there. Rerouting them to the matching preview
// node stores the generated files in ComfyUI's temp folder instead, which
// ComfyUI empties itself; leftover inputs like filename_prefix are ignored.
const comfyAudioSaveNodeTypes = new Set(['SaveAudio', 'SaveAudioMP3', 'SaveAudioOpus']);
const comfyImageSaveNodeTypes = new Set(['SaveImage']);

function withTempOutputs(workflow, saveNodeTypes, previewNodeType) {
  for (const node of Object.values(workflow)) {
    if (node && typeof node === 'object' && saveNodeTypes.has(node.class_type)) {
      node.class_type = previewNodeType;
    }
  }
  return workflow;
}

// ComfyUI skips execution completely when a prompt is identical to an already
// executed one, and the new history entry then contains no outputs. Voice
// workflows use fixed seeds, so repeated generations of the same text would
// hit that cache; randomizing the seed inputs forces a real run every time.
function withRandomizedComfySeeds(workflow) {
  for (const node of Object.values(workflow)) {
    const inputs = node && typeof node === 'object' ? node.inputs : undefined;
    if (!inputs || typeof inputs !== 'object') {
      continue;
    }
    for (const seedKey of ['seed', 'noise_seed']) {
      if (typeof inputs[seedKey] === 'number') {
        inputs[seedKey] = crypto.randomInt(0, 2 ** 31);
      }
    }
  }
  return workflow;
}

function comfyHistoryErrorDetail(promptId, history) {
  const status = history?.[promptId]?.status;
  if (!status || status.status_str !== 'error') {
    return '';
  }
  const messages = Array.isArray(status.messages) ? status.messages : [];
  for (const message of messages) {
    if (Array.isArray(message) && message[0] === 'execution_error') {
      const detail = message[1];
      const nodeType = typeof detail?.node_type === 'string' ? detail.node_type : '';
      const exceptionMessage = typeof detail?.exception_message === 'string'
        ? detail.exception_message.trim()
        : '';
      if (exceptionMessage) {
        return nodeType ? `${nodeType}: ${exceptionMessage}` : exceptionMessage;
      }
    }
  }
  return 'the ComfyUI execution failed';
}

function comfyHistoryOutputFiles(promptId, history, outputKey) {
  const promptHistory = history?.[promptId];
  const outputs = promptHistory?.outputs;
  if (!outputs || typeof outputs !== 'object') {
    return [];
  }

  const files = [];
  for (const [nodeId, output] of Object.entries(outputs)) {
    const outputFiles = Array.isArray(output?.[outputKey]) ? output[outputKey] : [];
    for (const file of outputFiles) {
      if (typeof file?.filename !== 'string' || !file.filename.trim()) {
        continue;
      }
      files.push({
        nodeId,
        filename: file.filename,
        subfolder: typeof file.subfolder === 'string' ? file.subfolder : '',
        type: typeof file.type === 'string' ? file.type : 'output',
      });
    }
  }
  return files;
}

async function waitForComfyPromptHistory(baseUrl, workflow, timeoutMs, abort) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new Error('Choose a ComfyUI API workflow JSON before sending.');
  }

  const clientId = crypto.randomUUID();
  const promptResult = await requestComfyJson(baseUrl, 'prompt', {
    method: 'POST',
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  }, abort);
  const promptId = promptResult?.prompt_id;
  if (typeof promptId !== 'string' || !promptId) {
    throw new Error('ComfyUI did not return a prompt_id.');
  }

  const safeTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.min(15 * 60 * 1000, Math.max(5 * 1000, Number(timeoutMs)))
    : 3 * 60 * 1000;
  const startedAt = Date.now();
  let history = null;

  while (Date.now() - startedAt < safeTimeoutMs) {
    if (abort.signal.aborted) {
      throw cancelledLlmError();
    }
    history = await requestComfyJson(baseUrl, `history/${encodeURIComponent(promptId)}`, {}, abort);
    if (history?.[promptId]) {
      break;
    }
    await delay(1000, abort);
  }

  if (!history?.[promptId]) {
    throw new Error(`Timed out waiting for ComfyUI prompt ${promptId}.`);
  }

  return { promptId, history };
}

async function runComfyPrompt(baseUrl, workflow, timeoutMs, abort) {
  const { promptId, history } = await waitForComfyPromptHistory(baseUrl, workflow, timeoutMs, abort);
  const imageRefs = comfyHistoryOutputFiles(promptId, history, 'images');
  if (imageRefs.length === 0) {
    const errorDetail = comfyHistoryErrorDetail(promptId, history);
    throw new Error(errorDetail
      ? `ComfyUI image generation failed: ${errorDetail}`
      : `ComfyUI prompt ${promptId} finished, but no output images were found in history.`);
  }

  const images = [];
  for (const image of imageRefs) {
    images.push({
      ...image,
      dataUrl: await requestComfyOutputFile(baseUrl, image, abort, 'image/png'),
    });
  }

  return { promptId, images };
}

async function runComfyVoicePrompt(baseUrl, workflow, timeoutMs, abort, options = {}) {
  const { promptId, history } = await waitForComfyPromptHistory(baseUrl, workflow, timeoutMs, abort);
  const audioRefs = comfyHistoryOutputFiles(promptId, history, 'audio');
  if (audioRefs.length === 0) {
    const errorDetail = comfyHistoryErrorDetail(promptId, history);
    throw new Error(errorDetail
      ? `ComfyUI voice generation failed: ${errorDetail}`
      : `ComfyUI prompt ${promptId} finished, but no output audio was found in history.`);
  }

  const audio = [];
  let cleanupFailed = false;
  for (const clip of audioRefs) {
    const dataUrl = await requestComfyOutputFile(baseUrl, clip, abort, comfyAudioMimeType(clip.filename));
    // Clips in the temp folder are cleaned up by ComfyUI itself; clips a
    // custom save node wrote elsewhere need the (rarely supported) delete API.
    if (
      options.deleteOutputs &&
      clip.type !== 'temp' &&
      !(await deleteComfyServerFileVerified(baseUrl, clip, abort))
    ) {
      cleanupFailed = true;
    }
    audio.push({
      ...clip,
      dataUrl,
    });
  }

  return { promptId, audio, cleanupFailed };
}

function delay(ms, abort) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let dispose = () => {};
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      dispose();
      resolve();
    }, ms);
    dispose = abort.onCancel(() => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(cancelledLlmError());
    });
  });
}

ipcMain.handle('lmstudio:load-model', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const model = typeof connection?.model === 'string' ? connection.model.trim() : '';
    if (!model) {
      throw new Error('Choose a model ID before loading an LM Studio model.');
    }
    if (await lmStudioModelLoadedState(connection, model, abort) === true) {
      return { loadedModel: model, method: 'already-loaded' };
    }
    await freeComfyMemoryForLocalLlm(connection);
    try {
      await requestLmStudioJson(connection, 'models/load', {
        method: 'POST',
        body: JSON.stringify({ model }),
      }, abort);
      return { loadedModel: model, method: 'rest' };
    } catch (restError) {
      if (abort.signal.aborted) {
        throw restError;
      }
      // A load can fail because the model turns out to be loaded already
      // (for example when the state probe above had no source to ask).
      if (await lmStudioModelLoadedState(connection, model, abort) === true) {
        return { loadedModel: model, method: 'already-loaded' };
      }
      try {
        await runLmStudioCli(['load', model]);
        return { loadedModel: model, method: 'cli' };
      } catch {
        throw restError;
      }
    }
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('lmstudio:model-loaded', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const model = typeof connection?.model === 'string' ? connection.model.trim() : '';
    if (!model) {
      return { loaded: false };
    }
    return { loaded: await lmStudioModelLoadedState(connection, model, abort) };
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('lmstudio:unload-models', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const models = await requestLmStudioJson(connection, 'models', {}, abort);
    const instanceIds = lmStudioLoadedInstanceIds(models);
    if (instanceIds.length === 0) {
      await runLmStudioCli(['unload', '--all']);
      return { unloadedCount: undefined, instanceIds: [], method: 'cli' };
    }

    for (const instanceId of instanceIds) {
      await requestLmStudioJson(connection, 'models/unload', {
        method: 'POST',
        body: JSON.stringify({ instance_id: instanceId }),
      }, abort);
    }
    return { unloadedCount: instanceIds.length, instanceIds, method: 'rest' };
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('lmstudio:list-models', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const result = await requestLmStudioJson(connection, 'models', {}, abort);
    const models = lmStudioModelEntries(result)
      .map(lmStudioNormalizedModel)
      .filter(Boolean);
    const seen = new Set();
    return models.filter((model) => {
      if (seen.has(model.id)) {
        return false;
      }
      seen.add(model.id);
      return true;
    });
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    return failedLlmIpcResult(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('llamacpp:list-models', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    return await llamaCppModels(connection, abort);
  } catch (error) {
    if (abort.signal.aborted) return cancelledLlmIpcResult();
    return failedLlmIpcResult(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('llamacpp:load-model', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    await freeComfyMemoryForLocalLlm(connection);
    await ensureLlamaCppModelLoaded(connection, abort);
    return { loadedModel: connection.model.trim() };
  } catch (error) {
    if (abort.signal.aborted) return cancelledLlmIpcResult();
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('llamacpp:model-loaded', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const model = (await llamaCppModels(connection, abort)).find((entry) => entry.id === connection?.model?.trim());
    return { loaded: model?.status === 'loaded', status: model?.status ?? 'unknown' };
  } catch (error) {
    if (abort.signal.aborted) return cancelledLlmIpcResult();
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('llamacpp:unload-models', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const loaded = (await llamaCppModels(connection, abort)).filter((model) => model.status !== 'unloaded');
    for (const model of loaded) {
      await requestLlamaCppJson(connection, 'models/unload', {
        method: 'POST',
        body: JSON.stringify({ model: model.id }),
      }, abort);
      await waitForLlamaCppStatus(connection, model.id, 'unloaded', abort);
    }
    return { unloadedCount: loaded.length, models: loaded.map((model) => model.id) };
  } catch (error) {
    if (abort.signal.aborted) return cancelledLlmIpcResult();
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('openrouter:list-models', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const response = await requestLlmResponse(`${endpoint(connection.baseUrl, 'models')}?output_modalities=all`, {
      headers: requestHeaders(connection),
    }, abort);

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const result = await response.json();
    const models = Array.isArray(result.data)
      ? result.data.map(openRouterNormalizedModel).filter(Boolean)
      : [];
    const seen = new Set();
    return models.filter((model) => {
      if (seen.has(model.id)) {
        return false;
      }
      seen.add(model.id);
      return true;
    });
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

function pcm16MonoToWav(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

ipcMain.handle('openrouter:generate-speech', async (event, request) => {
  const abort = createLlmAbortController(request);
  const connection = request?.connection;
  const input = typeof request?.input === 'string' ? request.input.trim() : '';
  if (!connection?.model?.trim()) {
    throw new Error('Choose an OpenRouter TTS model first.');
  }
  if (!connection?.ttsVoice?.trim()) {
    throw new Error('Choose a TTS voice first.');
  }
  if (!input) {
    throw new Error('Enter text to speak first.');
  }
  const model = connection.model.trim();
  const requiresPcm = model.startsWith('google/gemini-');
  const body = {
    model,
    input,
    voice: connection.ttsVoice.trim(),
    response_format: requiresPcm ? 'pcm' : 'mp3',
    ...(Number.isFinite(connection.ttsTemperature)
      ? { temperature: connection.ttsTemperature }
      : {}),
  };
  try {
    const response = await requestLlmResponse(endpoint(connection.baseUrl, 'audio/speech'), {
      method: 'POST',
      headers: requestHeaders(connection),
      body: JSON.stringify(body),
    }, abort);
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    let responseAudio;
    if (requiresPcm && connection.ttsStreamAudio === true && request?.requestId) {
      const chunks = [];
      for await (const bytes of limitedResponseChunks(response.body)) {
        chunks.push(bytes);
        if (!event.sender.isDestroyed()) {
          event.sender.send(
            `openrouter:speech-chunk:${request.requestId}`,
            bytes.toString('base64'),
          );
        }
      }
      responseAudio = Buffer.concat(chunks);
    } else {
      responseAudio = await response.buffer();
    }
    if (responseAudio.length === 0) {
      throw new Error('OpenRouter returned an empty audio response.');
    }
    const audio = requiresPcm ? pcm16MonoToWav(responseAudio) : responseAudio;
    const rawContentType = response.headers['content-type'];
    const responseContentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType)
      ?.split(';')[0]?.trim();
    const contentType = requiresPcm ? 'audio/wav' : responseContentType || 'audio/mpeg';
    const extension = requiresPcm ? 'wav' : 'mp3';
    return {
      dataUrl: `data:${contentType};base64,${audio.toString('base64')}`,
      filename: `openrouter-tts-${Date.now()}.${extension}`,
    };
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('gemini:generate-speech', async (event, request) => {
  const abort = createLlmAbortController(request);
  const connection = request?.connection;
  const input = typeof request?.input === 'string' ? request.input.trim() : '';
  if (!connection?.model?.trim()) {
    throw new Error('Choose a Gemini TTS model first.');
  }
  if (!connection?.ttsVoice?.trim()) {
    throw new Error('Choose a TTS voice first.');
  }
  if (!input) {
    throw new Error('Enter text to speak first.');
  }
  const stream = connection.ttsStreamAudio === true && request?.requestId;
  const body = {
    contents: [{ parts: [{ text: input }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: connection.ttsVoice.trim() },
        },
      },
      ...(Number.isFinite(connection.ttsTemperature)
        ? { temperature: connection.ttsTemperature }
        : {}),
    },
  };
  try {
    const response = await requestLlmResponse(
      geminiApiUrl(connection, stream ? 'streamGenerateContent' : 'generateContent'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      abort,
    );
    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const pcmChunks = [];
    const consumeResponse = (payload) => {
      const parts = payload?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) {
        return;
      }
      for (const part of parts) {
        const base64 = part?.inlineData?.data;
        if (typeof base64 !== 'string' || !base64) {
          continue;
        }
        const bytes = Buffer.from(base64, 'base64');
        pcmChunks.push(bytes);
        if (stream && !event.sender.isDestroyed()) {
          event.sender.send(`gemini:speech-chunk:${request.requestId}`, base64);
        }
      }
    };

    if (stream) {
      if (!response.body) {
        throw new Error('The Gemini speech stream does not contain a body.');
      }
      const decoder = new TextDecoder();
      let buffered = '';
      const consumeLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
          return;
        }
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') {
          return;
        }
        try {
          consumeResponse(JSON.parse(data));
        } catch {
          // Ignore incomplete or non-JSON SSE lines.
        }
      };
      for await (const bytes of limitedResponseChunks(response.body)) {
        buffered += decoder.decode(bytes, { stream: true });
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        lines.forEach(consumeLine);
      }
      buffered += decoder.decode();
      buffered.split(/\r?\n/).forEach(consumeLine);
    } else {
      consumeResponse(await response.json());
    }

    const pcm = Buffer.concat(pcmChunks);
    if (pcm.length === 0) {
      throw new Error('Gemini returned no audio data.');
    }
    const audio = pcm16MonoToWav(pcm);
    return {
      dataUrl: `data:audio/wav;base64,${audio.toString('base64')}`,
      filename: `gemini-tts-${Date.now()}.wav`,
    };
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('gemini:list-models', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const response = await requestLlmResponse(geminiNativeModelsUrl(connection), {
      headers: { 'Content-Type': 'application/json' },
    }, abort);

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const result = await response.json();
    const models = Array.isArray(result.models)
      ? result.models.map(geminiNormalizedModel).filter(Boolean)
      : [];
    const seen = new Set();
    return models.filter((model) => {
      if (seen.has(model.id)) {
        return false;
      }
      seen.add(model.id);
      return true;
    });
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

// The renderer polls local providers every 2 seconds; without this cache each
// poll would issue one /api/show request per installed Ollama model.
const ollamaCapabilitiesByModelDigest = new Map();

ipcMain.handle('ollama:list-models', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const tags = await requestOllamaJson(connection, 'tags', {}, abort);
    const entries = Array.isArray(tags?.models) ? tags.models : [];
    const models = await Promise.all(entries.map(async (model) => {
      const id = ollamaModelId(model);
      if (!id) {
        return null;
      }
      const digest = typeof model?.digest === 'string' ? model.digest : '';
      const cacheKey = `${ollamaBaseUrl(connection)}|${id}|${digest}`;
      let capabilities = ollamaCapabilitiesByModelDigest.get(cacheKey);
      if (!capabilities) {
        try {
          const info = await requestOllamaJson(connection, 'show', {
            method: 'POST',
            body: JSON.stringify({ model: id }),
          }, abort);
          capabilities = stringArray(info?.capabilities);
          if (ollamaCapabilitiesByModelDigest.size > 500) {
            ollamaCapabilitiesByModelDigest.clear();
          }
          ollamaCapabilitiesByModelDigest.set(cacheKey, capabilities);
        } catch (error) {
          if (abort.signal.aborted) {
            throw error;
          }
          // /api/show can fail per model without invalidating the list.
          capabilities = [];
        }
      }
      return ollamaNormalizedModel(model, capabilities);
    }));
    const seen = new Set();
    return models.filter((model) => {
      if (!model || seen.has(model.id)) {
        return false;
      }
      seen.add(model.id);
      return true;
    });
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    return failedLlmIpcResult(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('ollama:load-model', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const model = typeof connection?.model === 'string' ? connection.model.trim() : '';
    if (!model) {
      throw new Error('Choose a model ID before loading an Ollama model.');
    }
    await freeComfyMemoryForLocalLlm(connection);
    await requestOllamaJson(connection, 'generate', {
      method: 'POST',
      body: JSON.stringify({
        model,
        prompt: '',
        stream: false,
      }),
    }, abort);
    return { loadedModel: model };
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('ollama:model-loaded', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const model = typeof connection?.model === 'string' ? connection.model.trim() : '';
    if (!model) {
      return { loaded: false };
    }
    const ps = await requestOllamaJson(connection, 'ps', {}, abort);
    const normalized = (value) => value.replace(/:latest$/, '');
    const target = normalized(model);
    const loaded = Array.isArray(ps?.models) && ps.models.some((entry) =>
      [entry?.name, entry?.model].some((value) =>
        typeof value === 'string' && normalized(value.trim()) === target));
    return { loaded };
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('ollama:unload-models', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const ps = await requestOllamaJson(connection, 'ps', {}, abort);
    const models = Array.isArray(ps?.models)
      ? ps.models
          .map((model) => [model?.name, model?.model].find((value) => typeof value === 'string' && value.trim()))
          .filter((model) => typeof model === 'string' && model.trim())
      : [];
    const uniqueModels = [...new Set(models)];
    if (uniqueModels.length === 0) {
      return { unloadedCount: 0, models: [] };
    }
    for (const model of uniqueModels) {
      await requestOllamaJson(connection, 'generate', {
        method: 'POST',
        body: JSON.stringify({
          model,
          prompt: '',
          stream: false,
          keep_alive: 0,
        }),
      }, abort);
    }
    return { unloadedCount: uniqueModels.length, models: uniqueModels };
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('llm:list-models', async (_event, request) => {
  const connection = request?.connection ?? request;
  const abort = createLlmAbortController(request);
  try {
    const response = await requestLlmResponse(endpoint(connection.baseUrl, 'models'), {
      headers: requestHeaders(connection),
    }, abort);

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const result = await response.json();
    return Array.isArray(result.data)
      ? result.data.map((model) => model.id).filter((id) => typeof id === 'string')
      : [];
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('llm:chat-completion', async (_event, request) => {
  const startedAt = performance.now();
  const abort = createLlmAbortController(request);
  try {
    await freeComfyMemoryForLocalLlm(request.connection);
    await ensureLlamaCppModelLoaded(request.connection, abort);
    if (isGeminiProviderConnection(request.connection)) {
      const response = await requestLlmResponse(geminiApiUrl(request.connection, 'generateContent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequestBody(request)),
      }, abort);

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const result = await response.json();
      const candidate = result.candidates?.[0];
      const content = textFromGeminiCandidate(candidate);
      if (!content) {
        throw emptyGeminiTextError(candidate);
      }

      return {
        text: content,
        stats: llmStatsFromUsage(result.usageMetadata, Math.round(performance.now() - startedAt)),
      };
    }

    const response = await requestLlmResponse(endpoint(request.connection.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: requestHeaders(request.connection),
      body: JSON.stringify({
        model: request.connection.model,
        messages: [{
          role: 'user',
          content: chatMessageContent(request.prompt, request.images),
        }],
        ...chatCompletionReasoningOptions(request.connection),
        ...chatCompletionSamplingOptions(request),
        ...(Number.isInteger(request.maxTokens) && request.maxTokens > 0
          ? { max_tokens: request.maxTokens }
          : {}),
      }),
    }, abort);

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const result = await response.json();
    const choice = result.choices?.[0];
    const content = textFromChatChoice(choice);
    if (!content) {
      throw emptyChatCompletionTextError(choice);
    }

    return {
      text: content,
      stats: llmStatsFromUsage(result.usage, Math.round(performance.now() - startedAt)),
    };
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('llm:chat-completion-stream', async (event, request) => {
  const startedAt = performance.now();
  const abort = createLlmAbortController(request);
  try {
    await freeComfyMemoryForLocalLlm(request.connection);
    await ensureLlamaCppModelLoaded(request.connection, abort);
    if (isGeminiProviderConnection(request.connection)) {
      const response = await requestLlmResponse(geminiApiUrl(request.connection, 'streamGenerateContent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequestBody(request)),
      }, abort);

      if (!response.ok) {
        throw new Error(await readError(response));
      }
      if (!response.body) {
        throw new Error('The Gemini streaming response does not contain a body.');
      }

      const decoder = new TextDecoder();
      let buffered = '';
      let content = '';
      let usage;
      let finishReason = '';

      function consumeGeminiLine(line) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
          return;
        }
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') {
          return;
        }
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          return;
        }
        const candidate = chunk.candidates?.[0];
        const deltaText = textFromGeminiCandidate(candidate);
        if (deltaText) {
          content += deltaText;
          event.sender.send(`llm:chat-stream-chunk:${request.requestId}`, deltaText);
        }
        if (typeof candidate?.finishReason === 'string') {
          finishReason = candidate.finishReason;
        }
        if (chunk.usageMetadata) {
          usage = chunk.usageMetadata;
        }
      }

      for await (const bytes of limitedResponseChunks(response.body)) {
        if (abort.signal.aborted) {
          throw cancelledLlmError();
        }
        buffered += decoder.decode(bytes, { stream: true });
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        lines.forEach(consumeGeminiLine);
      }
      buffered += decoder.decode();
      buffered.split(/\r?\n/).forEach(consumeGeminiLine);

      if (!content) {
        throw new Error(
          finishReason
            ? `The Gemini stream finished without text (finishReason: ${finishReason}).`
            : 'The Gemini stream finished without text.',
        );
      }
      return {
        text: content,
        stats: llmStatsFromUsage(usage, Math.round(performance.now() - startedAt)),
      };
    }

    const response = await requestLlmResponse(endpoint(request.connection.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: requestHeaders(request.connection),
      body: JSON.stringify({
        model: request.connection.model,
        messages: [{
          role: 'user',
          content: chatMessageContent(request.prompt, request.images),
        }],
        ...chatCompletionReasoningOptions(request.connection),
        ...chatCompletionSamplingOptions(request),
        ...(Number.isInteger(request.maxTokens) && request.maxTokens > 0
          ? { max_tokens: request.maxTokens }
          : {}),
        stream: true,
        stream_options: { include_usage: true },
      }),
    }, abort);

    if (!response.ok) {
      throw new Error(await readError(response));
    }
    if (!response.body) {
      throw new Error('The LLM streaming response does not contain a body.');
    }

    const decoder = new TextDecoder();
    let buffered = '';
    let content = '';
    let usage;
    let finishReason = '';

    function consumeLine(line) {
      if (!line.startsWith('data:')) {
        return;
      }
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') {
        return;
      }
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      const choice = chunk.choices?.[0];
      const deltaText = textFromChatMessage(choice?.delta) ||
        (!content ? textFromChatChoice(choice) : '');
      if (deltaText) {
        content += deltaText;
        event.sender.send(`llm:chat-stream-chunk:${request.requestId}`, deltaText);
      }
      if (typeof choice?.finish_reason === 'string') {
        finishReason = choice.finish_reason;
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }

    for await (const bytes of limitedResponseChunks(response.body)) {
      if (abort.signal.aborted) {
        throw cancelledLlmError();
      }
      buffered += decoder.decode(bytes, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      lines.forEach(consumeLine);
    }
    buffered += decoder.decode();
    if (buffered) {
      consumeLine(buffered);
    }

    if (!content) {
      throw emptyChatCompletionTextError({ finish_reason: finishReason });
    }

    return {
      text: content,
      stats: llmStatsFromUsage(usage, Math.round(performance.now() - startedAt)),
    };
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('llm:cancel-request', (_event, requestId) => {
  const handle = activeLlmRequests.get(requestId);
  if (handle) {
    handle.abort('cancelled');
    activeLlmRequests.delete(requestId);
  }
  if (!handle && typeof requestId === 'number' && Number.isFinite(requestId)) {
    pendingCancelledLlmRequests.add(requestId);
  }
  return { cancelled: !!handle };
});

ipcMain.handle('comfy:run-workflow', async (_event, request) => {
  const abort = createLlmAbortController(request);
  try {
    return await runComfyPrompt(request?.baseUrl, request?.workflow, request?.timeoutMs, abort);
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('comfy:select-workflow', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose ComfyUI Workflow JSON',
    properties: ['openFile'],
    filters: [
      { name: 'ComfyUI Workflow JSON', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const filePath = approveComfyWorkflowPath(result.filePaths[0]);
  return {
    canceled: false,
    filePath,
    fileName: path.basename(filePath),
  };
});

ipcMain.handle('app:resolve-project-path', async (_event, relativePath) => ({
  path: resolveProjectPath(relativePath),
}));

function defaultComfyWorkflowPathForRole(role) {
  return comfyWorkflowRole(role) === 'voice'
    ? 'comfy-workflows/api-workflows-with-variables/voice/higgs_audio_v3-tts.json'
    : 'comfy-workflows/api-workflows-with-variables/image/Krea2.json';
}

ipcMain.handle('comfy:inspect-workflow', async (_event, request) => {
  let filePath = '';
  const role = comfyWorkflowRole(request?.role);
  try {
    filePath = validateComfyWorkflowPath(request?.workflowPath || defaultComfyWorkflowPathForRole(role));
    const contents = await fs.readFile(filePath, 'utf8');
    return comfyWorkflowInspection(JSON.parse(contents), filePath, role);
  } catch (error) {
    return {
      ok: false,
      format: 'unknown',
      role,
      modelSource: 'missing',
      placeholders: [],
      missing: [error instanceof Error ? error.message : String(error)],
      workflowPath: filePath,
      fileName: filePath ? path.basename(filePath) : '',
    };
  }
});

ipcMain.handle('comfy:repair-workflow', async (_event, request) => {
  const abort = createLlmAbortController(request);
  const role = comfyWorkflowRole(request?.role);
  try {
    const filePath = validateComfyWorkflowPath(request?.workflowPath || defaultComfyWorkflowPathForRole(role));
    return await repairComfyWorkflowWithLlm(filePath, request?.connection, abort, role);
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('comfy:apply-workflow-repair', async (_event, request) => {
  try {
    const role = comfyWorkflowRole(request?.role);
    const filePath = validateComfyWorkflowPath(request?.workflowPath || defaultComfyWorkflowPathForRole(role));
    const workflow = extractJsonObjectFromText(request?.workflowJson);
    const inspection = assertComfyWorkflowCompatible(workflow, filePath, role);
    const workflowJson = `${JSON.stringify(workflow, null, 2)}\n`;
    await fs.writeFile(filePath, workflowJson, 'utf8');
    return {
      ok: true,
      inspection,
      workflowPath: filePath,
      fileName: path.basename(filePath),
    };
  } catch (error) {
    throw normalizeLlmError(error);
  }
});

ipcMain.handle('comfy:run-workflow-path', async (_event, request) => {
  const abort = createLlmAbortController(request);
  try {
    setPendingComfyFree(typeof request?.baseUrl === 'string' ? request.baseUrl : '');
    const filePath = validateComfyWorkflowPath(request?.workflowPath || defaultComfyWorkflowPathForRole('image'));
    const contents = await fs.readFile(filePath, 'utf8');
    const parsedWorkflow = JSON.parse(contents);
    assertComfyWorkflowCompatible(parsedWorkflow, filePath);
    const workflowJson = replaceComfyWorkflowPlaceholders(
      parsedWorkflow,
      comfyWorkflowVariables(request),
    );
    const workflow = comfyPromptFromWorkflow(workflowJson);
    if (request?.deleteOutputs === true) {
      withTempOutputs(workflow, comfyImageSaveNodeTypes, 'PreviewImage');
    }
    return await runComfyPrompt(request?.baseUrl, workflow, request?.timeoutMs, abort);
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('comfy:run-voice-workflow-path', async (_event, request) => {
  const abort = createLlmAbortController(request);
  try {
    setPendingComfyFree(typeof request?.baseUrl === 'string' ? request.baseUrl : '');
    const filePath = validateComfyWorkflowPath(
      request?.workflowPath || defaultComfyWorkflowPathForRole('voice'),
    );
    const contents = await fs.readFile(filePath, 'utf8');
    const parsedWorkflow = JSON.parse(contents);
    assertComfyWorkflowCompatible(parsedWorkflow, filePath, 'voice');
    const speechText = typeof request?.speechText === 'string' ? request.speechText.trim() : '';
    if (!speechText) {
      throw new Error('Enter a text to speak before generating a voice clip.');
    }
    const deleteServerFiles = request?.deleteOutputs === true;
    const sampleUpload = await uploadComfyVoiceSample(
      request?.baseUrl,
      request?.sampleDataUrl,
      abort,
      deleteServerFiles,
    );
    const workflowJson = replaceComfyWorkflowPlaceholders(parsedWorkflow, {
      speech_text: speechText,
      voice_audio: sampleUpload.voiceAudioName,
    });
    const workflow = withRandomizedComfySeeds(comfyPromptFromWorkflow(workflowJson));
    if (deleteServerFiles) {
      withTempOutputs(workflow, comfyAudioSaveNodeTypes, 'PreviewAudio');
    }
    let result;
    let sampleCleanupFailed = false;
    try {
      result = await runComfyVoicePrompt(request?.baseUrl, workflow, request?.timeoutMs, abort, {
        deleteOutputs: deleteServerFiles,
      });
    } finally {
      // Remove the uploaded reference voice sample even when the run failed.
      // A sample in the temp folder is cleaned up by ComfyUI itself.
      if (deleteServerFiles && sampleUpload.file.type !== 'temp' && !abort.signal.aborted) {
        sampleCleanupFailed = !(await deleteComfyServerFileVerified(
          request?.baseUrl,
          sampleUpload.file,
          abort,
        ));
      }
    }
    return {
      ...result,
      cleanupFailed: result.cleanupFailed || sampleCleanupFailed,
    };
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('comfy:list-models', async (_event, request) => {
  const abort = createLlmAbortController(request);
  try {
    const category = comfyModelCategory(request?.category);
    const result = await requestComfyJson(request?.baseUrl, `models/${category}`, {}, abort);
    return Array.isArray(result)
      ? result.filter((name) => typeof name === 'string')
      : [];
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    if (isComfyConnectionUnavailable(error)) {
      return [];
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('comfy:free-memory', async (_event, request) => {
  const abort = createLlmAbortController(request);
  try {
    await requestComfyJson(request?.baseUrl, 'free', {
      method: 'POST',
      body: JSON.stringify({
        unload_models: true,
        free_memory: true,
      }),
    }, abort);
    // Only clear the lazy voice-unload marker when this request freed the
    // ComfyUI instance the voice model was loaded on.
    if ((await pendingComfyFree()) === String(request?.baseUrl || '')) {
      setPendingComfyFree('');
    }
    return { ok: true };
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    throw normalizeLlmError(error);
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('comfy:check-connection', async (_event, request) => {
  const abort = createLlmAbortController(request);
  try {
    const stats = await requestComfyJson(request?.baseUrl, 'system_stats', {}, abort);
    return {
      ok: true,
      system: stats?.system,
      devices: stats?.devices,
    };
  } catch (error) {
    if (abort.signal.aborted) {
      return cancelledLlmIpcResult();
    }
    const normalized = normalizeLlmError(error);
    return {
      ok: false,
      error: normalized instanceof Error ? normalized.message : String(normalized),
    };
  } finally {
    abort.dispose();
  }
});

ipcMain.handle('system:resource-stats', async () => ({
  ram: memoryStats(),
  vram: await runNvidiaSmiMemoryQuery(),
  updatedAt: new Date().toISOString(),
}));

ipcMain.handle('file:list', async () => {
  const files = await listedFilesInDirectory(filesDirectory(), 'files');
  return files.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
});

ipcMain.handle('character:list', async () => {
  const files = await listedFilesInDirectory(charactersDirectory(), 'characters');
  return files
    .filter((file) => file.type === 'character-card')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
});

ipcMain.handle('workflow:save-named', async (_event, request) => {
  const directory = filesDirectory();
  await fs.mkdir(directory, { recursive: true });
  const baseName = safeWorkflowBaseName(request?.name);
  const fileName = `${baseName}${jsonFileExtension}`;
  const filePath = path.join(directory, fileName);
  if (request.overwrite) {
    await assertOverwriteType(filePath, 'workflow');
  }
  const workflow = request.protection === 'encrypted'
    ? await encryptWorkflow(request.workflow, request.password)
    : request.protection === 'plain'
      ? request.workflow
      : (() => { throw new Error('Choose Plain JSON or Password encrypted.'); })();
  try {
    const contents = `${JSON.stringify(workflow, null, 2)}\n`;
    if (request.overwrite) {
      await writeTextFileAtomically(filePath, contents);
    } else {
      await writeNewTextFileAtomically(filePath, contents);
    }
  } catch (error) {
    if (!request.overwrite && error && error.code === 'EEXIST') {
      return { conflict: true, fileName, name: baseName };
    }
    throw error;
  }
  if (request.protection === 'plain') {
    approveWorkflowPath(filePath);
  }
  await saveLastWorkflowFileName(fileName);
  return { fileName, name: baseName, filePath };
});

ipcMain.handle('storybook:save', async (_event, request) => {
  const directory = filesDirectory();
  await fs.mkdir(directory, { recursive: true });
  const baseName = safeStorybookBaseName(request?.name ?? request?.storybook?.title);
  const fileName = `${baseName}.rpgraph-storybook${jsonFileExtension}`;
  const filePath = path.join(directory, fileName);
  if (request.overwrite) {
    await assertOverwriteType(filePath, 'storybook');
  }
  const storybook = request.protection === 'encrypted'
    ? await encryptStorybook(request.storybook, request.password)
    : request.protection === 'plain'
      ? request.storybook
      : (() => { throw new Error('Choose Plain JSON or Password encrypted.'); })();
  try {
    const contents = `${JSON.stringify(storybook, null, 2)}\n`;
    if (request.overwrite) {
      await writeTextFileAtomically(filePath, contents);
    } else {
      await writeNewTextFileAtomically(filePath, contents);
    }
  } catch (error) {
    if (!request.overwrite && error && error.code === 'EEXIST') {
      return { conflict: true, fileName, name: baseName };
    }
    throw error;
  }
  approveFilePath(filePath);
  return { fileName, name: baseName, filePath };
});

ipcMain.handle('character:save', async (_event, request) => {
  const directory = charactersDirectory();
  await fs.mkdir(directory, { recursive: true });
  const card = request?.characterCard;
  if (
    !card ||
    card.format !== 'rpgraph-character' ||
    characterCardVersionStatus(card.version) !== 'current' ||
    !characterCardMetadata(card).compatible
  ) {
    throw new Error(
      `Only RPGraph Character Card Format ${currentCharacterCardFormatVersion} payloads can be saved.`,
    );
  }
  const baseName = safeCharacterCardBaseName(request?.name ?? card.character?.name);
  const fileName = `${baseName}.rpgraph-character${jsonFileExtension}`;
  const filePath = path.join(directory, fileName);
  if (request.overwrite) {
    await assertOverwriteType(filePath, 'character-card');
  }
  const payload = request.protection === 'encrypted'
    ? await encryptCharacterCard(card, request.password)
    : request.protection === 'plain'
      ? card
      : (() => { throw new Error('Choose Plain JSON or Password encrypted.'); })();
  try {
    const contents = `${JSON.stringify(payload, null, 2)}\n`;
    if (request.overwrite) {
      await writeTextFileAtomically(filePath, contents);
    } else {
      await writeNewTextFileAtomically(filePath, contents);
    }
  } catch (error) {
    if (!request.overwrite && error && error.code === 'EEXIST') {
      return { conflict: true, fileName, name: baseName };
    }
    throw error;
  }
  approveFilePath(filePath);
  return { fileName, name: baseName, filePath };
});

ipcMain.handle('file:save-to-path', async (_event, request) => {
  const kind = request?.kind;
  const protection = request?.protection;
  let baseName;
  let expectedType;
  let payload;
  let title;
  let defaultFileName;

  if (kind === 'workflow') {
    baseName = safeWorkflowBaseName(request?.name);
    expectedType = 'workflow';
    title = 'Save Workflow File';
    defaultFileName = `${baseName}${jsonFileExtension}`;
    payload = protection === 'encrypted'
      ? await encryptWorkflow(request.workflow, request.password)
      : protection === 'plain'
        ? request.workflow
        : (() => { throw new Error('Choose Plain JSON or Password encrypted.'); })();
  } else if (kind === 'storybook') {
    baseName = safeStorybookBaseName(request?.name ?? request?.storybook?.title);
    expectedType = 'storybook';
    title = 'Save Storybook File';
    defaultFileName = `${baseName}.rpgraph-storybook${jsonFileExtension}`;
    payload = protection === 'encrypted'
      ? await encryptStorybook(request.storybook, request.password)
      : protection === 'plain'
        ? request.storybook
        : (() => { throw new Error('Choose Plain JSON or Password encrypted.'); })();
  } else if (kind === 'session') {
    baseName = safeSessionBaseName(request?.name);
    expectedType = 'session';
    title = 'Save RP File';
    defaultFileName = `${baseName}${jsonFileExtension}`;
    payload = protection === 'encrypted'
      ? await encryptSession(request.session, request.password)
      : protection === 'plain'
        ? request.session
        : (() => { throw new Error('Choose Plain JSON or Password encrypted.'); })();
  } else if (kind === 'character') {
    baseName = safeCharacterCardBaseName(request?.name ?? request?.characterCard?.character?.name);
    expectedType = 'character-card';
    title = 'Export Character Card';
    defaultFileName = `${baseName}.rpgraph-character${jsonFileExtension}`;
    const card = request?.characterCard;
    if (
      !card ||
      card.format !== 'rpgraph-character' ||
      characterCardVersionStatus(card.version) !== 'current' ||
      !characterCardMetadata(card).compatible
    ) {
      throw new Error(
        `Only RPGraph Character Card Format ${currentCharacterCardFormatVersion} payloads can be exported.`,
      );
    }
    payload = protection === 'encrypted'
      ? await encryptCharacterCard(card, request.password)
      : protection === 'plain'
        ? card
        : (() => { throw new Error('Choose Plain JSON or Password encrypted.'); })();
  } else {
    throw new Error('Choose Workflow, Storybook, RP save, or Character.');
  }

  const result = await dialog.showSaveDialog({
    title,
    defaultPath: defaultFileName,
    filters: [{ name: 'RPGraph JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  const filePath = normalizedFilePath(result.filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await assertOverwriteType(filePath, expectedType);
  await writeTextFileAtomically(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  approveFilePath(filePath);
  if (expectedType === 'workflow' && protection === 'plain') {
    approveWorkflowPath(filePath);
  }
  if (expectedType === 'workflow' && isStoredFilePath(filePath)) {
    await saveLastWorkflowFileName(path.basename(filePath));
  }
  return {
    canceled: false,
    fileName: path.basename(filePath),
    name: storedJsonName(path.basename(filePath)),
    filePath,
  };
});

ipcMain.handle('text-file:load', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Load Text File',
    properties: ['openFile'],
    filters: [
      {
        name: 'Text Files',
        extensions: [
          'txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'xml',
          'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'yaml', 'yml',
          'toml', 'ini', 'cfg', 'conf', 'log', 'prompt',
        ],
      },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const contents = await fs.readFile(filePath, 'utf8');
  return { canceled: false, fileName: path.basename(filePath), contents };
});

ipcMain.handle('json-file:load', async (_event, options) => {
  const result = await dialog.showOpenDialog({
    title: typeof options?.title === 'string' && options.title
      ? options.title
      : 'Import SillyTavern Character JSON',
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const contents = await fs.readFile(filePath, 'utf8');
  return { canceled: false, fileName: path.basename(filePath), contents };
});

ipcMain.handle('workflow:load-default', async () => {
  const restored = await restoreDefaultWorkflowFile();
  const contents = await fs.readFile(restored.filePath, 'utf8');
  return {
    filePath: restored.filePath,
    fileName: restored.fileName,
    workflow: JSON.parse(contents),
  };
});

ipcMain.handle('workflow:restore-default', async () => {
  const restored = await refreshDefaultWorkflowFile();
  const contents = await fs.readFile(restored.filePath, 'utf8');
  return {
    filePath: restored.filePath,
    fileName: restored.fileName,
    workflow: JSON.parse(contents),
  };
});

ipcMain.handle('workflow:load-startup', async () => {
  try {
    await importMissingBundledDefaultWorkflows();
  } catch (error) {
    console.error('Unable to import bundled default workflows:', error);
  }
  let files = await workflowFiles();
  if (files.length === 0) {
    await restoreDefaultWorkflowFile();
    files = await workflowFiles();
  }
  const state = await loadWorkflowState();
  const workflow =
    files.find((file) => file.fileName === state.lastWorkflowFileName) ??
    files.find((file) => file.compatible) ??
    files[0];
  if (!workflow) {
    throw new Error('No workflow file is available.');
  }
  if (!workflow.compatible) {
    throw unsupportedStoredFileError({}, workflow);
  }
  if (workflow.protection === 'encrypted') {
    approveFilePath(workflow.filePath);
    await saveLastWorkflowFileName(workflow.fileName);
    return {
      fileName: workflow.fileName,
      name: workflow.name,
      filePath: workflow.filePath,
      type: workflow.type,
      protection: workflow.protection,
      envelopeFormatVersion: workflow.envelopeFormatVersion,
      formatVersion: workflow.formatVersion,
      workflowFormatVersion: workflow.workflowFormatVersion,
      compatible: workflow.compatible,
      requiresPassword: true,
    };
  }
  const loaded = await loadStoredWorkflowFile(workflow.fileName);
  return { ...loaded, workflow: loaded.value };
});

ipcMain.handle('workflow:reload', async (_event, filePath) => {
  const validatedPath = validateWorkflowPath(filePath);
  const contents = await fs.readFile(validatedPath, 'utf8');
  return { filePath: validatedPath, workflow: JSON.parse(contents) };
});

ipcMain.handle('workflow:save-current', async (_event, request) => {
  const validatedPath = validateWorkflowPath(request?.filePath);
  await assertOverwriteType(validatedPath, 'workflow');
  await writeTextFileAtomically(validatedPath, `${JSON.stringify(request.workflow, null, 2)}\n`);
  await saveLastWorkflowFileName(path.basename(validatedPath));
  return { filePath: validatedPath };
});

ipcMain.handle('settings:load', async () => {
  const filePath = settingsFilePath();
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    const settings = JSON.parse(contents);
    return {
      filePath,
      settings: settingsFromDisk(settings),
      apiKeyEncryptionAvailable: apiKeyEncryptionAvailable(),
      apiKeyDecryptionUnavailable: settingsHasEncryptedApiKeys(settings) && !apiKeyEncryptionAvailable(),
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        filePath,
        settings: null,
        apiKeyEncryptionAvailable: apiKeyEncryptionAvailable(),
        apiKeyDecryptionUnavailable: false,
      };
    }
    throw error;
  }
});

ipcMain.handle('settings:save', async (_event, settings) => {
  const filePath = settingsFilePath();
  settingsWriteQueue = settingsWriteQueue.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeTextFileAtomically(filePath, `${JSON.stringify(settingsForDisk(settings), null, 2)}\n`);
  });
  await settingsWriteQueue;
  return {
    filePath,
    apiKeyEncryptionAvailable: apiKeyEncryptionAvailable(),
  };
});

ipcMain.handle('session:save', async (_event, request) => {
  const directory = filesDirectory();
  await fs.mkdir(directory, { recursive: true });
  const baseName = safeSessionBaseName(request.name);
  const fileName = `${baseName}${jsonFileExtension}`;
  const filePath = path.join(directory, fileName);
  if (request.overwrite) {
    await assertOverwriteType(filePath, 'session');
  }
  const session = request.protection === 'encrypted'
    ? await encryptSession(request.session, request.password)
    : request.protection === 'plain'
      ? request.session
      : (() => { throw new Error('Choose Plain JSON or Password encrypted.'); })();
  try {
    const contents = `${JSON.stringify(session, null, 2)}\n`;
    if (request.overwrite) {
      await writeTextFileAtomically(filePath, contents);
    } else {
      await writeNewTextFileAtomically(filePath, contents);
    }
  } catch (error) {
    if (!request.overwrite && error && error.code === 'EEXIST') {
      return { conflict: true, fileName, name: baseName };
    }
    throw error;
  }
  approveFilePath(filePath);
  return { fileName, name: baseName, filePath };
});

ipcMain.handle('image:select', async (_event, request = {}) => {
  const multiple = request?.multiple !== false;
  const result = await dialog.showOpenDialog({
    title: 'Attach Image',
    defaultPath: await loadImageDialogDirectory(),
    properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [
      {
        name: 'Images',
        extensions: ['jpg', 'jpeg', 'png', 'webp'],
      },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, images: [] };
  }

  await saveImageDialogDirectory(path.dirname(result.filePaths[0]));
  const selectedFiles = await Promise.all(
    result.filePaths.map(async (filePath) => ({
      filePath,
      stats: await fs.stat(filePath),
    })),
  );
  const oversizedFile = selectedFiles.find(({ stats }) => stats.size > maxSelectedImageBytes);
  if (oversizedFile) {
    throw new Error(
      `Selected image is too large: ${path.basename(oversizedFile.filePath)} is ` +
        `${formatMegabytes(oversizedFile.stats.size)}. The limit is ` +
        `${formatMegabytes(maxSelectedImageBytes)} per image.`,
    );
  }
  const totalSize = selectedFiles.reduce((sum, { stats }) => sum + stats.size, 0);
  if (totalSize > maxSelectedImagesTotalBytes) {
    throw new Error(
      `Selected images are too large together: ${formatMegabytes(totalSize)}. ` +
        `The limit is ${formatMegabytes(maxSelectedImagesTotalBytes)} per selection.`,
    );
  }
  const images = await Promise.all(
    selectedFiles.map(async ({ filePath, stats }) => {
      const contents = await fs.readFile(filePath);
      const mimeType = imageMimeType(filePath);
      return {
        name: path.basename(filePath),
        mimeType,
        size: stats.size,
        dataUrl: `data:${mimeType};base64,${contents.toString('base64')}`,
      };
    }),
  );

  return { canceled: false, images };
});

ipcMain.handle('audio:select', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose Voice Sample',
    properties: ['openFile'],
    filters: [
      {
        name: 'MP3 Audio',
        extensions: ['mp3'],
      },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const stats = await fs.stat(filePath);
  if (stats.size > maxComfyVoiceSampleBytes) {
    throw new Error(
      `Selected audio file is too large: ${path.basename(filePath)} is ` +
        `${formatMegabytes(stats.size)}. The limit is ` +
        `${formatMegabytes(maxComfyVoiceSampleBytes)}.`,
    );
  }
  const contents = await fs.readFile(filePath);
  return {
    canceled: false,
    audio: {
      name: path.basename(filePath),
      mimeType: 'audio/mpeg',
      size: stats.size,
      dataUrl: `data:audio/mpeg;base64,${contents.toString('base64')}`,
    },
  };
});

ipcMain.handle('file:select', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open RPGraph File',
    defaultPath: filesDirectory(),
    properties: ['openFile'],
    filters: [{ name: 'RPGraph File', extensions: ['json'] }],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const fileName = path.basename(filePath);
  const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const metadata = storedFileMetadata(value);
  approveFilePath(filePath);
  if (metadata.type === 'workflow' && metadata.protection === 'plain') {
    approveWorkflowPath(filePath);
  }
  return {
    canceled: false,
    filePath,
    fileName,
    ...metadata,
    name: storedJsonName(fileName),
  };
});

ipcMain.handle('character:select', async () => {
  await fs.mkdir(charactersDirectory(), { recursive: true });
  const result = await dialog.showOpenDialog({
    title: 'Open RPGraph Character Card',
    defaultPath: charactersDirectory(),
    properties: ['openFile'],
    filters: [{ name: 'RPGraph Character Card', extensions: ['json'] }],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const fileName = path.basename(filePath);
  const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const metadata = storedFileMetadata(value);
  approveFilePath(filePath);
  return {
    canceled: false,
    filePath,
    fileName,
    ...metadata,
    name: metadata.characterName || storedJsonName(fileName),
  };
});

ipcMain.handle('file:load', async (_event, request) => {
  const fileName = validatedStoredFileName(request.fileName);
  const filePath = approveFilePath(path.join(storedFileDirectory(request.storage), fileName));
  const { metadata, value } = await readRpgraphFile(filePath, request.password);
  if (metadata.type === 'workflow' && metadata.protection === 'plain') {
    approveWorkflowPath(filePath);
  }
  if (metadata.type === 'workflow') {
    await saveLastWorkflowFileName(fileName);
  }
  return {
    fileName,
    name: storedJsonName(fileName),
    filePath,
    ...metadata,
    value,
  };
});

ipcMain.handle('session:save-current', async (_event, request) => {
  const filePath = validateFilePath(request.filePath);
  await assertOverwriteType(filePath, 'session');
  const session = request.protection === 'encrypted'
    ? await encryptSession(request.session, request.password)
    : request.protection === 'plain'
      ? request.session
      : (() => { throw new Error('Choose Plain JSON or Password encrypted.'); })();
  await writeTextFileAtomically(filePath, `${JSON.stringify(session, null, 2)}\n`);
  return { filePath, fileName: path.basename(filePath) };
});

ipcMain.handle('file:load-file', async (_event, request) => {
  const filePath = validateFilePath(request.filePath);
  const fileName = path.basename(filePath);
  const { metadata, value } = await readRpgraphFile(filePath, request.password);
  if (metadata.type === 'workflow' && metadata.protection === 'plain') {
    approveWorkflowPath(filePath);
  }
  if (metadata.type === 'workflow' && isStoredFilePath(filePath)) {
    await saveLastWorkflowFileName(fileName);
  }
  return {
    fileName,
    name: storedJsonName(fileName),
    filePath,
    ...metadata,
    value,
  };
});

ipcMain.handle('file:delete', async (_event, request) => {
  const validatedFileName = validatedStoredFileName(request.fileName);
  try {
    await fs.unlink(path.join(storedFileDirectory(request.storage), validatedFileName));
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }
  return { fileName: validatedFileName };
});

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle('window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return { isMaximized: false };
  }
  if (window.isMaximized()) {
    window.unmaximize();
    return { isMaximized: false };
  }
  window.maximize();
  return { isMaximized: true };
});

ipcMain.handle('window:toggle-full-screen', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return { isFullScreen: false };
  }
  const isFullScreen = !window.isFullScreen();
  window.setFullScreen(isFullScreen);
  return { isFullScreen };
});

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

const windowCloseCleanupCompleted = new WeakSet();
const windowCloseCleanupTimeouts = new WeakMap();

ipcMain.handle('window:cleanup-complete-close', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) {
    return;
  }
  const timeout = windowCloseCleanupTimeouts.get(window);
  if (timeout) {
    clearTimeout(timeout);
    windowCloseCleanupTimeouts.delete(window);
  }
  windowCloseCleanupCompleted.add(window);
  window.close();
});

async function createWindow() {
  Menu.setApplicationMenu(null);
  const windowState = await loadWindowState();

  const window = new BrowserWindow({
    ...(windowState.bounds ?? { width: 1480, height: 900 }),
    show: false,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    icon: appIconPath,
    backgroundColor: '#090d14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigationUrl(url)) {
      event.preventDefault();
    }
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  for (const eventName of [
    'move',
    'resize',
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen',
  ]) {
    window.on(eventName, () => scheduleWindowStateSave(window));
  }
  window.on('close', (event) => {
    saveWindowState(window);
    if (windowCloseCleanupCompleted.has(window) || window.webContents.isDestroyed()) {
      return;
    }
    event.preventDefault();
    if (windowCloseCleanupTimeouts.has(window)) {
      return;
    }
    window.webContents.send('window:cleanup-before-close');
    const timeout = setTimeout(() => {
      windowCloseCleanupTimeouts.delete(window);
      if (window.isDestroyed()) {
        return;
      }
      windowCloseCleanupCompleted.add(window);
      window.close();
    }, windowCloseCleanupTimeoutMs);
    windowCloseCleanupTimeouts.set(window, timeout);
  });
  window.once('ready-to-show', () => {
    if (windowState.isFullScreen) {
      window.setFullScreen(true);
    } else if (windowState.isMaximized) {
      window.maximize();
    }
    window.show();
  });

  if (process.argv.includes('--dev')) {
    window.loadURL(developmentUrl);
    return;
  }

  window.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(async () => {
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
