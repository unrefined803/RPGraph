export type CharacterMention = { start: number; end: number; id: string; text: string };

function hasBoundaries(value: string, start: number, end: number) {
  return (start === 0 || /\s/.test(value[start - 1])) &&
    (end === value.length || /[\s.,!?;:()[\]{}]/.test(value[end]));
}

/** Keep explicit identity bindings only while their original mention text survives an edit. */
export function updateCharacterMentions(previous: string, next: string, mentions: CharacterMention[]) {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let oldEnd = previous.length;
  let newEnd = next.length;
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = next.length - previous.length;
  return mentions.flatMap((mention) => {
    const updated = mention.end <= start ? mention
      : mention.start >= oldEnd ? { ...mention, start: mention.start + delta, end: mention.end + delta }
        : undefined;
    return updated && next.slice(updated.start, updated.end) === updated.text && hasBoundaries(next, updated.start, updated.end)
      ? [updated] : [];
  });
}

export function characterMentionQuery(value: string, caret: number, mentions: CharacterMention[]) {
  const prefix = value.slice(0, caret);
  const match = /(?:^|\s)@([^@\n]{1,80})$/.exec(prefix);
  if (!match) return undefined;
  const start = prefix.lastIndexOf('@');
  // A completed reference must not turn back into a search when prose follows it.
  if (mentions.some((mention) => mention.start === start)) return undefined;
  return { start, query: match[1] };
}
