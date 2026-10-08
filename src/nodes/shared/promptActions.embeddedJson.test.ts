import { expect, it } from 'vitest';
import { parsePromptActionCall } from './promptActions';

it('finds an embedded action after prose with an unpaired quote', () => {
  const action = '{"action":"get_image_id","phoneOwner":"Mina","tags":"selfie, mirror"}';
  expect(parsePromptActionCall(`Mina leans in. "I'll check the photos first.\n\n${action}`))
    .toEqual(parsePromptActionCall(action));
  expect(parsePromptActionCall(action)).toBeDefined();
});
