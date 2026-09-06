import { describe, expect, it } from 'vitest';
import { datingSeekingOrder, normalizeDatingProfile } from './datingProfile';
import { rpStorybookCharacterSocial } from '../nodes/rp-storybook/model';

const profile = { name: ' Alex ', age: 25, bio: ' Hello there. ', interests: 'Books', photoIds: ['gallery-1'], decisions: { 'demo-robin': 'like' } };

describe('MatchMe profile persistence', () => {
  it('orders the default preference first for an explicit gender change', () => {
    expect(datingSeekingOrder('woman')).toEqual(['man', 'woman', 'nonbinary']);
    expect(datingSeekingOrder('man')).toEqual(['woman', 'man', 'nonbinary']);
    expect(datingSeekingOrder('nonbinary')).toEqual(['nonbinary', 'woman', 'man']);
    expect(normalizeDatingProfile({ ...profile, gender: 'woman', seeking: ['woman'] })?.seeking).toEqual(['woman']);
  });
  it('requires an adult age, name, bio and photo before creating an account', () => {
    for (const patch of [{ age: 17 }, { age: 25.5 }, { name: ' ' }, { bio: '' }, { photoIds: [] }]) {
      expect(normalizeDatingProfile({ ...profile, ...patch })).toBeUndefined();
    }
  });
  it('preserves profile gallery references and decisions through Storybook JSON', () => {
    const social = rpStorybookCharacterSocial({ fotogramUsername: 'alex', plotTwist: profile });
    expect(rpStorybookCharacterSocial(JSON.parse(JSON.stringify(social)))).toEqual(social);
    expect(social.plotTwist).toEqual({ ...profile, name: 'Alex', bio: 'Hello there.' });
    expect(social.fotogramUsername).toBe('alex');
  });
  it('round-trips gender and multiple preferences while retaining older profiles', () => {
    const social = rpStorybookCharacterSocial({ plotTwist: { ...profile, gender: 'woman', seeking: ['man', 'nonbinary'] } });
    expect(rpStorybookCharacterSocial(JSON.parse(JSON.stringify(social))).plotTwist)
      .toMatchObject({ gender: 'woman', seeking: ['man', 'nonbinary'] });
    expect(normalizeDatingProfile(profile)).toBeDefined();
    expect(normalizeDatingProfile({ ...profile, gender: 'invalid', seeking: ['woman', 'woman', 'invalid'] }))
      .toMatchObject({ seeking: ['woman'] });
    expect(normalizeDatingProfile({ ...profile, gender: 'invalid' })?.gender).toBeUndefined();
  });
  it('limits stored profile photos to three without removing gallery images', () => {
    expect(normalizeDatingProfile({ ...profile, photoIds: ['one', 'two', 'three', 'four'] })?.photoIds)
      .toEqual(['one', 'two', 'three']);
  });
  it('ignores invalid decisions and duplicate photos without breaking older accounts', () => {
    expect(normalizeDatingProfile({ ...profile, photoIds: ['gallery-1', 'gallery-1', null], decisions: { valid: 'pass', invalid: 'match' } }))
      .toMatchObject({ photoIds: ['gallery-1'], decisions: { valid: 'pass' } });
    expect(rpStorybookCharacterSocial({ fotogramUsername: 'alex' }).plotTwist).toBeUndefined();
  });
});
