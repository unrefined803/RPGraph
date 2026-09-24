// Dev-only fallback for `window.rpgraph`, the API the Electron preload script
// normally injects. Electron always sets `window.rpgraph` before this module
// runs, so this only ever activates in a plain browser tab (e.g. `npm run dev`).
//
// Most call sites already guard with `window.rpgraph?.foo` and fall back to a
// browser-friendly path (see npcLibrary.ts, themeRegistry.ts, etc.), so this
// stub deliberately leaves window.rpgraph *unset* rather than replacing it
// wholesale — that would bypass those existing fallbacks. It only patches the
// handful of call sites that dereference window.rpgraph unconditionally
// outside a try/catch (so a real desktop-only crash doesn't also block
// browser-based visual/layout debugging).
if (typeof window !== 'undefined' && !window.rpgraph) {
  window.rpgraph = {
    setZoomFactor: () => {},
    onWindowCleanupBeforeClose: () => () => {},
    finishWindowCloseCleanup: async () => {},
    saveSettings: async () => ({ filePath: '', apiKeyEncryptionAvailable: false }),
    loadSettings: async () => ({
      filePath: '',
      settings: null,
      apiKeyEncryptionAvailable: false,
      apiKeyDecryptionUnavailable: false,
    }),
  } as unknown as Window['rpgraph'];
}
