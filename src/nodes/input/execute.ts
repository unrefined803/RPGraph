import type { ExecuteContext } from '../types';

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
    const trimmedInput = context.originalInput.trim();
    const jsonInput = trimmedInput.replace(/^```(?:json)?\s*/i, '');
    return jsonInput.startsWith('{') || jsonInput.startsWith('[')
      ? context.originalInput
      : '';
  }
  return context.originalInput;
}
