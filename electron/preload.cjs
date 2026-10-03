const { contextBridge, ipcRenderer, webFrame } = require('electron');

let nextStreamRequestId = 1;

function nextLlmRequestId() {
  const requestId = nextStreamRequestId;
  nextStreamRequestId += 1;
  return requestId;
}

function cancelLlmRequest(requestId, rejectAbort) {
  void ipcRenderer
    .invoke('llm:cancel-request', requestId)
    .finally(() => rejectAbort(new Error('The LLM request was cancelled.')));
}

function throwIfLlmCancelled(result) {
  if (result?.__rpgraphLlmCancelled === true) {
    throw new Error('The LLM request was cancelled.');
  }
  return result;
}

function throwIfRpgraphIpcError(result) {
  if (result?.__rpgraphLlmError === true) {
    const error = new Error(result.message || 'The LLM request failed.');
    error.name = typeof result.name === 'string' && result.name ? result.name : 'Error';
    for (const field of ['code', 'status', 'requestId', 'param']) {
      if (typeof result[field] === 'string' || typeof result[field] === 'number') error[field] = result[field];
    }
    throw error;
  }
  return result;
}

function abortableLlmInvoke(channel, request, onAbort) {
  const requestId = nextLlmRequestId();
  const requestWithoutSignal = { ...request };
  delete requestWithoutSignal.signal;

  let rejectAbort;
  const abortPromise = new Promise((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    cancelLlmRequest(requestId, rejectAbort);
  };

  if (typeof onAbort === 'function') {
    onAbort(abort);
  }

  return Promise.race([
    ipcRenderer
      .invoke(channel, { ...requestWithoutSignal, requestId })
      .then(throwIfLlmCancelled)
      .then(throwIfRpgraphIpcError),
    abortPromise,
  ]);
}

contextBridge.exposeInMainWorld('rpgraph', {
  chatgpt: {
    state: () => ipcRenderer.invoke('chatgpt:state').then(throwIfRpgraphIpcError),
    signIn: (profileId) => ipcRenderer.invoke('chatgpt:sign-in', profileId).then(throwIfRpgraphIpcError),
    cancelSignIn: () => ipcRenderer.invoke('chatgpt:cancel-sign-in'),
    selectProfile: (profileId) => ipcRenderer.invoke('chatgpt:select-profile', profileId).then(throwIfRpgraphIpcError),
    signOut: (profileId) => ipcRenderer.invoke('chatgpt:sign-out', profileId).then(throwIfRpgraphIpcError),
    confirmUsage: (profileId) => ipcRenderer.invoke('chatgpt:confirm-usage', profileId).then(throwIfRpgraphIpcError),
    openUsage: () => ipcRenderer.invoke('chatgpt:open-usage'),
    listModels: (connection, onAbort) => abortableLlmInvoke('chatgpt:list-models', { connection }, onAbort).then(throwIfRpgraphIpcError),
  },
  accounts: {
    prepare: () => ipcRenderer.invoke('accounts:prepare'),
    list: () => ipcRenderer.invoke('accounts:list'),
    create: (username, password) => ipcRenderer.invoke('accounts:create', { username, password }),
    unlock: (username, password) => ipcRenderer.invoke('accounts:unlock', { username, password }),
    useLocal: () => ipcRenderer.invoke('accounts:local'),
    openFolder: () => ipcRenderer.invoke('accounts:open-folder'),
    delete: (password) => ipcRenderer.invoke('accounts:delete', { password }),
    getFilenamePrivacy: () => ipcRenderer.invoke('accounts:filename-privacy'),
    setFilenamePrivacy: (enabled) => ipcRenderer.invoke('accounts:set-filename-privacy', enabled),
  },
  onPanelNavigate: (callback) => {
    const listener = (_event, direction) => {
      if (direction === -1 || direction === 1) callback(direction);
    };
    ipcRenderer.on('panel:navigate', listener);
    return () => ipcRenderer.removeListener('panel:navigate', listener);
  },
  listCompatibleModels: (connection, onAbort) =>
    abortableLlmInvoke('llm:list-models', { connection, includeCapabilities: true }, onAbort).then(throwIfRpgraphIpcError),
  listModels: (connection, onAbort) =>
    abortableLlmInvoke('llm:list-models', { connection }, onAbort),
  listLmStudioModels: (connection, onAbort) =>
    abortableLlmInvoke('lmstudio:list-models', { connection }, onAbort).then(throwIfRpgraphIpcError),
  listLlamaCppModels: (connection, onAbort) =>
    abortableLlmInvoke('llamacpp:list-models', { connection }, onAbort).then(throwIfRpgraphIpcError),
  listUnslothModels: (connection) => ipcRenderer.invoke('unsloth:list', { connection }).then(throwIfRpgraphIpcError),
  loadUnslothModel: (connection) => ipcRenderer.invoke('unsloth:load', { connection }).then(throwIfRpgraphIpcError),
  isUnslothModelLoaded: (connection) => ipcRenderer.invoke('unsloth:probe', { connection }).then(throwIfRpgraphIpcError),
  unloadUnslothModels: (connection) => ipcRenderer.invoke('unsloth:unload', { connection }).then(throwIfRpgraphIpcError),
  loadLlamaCppModel: (connection) =>
    ipcRenderer.invoke('llamacpp:load-model', { connection }),
  isLlamaCppModelLoaded: (connection) =>
    ipcRenderer.invoke('llamacpp:model-loaded', { connection }),
  unloadLlamaCppModels: (connection) =>
    ipcRenderer.invoke('llamacpp:unload-models', { connection }),
  listOpenRouterModels: (connection, onAbort) =>
    abortableLlmInvoke('openrouter:list-models', { connection }, onAbort).then(throwIfRpgraphIpcError),
  listCompositeModels: (connection) =>
    ipcRenderer.invoke('composite:list-models', { connection }),
  generateOpenRouterSpeech: (request, onChunk) => {
    const requestId = nextLlmRequestId();
    const channel = `openrouter:speech-chunk:${requestId}`;
    const listener = (_event, base64Chunk) => onChunk?.(base64Chunk);
    ipcRenderer.on(channel, listener);
    return ipcRenderer
      .invoke('openrouter:generate-speech', { ...request, requestId })
      .finally(() => ipcRenderer.removeListener(channel, listener));
  },
  generateGeminiSpeech: (request, onChunk) => {
    const requestId = nextLlmRequestId();
    const channel = `gemini:speech-chunk:${requestId}`;
    const listener = (_event, base64Chunk) => onChunk?.(base64Chunk);
    ipcRenderer.on(channel, listener);
    return ipcRenderer
      .invoke('gemini:generate-speech', { ...request, requestId })
      .finally(() => ipcRenderer.removeListener(channel, listener));
  },
  listGeminiModels: (connection, onAbort) =>
    abortableLlmInvoke('gemini:list-models', { connection }, onAbort).then(throwIfRpgraphIpcError),
  listVeniceModels: (connection) =>
    ipcRenderer.invoke('venice:list-models', { connection }),
  generateVeniceSpeech: (request) =>
    ipcRenderer.invoke('venice:generate-speech', request),
  generateVeniceImages: (request) =>
    ipcRenderer.invoke('venice:generate-images', request),
  generateOpenRouterImages: (request) =>
    abortableLlmInvoke('openrouter:generate-images', request),
  loadLmStudioModel: (connection) =>
    ipcRenderer.invoke('lmstudio:load-model', { connection })
      .then(throwIfLlmCancelled)
      .then(throwIfRpgraphIpcError),
  isLmStudioModelLoaded: (connection) =>
    ipcRenderer.invoke('lmstudio:model-loaded', { connection })
      .then(throwIfLlmCancelled)
      .then(throwIfRpgraphIpcError),
  unloadLmStudioModels: (connection) =>
    ipcRenderer.invoke('lmstudio:unload-models', { connection }),
  listOllamaModels: (connection, onAbort) =>
    abortableLlmInvoke('ollama:list-models', { connection }, onAbort).then(throwIfRpgraphIpcError),
  loadOllamaModel: (connection) =>
    ipcRenderer.invoke('ollama:load-model', { connection }),
  isOllamaModelLoaded: (connection) =>
    ipcRenderer.invoke('ollama:model-loaded', { connection }),
  unloadOllamaModels: (connection) =>
    ipcRenderer.invoke('ollama:unload-models', { connection }),
  chatCompletion: (request, onAbort) => abortableLlmInvoke('llm:chat-completion', request, onAbort),
  streamChatCompletion: async (request, onChunk, onAbort, onReasoningTokens) => {
    const requestId = nextLlmRequestId();
    const channel = `llm:chat-stream-chunk:${requestId}`;
    const reasoningChannel = `llm:chat-stream-reasoning:${requestId}`;
    let streamedText = '';
    const listener = (_event, deltaText) => {
      streamedText += deltaText;
      onChunk(streamedText);
    };
    const reasoningListener = (_event, tokenCount) => {
      if (typeof onReasoningTokens === 'function' && Number.isFinite(tokenCount)) {
        onReasoningTokens(tokenCount);
      }
    };
    const requestWithoutSignal = { ...request };
    delete requestWithoutSignal.signal;

    let rejectAbort;
    const abortPromise = new Promise((_resolve, reject) => {
      rejectAbort = reject;
    });
    const abort = () => {
      cancelLlmRequest(requestId, rejectAbort);
    };

    if (typeof onAbort === 'function') {
      onAbort(abort);
    }

    ipcRenderer.on(channel, listener);
    ipcRenderer.on(reasoningChannel, reasoningListener);
    try {
      return await Promise.race([
        ipcRenderer
          .invoke(
            'llm:chat-completion-stream',
            { ...requestWithoutSignal, requestId },
          )
          .then(throwIfLlmCancelled)
          .then(throwIfRpgraphIpcError),
        abortPromise,
      ]);
    } finally {
      ipcRenderer.removeListener(channel, listener);
      ipcRenderer.removeListener(reasoningChannel, reasoningListener);
    }
  },
  listFiles: () => ipcRenderer.invoke('file:list'),
  confirmV3Migration: (summary) => ipcRenderer.sendSync('character:confirm-v3-migration', summary),
  listCharacterFiles: () => ipcRenderer.invoke('character:list'),
  getNpcLibrary: () => ipcRenderer.invoke('npc-library:get'),
  reloadNpcLibrary: () => ipcRenderer.invoke('npc-library:reload'),
  setWorkspaceProtection: (password) => ipcRenderer.invoke('workspace:protection', password),
  onNpcLibraryChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('npc-library:changed', listener);
    return () => ipcRenderer.removeListener('npc-library:changed', listener);
  },
  openNpcLibraryFolder: () => ipcRenderer.invoke('npc-library:open-folder'),
  saveNamedWorkflow: (name, workflow, protection, password, overwrite = false) =>
    ipcRenderer.invoke('workflow:save-named', { name, workflow, protection, password, overwrite }),
  saveRpgraphFileToPath: (request) =>
    ipcRenderer.invoke('file:save-to-path', request),
  loadFile: (fileName, password = '', storage = 'files') =>
    ipcRenderer.invoke('file:load', { fileName, password, storage }),
  tryLoadFile: (fileName, password = '', storage = 'files') =>
    ipcRenderer.invoke('file:try-load', { fileName, password, storage }),
  loadFilePath: (filePath, password = '') =>
    ipcRenderer.invoke('file:load-file', { filePath, password }),
  tryLoadFilePath: (filePath, password = '') =>
    ipcRenderer.invoke('file:try-load-file', { filePath, password }),
  selectFile: () => ipcRenderer.invoke('file:select'),
  selectCharacterFile: () => ipcRenderer.invoke('character:select'),
  selectImages: (multiple = true) => ipcRenderer.invoke('image:select', { multiple }),
  deleteFile: (fileName, storage = 'files') =>
    ipcRenderer.invoke('file:delete', { fileName, storage }),
  loadTextFile: () => ipcRenderer.invoke('text-file:load'),
  loadJsonFile: (options) => ipcRenderer.invoke('json-file:load', options),
  loadDefaultWorkflow: () => ipcRenderer.invoke('workflow:load-default'),
  loadStartDialogState: () => ipcRenderer.invoke('start-dialog:load-state'),
  saveStartTarget: (fileName) => ipcRenderer.invoke('start-dialog:save-target', fileName),
  resolveProjectPath: (relativePath) => ipcRenderer.invoke('app:resolve-project-path', relativePath),
  restoreDefaultFiles: () => ipcRenderer.invoke('defaults:restore-files'),
  reloadWorkflow: (filePath) => ipcRenderer.invoke('workflow:reload', filePath),
  saveCurrentWorkflow: (filePath, workflow) =>
    ipcRenderer.invoke('workflow:save-current', { filePath, workflow }),
  runComfyWorkflow: (request) => ipcRenderer.invoke('comfy:run-workflow', request),
  freeComfyMemory: (request) => ipcRenderer.invoke('comfy:free-memory', request),
  checkComfyConnection: (request) => ipcRenderer.invoke('comfy:check-connection', request),
  listComfyModels: (request) => ipcRenderer.invoke('comfy:list-models', request),
  listComfySamplersAndSchedulers: (request) => ipcRenderer.invoke('comfy:list-sampler-schedulers', request),
  inspectComfyWorkflow: (request) => ipcRenderer.invoke('comfy:inspect-workflow', request),
  repairComfyWorkflow: (request) => ipcRenderer.invoke('comfy:repair-workflow', request),
  applyComfyWorkflowRepair: (request) => ipcRenderer.invoke('comfy:apply-workflow-repair', request),
  selectComfyWorkflow: () => ipcRenderer.invoke('comfy:select-workflow'),
  runComfyWorkflowPath: (request) => ipcRenderer.invoke('comfy:run-workflow-path', request),
  runComfyVoiceWorkflowPath: (request) => ipcRenderer.invoke('comfy:run-voice-workflow-path', request),
  selectAudio: () => ipcRenderer.invoke('audio:select'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getResourceStats: () => ipcRenderer.invoke('system:resource-stats'),
  saveSession: (name, session, protection, password, overwrite = false) =>
    ipcRenderer.invoke('session:save', { name, session, protection, password, overwrite }),
  saveStorybook: (name, storybook, protection, password, overwrite = false) =>
    ipcRenderer.invoke('storybook:save', { name, storybook, protection, password, overwrite }),
  detectCharacterFace: (image) => ipcRenderer.invoke('character:detect-face', image),
  saveCharacter: (name, characterCard, protection, password, overwrite = false, destination = 'characters') =>
    ipcRenderer.invoke('character:save', { name, characterCard, protection, password, overwrite, destination }),
  saveCurrentSession: (filePath, session, protection, password) =>
    ipcRenderer.invoke('session:save-current', { filePath, session, protection, password }),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  toggleFullScreenWindow: () => ipcRenderer.invoke('window:toggle-full-screen'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onWindowCleanupBeforeClose: (callback) => {
    const listener = () => {
      void callback();
    };
    ipcRenderer.on('window:cleanup-before-close', listener);
    return () => ipcRenderer.removeListener('window:cleanup-before-close', listener);
  },
  finishWindowCloseCleanup: () => ipcRenderer.invoke('window:cleanup-complete-close'),
  setZoomFactor: (zoomFactor) => {
    const safeZoomFactor = Number.isFinite(zoomFactor)
      ? Math.min(2, Math.max(0.5, zoomFactor))
      : 1;
    webFrame.setZoomFactor(safeZoomFactor);
  },
});
