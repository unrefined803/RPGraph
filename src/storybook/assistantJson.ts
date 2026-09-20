/** Recover two known model formatting mistakes without changing valid JSON. */
export function parseStorybookAssistantJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    // Tokenize strings separately so prose and escaped quotes are never treated as syntax.
    const tokens = source.match(/"(?:\\.|[^"\\])*"|\s+|[^\s"]/gs) ?? [];
    const significant = tokens.map((token, index) => ({ token, index })).filter(({ token }) => !/^\s+$/.test(token));
    for (let i = 0; i < significant.length; i++) {
      const entry = significant[i];
      if (entry.token.startsWith('"')) {
        tokens[entry.index] = entry.token.replace(/\\(.)/gs, (escape, char: string) => char === '_' ? '_' : escape);
      }
    }
    for (let i = 0; i + 6 < significant.length; i++) {
      const sequence = significant.slice(i, i + 7);
      if (sequence[0].token !== '"path"' || sequence[1].token !== ':' ||
          !sequence[2].token.startsWith('"/') || sequence[3].token !== ',' ||
          sequence[4].token !== '"-"' || sequence[5].token !== ',' || sequence[6].token !== '"value"') continue;
      const path = JSON.parse(tokens[sequence[2].index]) as string;
      tokens[sequence[2].index] = JSON.stringify(`${path}/-`);
      tokens[sequence[3].index] = '';
      tokens[sequence[4].index] = '';
    }
    return JSON.parse(tokens.join(''));
  }
}
