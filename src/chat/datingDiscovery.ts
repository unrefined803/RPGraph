/** Stable pseudorandom rank for an account pair, independent of registry order. */
function discoveryRank(ownerId: string, candidateId: string) {
  const key = JSON.stringify([ownerId, candidateId]);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Each owner gets a shuffled discovery order that survives rerenders and reloads. */
export function datingDiscoveryOrder<T extends { id: string }>(profiles: readonly T[], ownerId: string): T[] {
  return profiles.map((profile) => ({ profile, rank: discoveryRank(ownerId, profile.id) }))
    .sort((left, right) => left.rank - right.rank ||
      (left.profile.id < right.profile.id ? -1 : left.profile.id > right.profile.id ? 1 : 0))
    .map(({ profile }) => profile);
}
