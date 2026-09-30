export type AccountFeaturePreference = 'enabled' | 'disabled';

export const accountFeaturePreferenceStorageKey = 'rpgraph.accountFeature';
export const lastAccountUsernameStorageKey = 'rpgraph.lastAccountUsername';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadAccountFeaturePreference(
  storage?: PreferenceStorage,
): AccountFeaturePreference | null {
  try {
    const value = (storage ?? window.localStorage).getItem(accountFeaturePreferenceStorageKey);
    return value === 'enabled' || value === 'disabled' ? value : null;
  } catch {
    return null;
  }
}

export function saveAccountFeaturePreference(
  preference: AccountFeaturePreference,
  storage?: PreferenceStorage,
) {
  try {
    (storage ?? window.localStorage).setItem(accountFeaturePreferenceStorageKey, preference);
    return true;
  } catch {
    return false;
  }
}

export function loadLastAccountUsername(storage?: PreferenceStorage) {
  try {
    const value = (storage ?? window.localStorage).getItem(lastAccountUsernameStorageKey);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function saveLastAccountUsername(username: string, storage?: PreferenceStorage) {
  try {
    (storage ?? window.localStorage).setItem(lastAccountUsernameStorageKey, username);
    return true;
  } catch {
    return false;
  }
}
