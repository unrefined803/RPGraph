import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  AGENCY_TAG_TOOLTIP_DELAY_MS,
  getAgencyTagMeaning,
} from './AgencyTagTooltip';
import { AgencyTagSelect } from './AgencyTagSelect';
import { CharacterAgencyField } from './CharacterAgencyField';
import type { Character } from '../characters/character';

function testCharacter(tags: Character['agencyTags'] = ['friendly_regular']): Character {
  return {
    id: 'test-char',
    name: 'Test Character',
    role: 'NPC',
    description: 'A test character',
    personality: 'Friendly',
    speechStyle: 'Casual',
    images: [],
    agencyTags: tags,
    apps: {
      fotogram: {
        accountId: 'test-account-id',
        bio: '',
        enabled: true,
        agencyTags: tags,
        accountRole: 'user',
      },
    },
  };
}

describe('AgencyTagTooltip', () => {
  it('uses a 700ms hover delay', () => {
    expect(AGENCY_TAG_TOOLTIP_DELAY_MS).toBe(700);
  });

  it('looks up agency tag descriptions from catalog correctly', () => {
    expect(getAgencyTagMeaning('friendly_regular')).toContain('warm familiar way');
    expect(getAgencyTagMeaning('casual_chatter')).toContain('everyday conversation');
    expect(getAgencyTagMeaning('social_lurker')).toContain('observes quietly');
    expect(getAgencyTagMeaning('non_existent_tag')).toBeUndefined();
  });

  it('renders CharacterAgencyField with hoverable badges and pills in SSR', () => {
    const markup = renderToStaticMarkup(
      createElement(CharacterAgencyField, {
        character: testCharacter(['friendly_regular']),
      })
    );

    expect(markup).toContain('Agency Tags · 1 Tag');
    expect(markup).toContain('character-agency-field');
  });

  it('renders AgencyTagSelect with selected value and placeholder in SSR', () => {
    const markupNone = renderToStaticMarkup(
      createElement(AgencyTagSelect, {
        value: '',
        placeholder: 'None',
        options: [{ id: 'friendly_regular' }],
        onChange: () => undefined,
      })
    );
    expect(markupNone).toContain('None');
    expect(markupNone).toContain('character-agency-select');

    const markupSelected = renderToStaticMarkup(
      createElement(AgencyTagSelect, {
        value: 'friendly_regular',
        options: [{ id: 'friendly_regular' }],
        onChange: () => undefined,
      })
    );
    expect(markupSelected).toContain('friendly_regular');
  });
});
