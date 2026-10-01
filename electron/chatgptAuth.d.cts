import type { createServer } from 'node:http';

type ChatGPTState = {
  lastProfileId?: string;
  secureStorage: boolean;
  profiles: Array<{
    id: string; label: string; connected: boolean; sharing: boolean;
    storageLocked: boolean; usageConfirmed: boolean;
  }>;
};

export function createChatGPTAuth(options: {
  userDataPath: string;
  runtime: { claim: () => boolean; release: () => void };
  storage: { available: () => boolean; encrypt: (value: string) => string; decrypt: (value: string) => string };
  openBrowser: (url: string) => Promise<unknown>;
  fetch?: typeof fetch;
  createServer?: typeof createServer;
  now?: () => number;
  signInTimeoutMs?: number;
}): {
  state: (root: string) => Promise<ChatGPTState>;
  select: (root: string, id: string) => Promise<ChatGPTState>;
  confirmUsage: (root: string, id: string) => Promise<ChatGPTState>;
  signIn: (root: string, id?: string) => Promise<ChatGPTState>;
  accessToken: (root: string, id: string, signal?: AbortSignal) => Promise<string>;
  signOut: (root: string, id: string) => Promise<ChatGPTState & { remoteRevocationConfirmed: boolean }>;
  cancelPending: () => void;
  cancelSignIn: () => void;
  dispose: () => void;
  forgetWorkspace: (root: string) => void;
};
