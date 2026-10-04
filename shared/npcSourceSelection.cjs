/** Select one save per Storybook, then one Storybook per character. No media or file I/O. */
function selectNpcSources(files, activeStorybookFileNames = []) {
  const active = new Set(activeStorybookFileNames);
  const sorted = [...files].sort((a, b) => a.fileName.localeCompare(b.fileName));
  const lineages = sorted.filter((file) => file.kind === 'storybook' && !active.has(file.fileName)).map((book) => {
    let origin = book;
    for (const file of sorted) {
      if (file.kind !== 'session' || !Number.isFinite(file.savedAt) ||
          !file.sources.some((source) => source.storybookFileName === book.fileName)) continue;
      if (origin === book || file.savedAt > origin.savedAt) origin = file;
    }
    const source = origin.sources.find((entry) => entry.storybookFileName === book.fileName);
    return { book, origin, characters: source?.characters ?? [] };
  });
  const winners = new Map();
  for (const lineage of lineages) {
    for (const character of lineage.characters) {
      const previous = winners.get(character.id);
      if (!previous || lineage.book.mtimeMs > previous.book.mtimeMs) winners.set(character.id, lineage);
    }
  }
  return lineages.map((lineage) => ({ storybookFileName: lineage.book.fileName,
    originFileName: lineage.origin.fileName,
    characters: lineage.characters.filter((character) => winners.get(character.id) === lineage),
  })).filter((lineage) => lineage.characters.length);
}

module.exports = { selectNpcSources };
