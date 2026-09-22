export type AgencyTagId =
  | 'casual_chatter'
  | 'shy_user'
  | 'slow_to_trust'
  | 'friendly_regular'
  | 'hobby_friend'
  | 'respectful_admirer'
  | 'good_listener'
  | 'loyal_friend'
  | 'social_lurker'
  | 'quick_replier'
  | 'sporadic_texter'
  | 'friendship_seeker'
  | 'commitment_seeker'
  | 'casual_dater'
  | 'mixed_signals'
  | 'boundary_setter'
  | 'fan_engager'
  | 'collab_seeker'
  | 'passive_aggressive'
  | 'guilt_tripper'
  | 'genuine_user'
  | 'attention_seeker'
  | 'move_to_private'
  | 'freebie_hunter'
  | 'jealous_attachment'
  | 'upseller'
  | 'gift_fisher'
  | 'parasocial_fan'
  | 'clout_chaser'
  | 'screenshot_drama'
  | 'love_bomber'
  | 'breadcrumbing'
  | 'catfish'
  | 'boundary_tester'
  | 'promo_spammer'
  | 'exclusive_teaser'
  | 'rebound_seeker'
  | 'loyal_supporter'
  | 'status_flexer'
  | 'fake_emergency'
  | 'ghosting_pattern'
  | 'validation_fisher'
  | 'oversharer'
  | 'drama_magnet'
  | 'money_borrower'
  | 'possessive_friend'
  | 'emotional_supporter'
  | 'flirty_networker'
  | 'ex_obsessed'
  | 'rumor_spreader'
  | 'comment_troll'
  | 'rage_baiter'
  | 'contrarian_debater'
  | 'shitposter';
export type AgencyApp = 'whatsup' | 'fotogram' | 'onlyfriends' | 'matchme';
export type AgencyAccountRole = 'user' | 'creator';
export type AgencyAction = 'react' | 'dm_reply' | 'dm_initiate' | 'publish';
export type AgencyTagDefinition = {
  readonly id: AgencyTagId;
  readonly meaning: string;
  readonly apps: Readonly<Partial<Record<AgencyApp, Readonly<Partial<Record<AgencyAccountRole, readonly AgencyAction[]>>>>>>;
};
export const agencyTagCatalog: readonly AgencyTagDefinition[];
export function agencyTagSupports(id: string, app: AgencyApp, role?: AgencyAccountRole, action?: AgencyAction): boolean;
export function validateAccountAgency(app: string, account: { accountRole?: unknown; agencyTags?: unknown }): void;
export function validateCharacterAgency(character: { agencyTags?: unknown; apps?: unknown }): void;
