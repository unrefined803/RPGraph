export type DatingMessage = {
  accountLinks?: import('./accountLinks').AccountLink[];
  id: string;
  matchId: string;
  sender: 'owner' | 'match';
  text: string;
  sentAt: string;
  demo?: boolean;
};

export function normalizeDatingMessages(value: unknown): DatingMessage[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry: unknown): DatingMessage[] => {
    if (!entry || typeof entry !== 'object') return [];
    const message = entry as Partial<DatingMessage>;
    if (typeof message.id !== 'string' || !message.id || seen.has(message.id) ||
        typeof message.matchId !== 'string' || !message.matchId ||
        (message.sender !== 'owner' && message.sender !== 'match') ||
        typeof message.text !== 'string' || !message.text.trim() ||
        typeof message.sentAt !== 'string' || !Number.isFinite(Date.parse(message.sentAt))) return [];
    seen.add(message.id);
    return [{ id: message.id, matchId: message.matchId, sender: message.sender,
      text: message.text.slice(0, 4000), sentAt: message.sentAt, ...(message.demo ? { demo: true } : {}) }];
  });
}
