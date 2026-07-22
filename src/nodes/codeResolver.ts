const nodeFileLoaders = import.meta.glob('./**/*.ts*', { query: '?raw', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;

// Node types whose source directory name differs from the registered node type.
const nodeTypeDirectories: Record<string, string> = {
  custom: 'custom-node',
};

export async function getNodeCodeSnippet(nodeType: string): Promise<string> {
  let codeSnippet = '';

  // Find all files belonging to this nodeType's directory
  // e.g. ./llm-prompt/Card.tsx, ./llm-prompt/run.ts
  const directory = nodeTypeDirectories[nodeType] ?? nodeType;
  const prefix = `./${directory}/`;
  
  const matchingFiles = Object.keys(nodeFileLoaders).filter((path) =>
    path.startsWith(prefix)
  );

  if (matchingFiles.length === 0) {
    return `No source code files found for node type: ${nodeType}`;
  }

  // Sort logic/runner files first and Card/UI files last so that when the combined
  // snippet is truncated for the prompt, behavior-relevant code survives.
  const sortedFiles = [...matchingFiles].sort((a, b) => {
    const aIsCard = a.toLowerCase().includes('card');
    const bIsCard = b.toLowerCase().includes('card');
    if (aIsCard && !bIsCard) return 1;
    if (!aIsCard && bIsCard) return -1;
    return a.localeCompare(b);
  });

  for (const filePath of sortedFiles) {
    const fileName = filePath.replace(prefix, '');
    // Exclude any temporary or compiled artifact files if any (usually not in src/nodes)
    const content = await nodeFileLoaders[filePath]?.() || '';
    codeSnippet += `// File: ${directory}/${fileName}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
  }

  return codeSnippet;
}
