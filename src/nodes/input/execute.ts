import type { ExecuteContext } from '../types';

function isDirectActionsJson(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

export async function executeInputNode(_node: unknown, context: ExecuteContext) {
  if (context.sourceHandle === 'message-format') {
    return String(context.messageFormat ?? (context.phoneMessage ? 1 : 0));
  }
  if (context.sourceHandle === 'turn-mode') {
    return String(context.promptSlot);
  }
  if (context.sourceHandle === 'image') {
    return context.inputImages.length
      ? context.inputImages.map((image) => image.name).join('\n')
      : '';
  }
  if (context.sourceHandle === 'direct-actions') {
    if (context.directActionOnly) {
      return context.originalInput;
    }
    return isDirectActionsJson(context.originalInput)
      ? context.originalInput
      : '';
  }
  return context.originalInput;
}
