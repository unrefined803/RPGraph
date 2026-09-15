export function createWorkspaceProtection(): {
  activate(password: string): void;
  require(request: { protection: string; password?: string }): void;
  readonly required: boolean;
};
