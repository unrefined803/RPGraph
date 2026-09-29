import type { MatchMeAction } from '../types';

export function isMatchMeAction(value: unknown): value is MatchMeAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as MatchMeAction;
  return typeof action.from === 'string' && !!action.from.trim() &&
    typeof action.to === 'string' && !!action.to.trim() && action.from !== action.to &&
    (action.decision === 'like' || action.decision === 'superlike');
}

