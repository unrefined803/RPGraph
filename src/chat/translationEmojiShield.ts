// Shield emoji from a (possibly weak) translation model.
//
// Weaker models such as Haiku sometimes emit an invalid/incomplete byte sequence
// for an emoji; the API then serialises those bytes as U+FFFD replacement
// characters, so the translated text shows "?"-boxes instead of the emoji. Emoji
// never need translating, so we replace each emoji grapheme with a plain-ASCII
// sentinel before translating and restore the original afterwards. A residual
// U+FFFD strip stays as a safety net for anything that still slips through.
//
// Kept ASCII-only on purpose (fromCharCode instead of literal invisible chars)
// so the source has no zero-width/variation-selector surprises.

const VS16 = String.fromCharCode(0xfe0f); // emoji variation selector-16
const ZWJ = String.fromCharCode(0x200d); // zero-width joiner (emoji sequences)
const REPLACEMENT = String.fromCharCode(0xfffd); // U+FFFD replacement character

// Emoji grapheme clusters: a pictographic base, optionally with a skin-tone
// modifier or VS16, any number of ZWJ-joined pictographs, or a flag (a pair of
// regional indicators). Matched whole so one placeholder == one emoji.
const EMOJI_RE = new RegExp(
  '\\p{Extended_Pictographic}(\\p{Emoji_Modifier}|' + VS16 + ')?' +
    '(' + ZWJ + '\\p{Extended_Pictographic}(\\p{Emoji_Modifier}|' + VS16 + ')?)*' +
    '|\\p{Regional_Indicator}{2}',
  'gu',
);

// Tolerant of casing and stray whitespace while retaining support for the
// shorter placeholder used by runs created before the stronger prompt rule.
const SENTINEL_RE = /\[\[\s*(?:RPGRAPH_EMOJI_)?E?(\d+)\s*\]\]/gi;

export function shieldTranslationEmoji(text: string): { shielded: string; tokens: string[] } {
  const tokens: string[] = [];
  const shielded = text.replace(EMOJI_RE, (match) => {
    const index = tokens.length;
    tokens.push(match);
    return `[[RPGRAPH_EMOJI_${index}]]`;
  });
  return { shielded, tokens };
}

export function restoreTranslationEmoji(text: string, tokens: string[]): string {
  const restored = text.replace(SENTINEL_RE, (_match, digits: string) => {
    const index = Number(digits);
    return index >= 0 && index < tokens.length ? tokens[index] : '';
  });
  // Never let a raw replacement character reach the UI/history, even if the model
  // still garbled something we did not shield.
  return restored.split(REPLACEMENT).join('');
}
