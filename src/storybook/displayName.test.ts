import { describe, expect, it } from 'vitest';
import { storybookDisplayName } from './displayName';

describe('storybookDisplayName', () => {
  it.each([
    ['Jane_Doe.json', 'Jane Doe'],
    ['Jane Doe.json', 'Jane Doe'],
    ['Appname:_Jane_Doe.rpgraph-storybook.json', 'Appname: Jane Doe'],
    ['Appname :   Display Name.json', 'Appname: Display Name'],
    ['Appname:username.json', 'Appname: username'],
  ])('formats %s as %s', (value, expected) => {
    expect(storybookDisplayName(value)).toBe(expected);
  });
});
