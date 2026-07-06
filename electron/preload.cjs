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
      .then(throwIfLlmCancelled),
    abortPromise,
  ]);
}

contextBridge.exposeInMainWorld('rpgraph', {
  listModels: (connection, onAbort) =>
    abortableLlmInvoke('llm:list-models', { connection }, onAbort),
  listLmStudioModels: (connection) =>
    ipcRenderer.invoke('lmstudio:list-models', { connection }).then(throwIfRpgraphIpcError),
  listOpenRouterModels: (connection) =>
    ipcRenderer.invoke('openrouter:list-models', { connection }),
  generateOpenRouterSpeech: (request, onChunk) => {
    const requestId = nextLlmRequestId();
    const channel = `openrouter:speech-chunk:${requestId}`;
    const listener = (_event, base64Chunk) => onChunk?.(base64Chunk);
    ipcRenderer.on(channel, listener);
    return ipcRenderer
      .invoke('openrouter:generate-speech', { ...request, requestId })
      .finally(() => ipcRenderer.removeListener(channel, listener));
  },
  listGeminiModels: (connection) =>
    ipcRenderer.invoke('gemini:list-models', { connection }),
  loadLmStudioModel: (connection) =>
    ipcRenderer.invoke('lmstudio:load-model', { connection }),
  unloadLmStudioModels: (connection) =>
    ipcRenderer.invoke('lmstudio:unload-models', { connection }),
  listOllamaModels: (connection) =>
    ipcRenderer.invoke('ollama:list-models', { connection }).then(throwIfRpgraphIpcError),
  loadOllamaModel: (connection) =>
    ipcRenderer.invoke('ollama:load-model', { connection }),
  unloadOllamaModels: (connection) =>
    ipcRenderer.invoke('ollama:unload-models', { connection }),
  chatCompletion: (request, onAbort) => abortableLlmInvoke('llm:chat-completion', request, onAbort),
  streamChatCompletion: async (request, onChunk, onAbort) => {
    const requestId = nextLlmRequestId();
    const channel = `llm:chat-stream-chunk:${requestId}`;
    let streamedText = '';
    const listener = (_event, deltaText) => {
      streamedText += deltaText;
      onChunk(streamedText);
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
    try {
      return await Promise.race([
        ipcRenderer
          .invoke(
            'llm:chat-completion-stream',
            { ...requestWithoutSignal, requestId },
          )
          .then(throwIfLlmCancelled),
        abortPromise,
      ]);
    } finally {
      ipcRenderer.removeListener(channel, listener);
    }
  },
  listFiles: () => ipcRenderer.invoke('file:list'),
  saveNamedWorkflow: (name, workflow, protection, password, overwrite = false) =>
    ipcRenderer.invoke('workflow:save-named', { name, workflow, protection, password, overwrite }),
  saveRpgraphFileToPath: (request) =>
    ipcRenderer.invoke('file:save-to-path', request),
  loadFile: (fileName, password = '') =>
    ipcRenderer.invoke('file:load', { fileName, password }),
  loadFilePath: (filePath, password = '') =>
    ipcRenderer.invoke('file:load-file', { filePath, password }),
  selectFile: () => ipcRenderer.invoke('file:select'),
  selectImages: (multiple = true) => ipcRenderer.invoke('image:select', { multiple }),
  deleteFile: (fileName) => ipcRenderer.invoke('file:delete', fileName),
  loadTextFile: () => ipcRenderer.invoke('text-file:load'),
  loadJsonFile: () => ipcRenderer.invoke('json-file:load'),
  loadDefaultWorkflow: () => ipcRenderer.invoke('workflow:load-default'),
  loadStartupWorkflow: () => ipcRenderer.invoke('workflow:load-startup'),
  resolveProjectPath: (relativePath) => ipcRenderer.invoke('app:resolve-project-path', relativePath),
  restoreDefaultWorkflow: () => ipcRenderer.invoke('workflow:restore-default'),
  reloadWorkflow: (filePath) => ipcRenderer.invoke('workflow:reload', filePath),
  saveCurrentWorkflow: (filePath, workflow) =>
    ipcRenderer.invoke('workflow:save-current', { filePath, workflow }),
  runComfyWorkflow: (request) => ipcRenderer.invoke('comfy:run-workflow', request),
  freeComfyMemory: (request) => ipcRenderer.invoke('comfy:free-memory', request),
  checkComfyConnection: (request) => ipcRenderer.invoke('comfy:check-connection', request),
  listComfyModels: (request) => ipcRenderer.invoke('comfy:list-models', request),
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
