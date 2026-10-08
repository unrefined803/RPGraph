import { describe, it, expect } from 'vitest';
import { normalizePhoneName, phoneNamesMatch } from './phoneMessages';

describe('phone name normalization and matching', () => {
  it('strips diacritics and collapses whitespace/case', () => {
    expect(normalizePhoneName('  José   Muñoz ')).toBe('jose munoz');
    expect(normalizePhoneName('Renée')).toBe('renee');
  });

  it('matches full names in any separator style and rejects a first name alone', () => {
    expect(phoneNamesMatch('Nova Reyes', 'nova reyes')).toBe(true);
    expect(phoneNamesMatch('Nova Reyes', 'Nova_Reyes')).toBe(true);
    expect(phoneNamesMatch('Nova Reyes', 'nova.reyes')).toBe(true);
    expect(phoneNamesMatch('Nova Reyes', 'Nova')).toBe(false);
    expect(phoneNamesMatch('Nova Reyes', 'Nova Brandt')).toBe(false);
    expect(phoneNamesMatch('Nova', 'Alex')).toBe(false);
    expect(phoneNamesMatch('', 'Nova')).toBe(false);
  });
});
