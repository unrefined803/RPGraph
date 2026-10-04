/**
 * Select one source file per Storybook, then one Storybook per character. No media or file I/O.
 * `preferences.origins` maps a Storybook file to the file chosen to provide its
 * cast (itself or one of its saves); `preferences.priority` lists Storybook
 * files that win shared characters, most preferred first. Choices that no
 * longer apply are ignored, so the newest save and newest Storybook remain the default.
 */
function selectNpcSources(files, activeStorybookFileNames = [], preferences = {}) {
  const active = new Set(activeStorybookFileNames);
  const origins = preferences.origins ?? {};
  const priority = preferences.priority ?? [];
  const rank = (lineage) => {
    const position = priority.indexOf(lineage.book.fileName);
    return position < 0 ? Infinity : position;
  };
  const sorted = [...files].sort((a, b) => a.fileName.localeCompare(b.fileName));
  const lineages = sorted.filter((file) => file.kind === 'storybook' && !active.has(file.fileName)).map((book) => {
    const saves = sorted.filter((file) => file.kind === 'session' && Number.isFinite(file.savedAt) &&
      file.sources.some((source) => source.storybookFileName === book.fileName));
    const candidates = [book, ...saves];
    let origin = book;
    for (const file of saves) {
      if (origin === book || file.savedAt > origin.savedAt) origin = file;
    }
    const preferred = Object.prototype.hasOwnProperty.call(origins, book.fileName) ? origins[book.fileName] : undefined;
    origin = candidates.find((file) => file.fileName === preferred) ?? origin;
    const cast = (file) => file.sources.find((entry) => entry.storybookFileName === book.fileName)?.characters ?? [];
    return { book, origin, characters: cast(origin),
      alternates: candidates.filter((file) => file !== origin).map((file) => ({ fileName: file.fileName, characters: cast(file) })) };
  });
  const winners = new Map();
  for (const lineage of lineages) {
    for (const character of lineage.characters) {
      const previous = winners.get(character.id);
      if (!previous || rank(lineage) < rank(previous) ||
          (rank(lineage) === rank(previous) && lineage.book.mtimeMs > previous.book.mtimeMs)) {
        winners.set(character.id, lineage);
      }
    }
  }
  return lineages.map((lineage) => ({ storybookFileName: lineage.book.fileName,
    originFileName: lineage.origin.fileName,
    characters: lineage.characters.filter((character) => winners.get(character.id) === lineage),
    // Characters of this source that another Storybook currently provides.
    yielded: lineage.characters.filter((character) => winners.get(character.id) !== lineage).map((character) => ({
      ...character, originFileName: winners.get(character.id).origin.fileName,
    })),
    // The other files that could provide this Storybook's cast.
    alternates: lineage.alternates,
  })).filter((lineage) => lineage.characters.length || lineage.yielded.length || lineage.alternates.length);
}

module.exports = { selectNpcSources };
