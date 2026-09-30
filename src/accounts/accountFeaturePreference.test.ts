import { describe, expect, it, vi } from 'vitest';
import {
  accountFeaturePreferenceStorageKey,
  lastAccountUsernameStorageKey,
  loadAccountFeaturePreference,
  loadLastAccountUsername,
  saveAccountFeaturePreference,
  saveLastAccountUsername,
} from './accountFeaturePreference';

describe('account feature preference', () => {
  it.each(['enabled', 'disabled'] as const)('loads the persisted %s preference', preference => {
    const storage = { getItem: vi.fn(() => preference), setItem: vi.fn() };

    expect(loadAccountFeaturePreference(storage)).toBe(preference);
    expect(storage.getItem).toHaveBeenCalledWith(accountFeaturePreferenceStorageKey);
  });

  it('treats missing and unsupported values as undecided', () => {
    const storage = { getItem: vi.fn(() => 'legacy-value'), setItem: vi.fn() };

    expect(loadAccountFeaturePreference(storage)).toBeNull();
  });

  it('persists a preference', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };

    expect(saveAccountFeaturePreference('disabled', storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(accountFeaturePreferenceStorageKey, 'disabled');
  });

  it('falls back safely when storage is unavailable', () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error('unavailable'); }),
      setItem: vi.fn(() => { throw new Error('unavailable'); }),
    };

    expect(loadAccountFeaturePreference(storage)).toBeNull();
    expect(saveAccountFeaturePreference('enabled', storage)).toBe(false);
  });
});

describe('last account username preference', () => {
  it('loads and persists the last selected username', () => {
    const storage = { getItem: vi.fn(() => 'alice'), setItem: vi.fn() };

    expect(loadLastAccountUsername(storage)).toBe('alice');
    expect(storage.getItem).toHaveBeenCalledWith(lastAccountUsernameStorageKey);
    expect(saveLastAccountUsername('bob', storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(lastAccountUsernameStorageKey, 'bob');
  });

  it('handles missing and unavailable username storage', () => {
    const missing = { getItem: vi.fn(() => ''), setItem: vi.fn() };
    const unavailable = {
      getItem: vi.fn(() => { throw new Error('unavailable'); }),
      setItem: vi.fn(() => { throw new Error('unavailable'); }),
    };

    expect(loadLastAccountUsername(missing)).toBeNull();
    expect(loadLastAccountUsername(unavailable)).toBeNull();
    expect(saveLastAccountUsername('alice', unavailable)).toBe(false);
  });
});
