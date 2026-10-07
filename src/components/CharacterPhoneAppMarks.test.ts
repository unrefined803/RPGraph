import { describe, expect, it } from 'vitest';
import { characterPhoneAppMarks } from './CharacterPhoneAppMarks';

describe('characterPhoneAppMarks', () => {
  it('lists WhatsUp first and marks a second account', () => {
    const marks = characterPhoneAppMarks({
      whatsup: { accountId: 'character:alex:whatsup', enabled: true, bio: '', alias: { name: 'Lex' } },
    }, 'Alex');

    expect(marks.map((mark) => mark.app)).toEqual(['whatsup', 'fotogram', 'onlyfriends', 'matchme']);
    expect(marks[0]).toMatchObject({ enabled: true, second: true, tooltip: 'WhatsUp: Alex · Second account: Lex' });
    expect(characterPhoneAppMarks({}, 'Alex')[0]).toMatchObject({ second: false, tooltip: 'WhatsUp: Alex · No second account' });
  });

  it('flags Privacy Mode only on enabled Fotogram and OnlyFriends accounts', () => {
    const marks = characterPhoneAppMarks({
      fotogram: { accountId: 'character:alex:fotogram', enabled: true, bio: '', profileName: 'alex.pix', privacyMode: true },
      onlyfriends: { accountId: 'character:alex:onlyfriends', enabled: false, bio: '', profileName: 'lex', privacyMode: true },
      matchme: { accountId: 'character:alex:matchme', enabled: true, bio: '', profileName: 'Alex' },
    }, 'Alex');

    expect(marks[1]).toMatchObject({ privacy: true, tooltip: 'Fotogram: @alex.pix · Privacy Mode on (real name hidden)' });
    expect(marks[2]).toMatchObject({ enabled: false, privacy: false, tooltip: 'OnlyFriends: no account' });
    expect(marks[3]).toMatchObject({ privacy: false, tooltip: 'MatchMe: @Alex' });
  });
});
