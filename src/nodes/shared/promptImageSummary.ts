import type { PromptPreviewPass } from './promptRun';

/** Summarize prompt attachments, not the image wire or successful model processing. */
export function promptImageSummary(passes?: PromptPreviewPass[]) {
  if (!passes?.length) return undefined;
  const all = new Set<string>();
  const injected = new Set<string>();
  const sources = { input: new Set<string>(), reference: new Set<string>(), action: new Set<string>() };
  const steps = passes.map((pass, passIndex) => {
    const counts = { input: 0, reference: 0, action: 0 };
    for (const image of pass.images ?? []) {
      const key = image.id.trim() || `unnamed:${passIndex}:${image.index}`;
      all.add(key);
      if (image.source) {
        sources[image.source].add(key);
        counts[image.source] += 1;
        if (image.source !== 'input') injected.add(key);
      }
    }
    const count = pass.images?.length ?? 0;
    return `${pass.label}: ${count} image${count === 1 ? '' : 's'} (${counts.input} input, ${counts.reference} history, ${counts.action} action)`;
  });
  return {
    label: injected.size > 0
      ? `${injected.size} injected`
      : `${all.size} image${all.size === 1 ? '' : 's'} in prompts`,
    tooltip: [
      'The Image Input value describes the connected image wire only.',
      `Prompt attachments across this run: ${all.size} unique image${all.size === 1 ? '' : 's'}.`,
      `Input: ${sources.input.size}; history: ${sources.reference.size}; actions: ${sources.action.size}.`,
      'Injected images come from history or actions. Repeated images count once in the totals.',
      'Per request (including planning, replays, and image search):',
      ...steps,
    ].join('\n'),
  };
}
