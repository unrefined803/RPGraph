import { createContext } from 'react';
import type { StorybookCharacter } from '../storybook/runtime';
import type { AccountLinkTarget, AccountLinkApp } from './accountLinks';

export type AccountLinkOpenRequest = {
  requestId: number;
  app: AccountLinkApp;
  accountId: string;
  name: string;
  username: string;
};
export const AccountLinkContext = createContext<{
  characters: StorybookCharacter[];
  owner?: StorybookCharacter;
  disabled?: boolean;
  open: (target: AccountLinkTarget) => void;
  request?: AccountLinkOpenRequest;
}>({ characters: [], open: () => {} });
