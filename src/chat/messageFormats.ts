export const normalRpMessageFormat = 0;
export const socialMediaMessageFormat = 2;
export const autoplayMessageFormat = 3;

export const localActivityPromptSlot = 0;
export const remoteActivityPromptSlot = 1;
export const storyFlowPromptSlot = 2;
export const escalationPromptSlot = 3;

// Double-bracket [[plan]] blocks are private control text on every LLM prompt
// output (Autoplay stages phone-app beats with them, but any prompt may plan
// privately); they must never reach the chat as story output.
export function stripPlanBlocks(text: string) {
  return text
    .replace(/\[\[[\s\S]*?\]\]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripPlanBlocksFromStream(text: string) {
  const visible = stripPlanBlocks(text)
    .replace(/\[\[[\s\S]*$/, '')
    .trim();
  return visible === '[' ? '' : visible;
}

const autoplayMessengerKeyPattern = /"(?:whatsUpApp|fotogramApp|onlyFriendsApp)"\s*:/;

export function autoplayStreamPreviewText(text: string) {
  const visible = stripPlanBlocksFromStream(text);
  if (!visible) {
    return undefined;
  }
  const trimmed = visible.trimStart();
  const structuredOutput =
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('```');
  if (structuredOutput && !autoplayMessengerKeyPattern.test(visible)) {
    return undefined;
  }
  return visible;
}
