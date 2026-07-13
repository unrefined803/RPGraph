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
    // Direct Actions only carries data on explicit direct-only runs. Normal,
    // phone, social, autoplay, and auto-turn runs must never see input here,
    // even when the typed chat text happens to be valid action JSON.
    return context.directActionOnly ? context.originalInput : '';
  }
  return context.originalInput;
}
