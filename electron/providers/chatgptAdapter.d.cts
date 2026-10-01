type Auth = { accessToken: (root: string, id: string | undefined, signal: AbortSignal) => Promise<string> };
export function listModels(auth: Auth, root: string, profileId: string | undefined, signal: AbortSignal,
  fetchRequest?: typeof fetch): Promise<Array<{ id: string; name: string }>>;
export function chat(auth: Auth, root: string, request: { connection: { model: string; chatgptProfileId?: string }; prompt: string },
  signal: AbortSignal, onDelta?: (text: string) => void, fetchRequest?: typeof fetch): Promise<{ text: string; usage?: unknown }>;
