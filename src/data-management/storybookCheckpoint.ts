function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (record(left) && record(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) =>
      Object.prototype.hasOwnProperty.call(right, key) && equal(left[key], right[key]));
  }
  return false;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function characters(value: unknown): value is Array<Record<string, unknown> & { id: string }> {
  return Array.isArray(value) && value.every((entry) => record(entry) && typeof entry.id === 'string') &&
    new Set(value.map((entry) => entry.id)).size === value.length;
}

/** Apply only changes still owned by this turn. Conflicting authoring wins.
 * Characters are atomic: merging individual fields could break media/account references.
 */
export function restoreStorybookCheckpoint(current: unknown, source: unknown, target: unknown): unknown {
  if (source === target) return current;
  if (current === source) return structuredClone(target);
  if (typeof current !== 'string' || typeof source !== 'string' || typeof target !== 'string') return current;
  try {
    const live: unknown = JSON.parse(current);
    const from: unknown = JSON.parse(source);
    const to: unknown = JSON.parse(target);
    if (!record(live) || !record(from) || !record(to)) return current;
    const result = { ...live };
    for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
      if (equal(from[key], to[key])) continue;
      if (key === 'characters' && characters(live[key]) && characters(from[key]) && characters(to[key])) {
        const currentCharacters = live[key];
        const sourceById = new Map(from[key].map((entry) => [entry.id, entry]));
        const targetById = new Map(to[key].map((entry) => [entry.id, entry]));
        const currentIds = new Set(currentCharacters.map((entry) => entry.id));
        result[key] = [
          ...currentCharacters.flatMap((entry) => {
            const previous = sourceById.get(entry.id);
            const next = targetById.get(entry.id);
            if (equal(previous, next) || !equal(entry, previous)) return [entry];
            return next ? [next] : [];
          }),
          ...to[key].filter((entry) => !currentIds.has(entry.id) && !sourceById.has(entry.id)),
        ];
      } else if (equal(live[key], from[key])) {
        if (Object.prototype.hasOwnProperty.call(to, key)) result[key] = to[key];
        else delete result[key];
      }
    }
    return equal(result, live) ? current : JSON.stringify(result, null, 2);
  } catch {
    // Legacy or manually invalid JSON must never overwrite a newer document.
    return current;
  }
}
