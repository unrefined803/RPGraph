import { describe, expect, it } from 'vitest';
import { defaultCustomNodeDefinition, parseCustomNodeAssistantResult } from './model';

describe('parseCustomNodeAssistantResult', () => {
  it('inserts code patch replacements literally', () => {
    const fallback = { ...defaultCustomNodeDefinition(), code: 'const price = amount;\nreturn { outputs: {} };' };
    const replacement = "const price = '$' + amount + '$&' + `$$`;";
    const result = parseCustomNodeAssistantResult(JSON.stringify({
      reply: 'Done.',
      patch: { codePatches: [{ find: 'const price = amount;', replace: replacement }] },
    }), fallback);

    expect(result.definition?.code).toBe(`${replacement}\nreturn { outputs: {} };`);
  });
});
