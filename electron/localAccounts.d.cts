export function createLocalAccounts(userData: string): {
  list(): Promise<{ username: string }[]>;
  create(username: string, password: string): Promise<{ username: string }>;
  unlock(username: string, password: string): Promise<{ username: string }>;
  useLocal(): Promise<void>;
  prepare(): void;
  delete(password: string): Promise<{ username: string }>;
  readonly root: string;
  readonly active: boolean;
  readonly password: string;
};
