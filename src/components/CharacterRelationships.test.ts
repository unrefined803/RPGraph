import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { Character } from '../characters/character';
import { CharacterRelationships } from './CharacterRelationships';

function character(id: string, name: string): Character {
  return {
    id,
    name,
    role: 'Character',
    description: '',
    personality: '',
    speechStyle: '',
    images: [],
  };
}

describe('CharacterRelationships', () => {
  it('renders a compact summary until editing is requested', () => {
    const owner = {
      ...character('espen', 'Espen Harper'),
      relationships: [{
        characterId: 'helga',
        description: 'Her older sister and closest confidante.',
        apps: { whatsup: true, fotogram: true, onlyfriends: false },
      }],
    } satisfies Character;
    const markup = renderToStaticMarkup(createElement(CharacterRelationships, {
      character: owner,
      characters: [owner, character('helga', 'Helga Harper')],
      onChange: () => undefined,
    }));

    expect(markup).toContain('>Helga Harper</strong>');
    expect(markup).toContain('WhatsUp');
    expect(markup).toContain('Fotogram');
    expect(markup).not.toContain('OnlyFriends');
    expect(markup).toContain('Her older sister and closest confidante.');
    expect(markup).toContain('>Edit</button>');
    expect(markup).not.toContain('<table');
    expect(markup).not.toContain('<textarea');
    expect(markup).not.toContain('Type a name to add a contact');
  });
});
