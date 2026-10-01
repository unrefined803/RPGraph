import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const main = readFileSync(new URL('./main.cjs', import.meta.url), 'utf8');
const stats = runInNewContext(
  main.slice(main.indexOf('function firstFiniteNumber('), main.indexOf('function llmRequestId(')) +
  '\nllmStatsFromUsage',
);

it.each([2048, 0, undefined, null, -1, 0.5, '2048', Infinity])(
  'reads valid OpenRouter cached tokens without changing totals: %s', value => {
    const result = stats({
      prompt_tokens: 4096, completion_tokens: 100, total_tokens: 4196,
      prompt_tokens_details: { cached_tokens: value, cache_write_tokens: 1024 },
      completion_tokens_details: { reasoning_tokens: 20 },
    }, 50);
    expect(result).toMatchObject({
      inputTokens: 4096, outputTokens: 100, totalTokens: 4196, reasoningTokens: 20, durationMs: 50,
    });
    expect(result.cachedInputTokens).toBe(value === 2048 || value === 0 ? value : undefined);
  },
);

it('reads ChatGPT Responses usage without a provider-specific switch', () => {
  const usage = { input_tokens: 4096, input_tokens_details: { cached_tokens: 2048 } };
  expect(stats(usage, 1).cachedInputTokens).toBe(2048);
  expect(stats(undefined, 1).cachedInputTokens).toBeUndefined();
});

it.each([2048, 0, undefined, null, -1, 0.5, '2048', Infinity])(
  'reads Gemini cache usage without changing effective input or reasoning totals: %s', value => {
    const result = stats({
      promptTokenCount: 4096, candidatesTokenCount: 80, thoughtsTokenCount: 20,
      totalTokenCount: 4196, cachedContentTokenCount: value,
    }, 50);
    expect(result).toMatchObject({
      inputTokens: 4096, outputTokens: 100, totalTokens: 4196, reasoningTokens: 20,
    });
    expect(result.cachedInputTokens).toBe(value === 2048 || value === 0 ? value : undefined);
  },
);

it('reads DeepSeek-style cache hits and skips malformed counts for the next valid field', () => {
  expect(stats({ prompt_tokens: 4096, prompt_cache_hit_tokens: 1024, prompt_cache_miss_tokens: 3072 }, 1))
    .toMatchObject({ inputTokens: 4096, cachedInputTokens: 1024 });
  expect(stats({ prompt_tokens: 4096, prompt_cache_hit_tokens: 0 }, 1).cachedInputTokens).toBe(0);
  expect(stats({ prompt_tokens: 4096, prompt_tokens_details: { cached_tokens: null }, prompt_cache_hit_tokens: 1024 }, 1)
    .cachedInputTokens).toBe(1024);
  expect(stats({ prompt_tokens: 4096, prompt_tokens_details: { cached_tokens: 512 }, prompt_cache_hit_tokens: 1024 }, 1)
    .cachedInputTokens).toBe(512);
});
