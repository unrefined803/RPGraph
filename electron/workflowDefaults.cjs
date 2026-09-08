const path = require('node:path');

const defaultWorkflowFileNamePattern = /^workflow\.default.*\.json$/i;

function bundledDefaultWorkflowFileNames(names) {
  return names
    .filter((name) => defaultWorkflowFileNamePattern.test(name))
    .sort((left, right) => {
      const leftPlanning = /planning/i.test(left);
      const rightPlanning = /planning/i.test(right);
      if (leftPlanning !== rightPlanning) {
        return leftPlanning ? 1 : -1;
      }
      return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    });
}

function importedDefaultFileNamesFromState(state) {
  return Array.from(new Set([
    ...(Array.isArray(state?.importedDefaultFileNames)
      ? state.importedDefaultFileNames
          .filter((name) => typeof name === 'string')
          .map((name) => path.basename(name))
      : []),
    ...(typeof state?.importedDefaultFileName === 'string'
      ? [path.basename(state.importedDefaultFileName)]
      : []),
  ]));
}

function missingDefaultFileTypes(files) {
  const types = new Set(Array.isArray(files) ? files.map((file) => file?.type) : []);
  return [
    ...(!types.has('workflow') ? ['workflows'] : []),
    ...(!types.has('storybook') ? ['Storybooks'] : []),
  ];
}

async function restoreBundledDefaultWorkflows(
  bundledPaths,
  restoreWorkflow,
  activateWorkflow,
) {
  if (bundledPaths.length === 0) {
    throw new Error('No bundled default workflows are available to restore.');
  }
  const restored = [];
  for (const bundledPath of bundledPaths) {
    restored.push(await restoreWorkflow(bundledPath));
  }
  const primary = restored[restored.length - 1];
  await activateWorkflow(primary);
  return primary;
}

module.exports = {
  bundledDefaultWorkflowFileNames,
  importedDefaultFileNamesFromState,
  missingDefaultFileTypes,
  restoreBundledDefaultWorkflows,
};
