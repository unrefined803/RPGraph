export type DatingMessage = {
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

/** A local fixture, separate from the conversation UI and future reply provider. */
export function createDatingDemoExchange(matchId: string, text: string, previous: DatingMessage[]): DatingMessage[] {
  if (!text.trim()) return [];
  const replies = matchId === 'demo-robin'
    ? ['Hey! Glad we matched 😊 What’s your favorite way to spend a free afternoon?', 'A little adventure sounds good to me 🌿', 'We should compare our favorite places sometime 🙂']
    : ['Hey! Nice to meet you 😊 What’s been the highlight of your day?', 'I’m always up for coffee and a good conversation ☕', 'Now I’m curious! Tell me a little more 🙂'];
  const index = previous.filter((message) => message.matchId === matchId && message.sender === 'match').length;
  const sentAt = new Date().toISOString();
  return [
    { id: crypto.randomUUID(), matchId, sender: 'owner', text: text.trim().slice(0, 4000), sentAt },
    { id: crypto.randomUUID(), matchId, sender: 'match', text: replies[index % replies.length], sentAt, demo: true },
  ];
}
