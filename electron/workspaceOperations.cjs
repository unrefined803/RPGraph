function createWorkspaceOperations() {
  const pending = new Set();
  let changing = false;
  return {
    async run(action) {
      if (changing) throw new Error('Wait for the workspace change to finish.');
      const operation = Promise.resolve().then(action);
      pending.add(operation);
      try { return await operation; }
      finally { pending.delete(operation); }
    },
    async transition(action) {
      if (changing) throw new Error('Wait for the workspace change to finish.');
      changing = true;
      try {
        await Promise.allSettled([...pending]);
        return await action();
      } finally { changing = false; }
    },
  };
}

module.exports = { createWorkspaceOperations };
