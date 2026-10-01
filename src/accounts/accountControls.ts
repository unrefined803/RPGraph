import { createContext } from 'react';

export const AccountControlsContext = createContext<{
  hasAccounts: boolean;
  openAccountEntry: () => void;
  deleteAccount: (password: string) => Promise<void>;
  openFolder: () => Promise<{ path: string }>;
  filenamePrivacy: boolean;
  setFilenamePrivacy: (enabled: boolean) => Promise<void>;
}>({
  hasAccounts: false,
  openAccountEntry: () => {},
  deleteAccount: async () => {},
  openFolder: async () => ({ path: '' }),
  filenamePrivacy: true,
  setFilenamePrivacy: async () => {},
});
