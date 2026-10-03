import { expect, it } from 'vitest';
import { datingDiscoveryOrder } from './datingDiscovery';

const profiles = Array.from({ length: 12 }, (_, index) => ({ id: `account-${index}`, name: `Person ${index}` }));
const ids = (entries: typeof profiles) => entries.map((entry) => entry.id);

it('gives different owners individual shuffled orders without changing the input', () => {
  const original = ids(profiles);
  const first = datingDiscoveryOrder(profiles, 'owner-a');
  const second = datingDiscoveryOrder(profiles, 'owner-b');
  expect(ids(first)).not.toEqual(original);
  expect(ids(second)).not.toEqual(ids(first));
  expect(new Set(first)).toEqual(new Set(profiles));
  expect(ids(profiles)).toEqual(original);
});

it('keeps discovery stable after reloads and changes in registry order', () => {
  expect(datingDiscoveryOrder([...profiles].reverse(), 'owner-a'))
    .toEqual(datingDiscoveryOrder(profiles, 'owner-a'));
});

it('preserves remaining order when profiles are passed, liked, added or removed', () => {
  const first = datingDiscoveryOrder(profiles, 'owner-a');
  const remaining = profiles.filter((profile) => profile.id !== first[0].id);
  expect(datingDiscoveryOrder(remaining, 'owner-a')).toEqual(first.slice(1));
  expect(datingDiscoveryOrder([...profiles, { id: 'new-account', name: 'New person' }], 'owner-a')
    .filter((profile) => profile.id !== 'new-account')).toEqual(first);
});

it('handles empty and single-profile discovery lists', () => {
  expect(datingDiscoveryOrder([], 'owner-a')).toEqual([]);
  expect(datingDiscoveryOrder([profiles[0]], 'owner-a')).toEqual([profiles[0]]);
});
