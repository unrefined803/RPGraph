export function createWorkspaceOperations(): {
  run<T>(action: () => T | Promise<T>): Promise<T>;
  transition<T>(action: () => T | Promise<T>): Promise<T>;
};
