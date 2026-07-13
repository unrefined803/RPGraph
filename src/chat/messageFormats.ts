export const normalRpMessageFormat = 0;
export const socialMediaMessageFormat = 2;
export const autoplayMessageFormat = 3;

export const localActivityPromptSlot = 0;
export const remoteActivityPromptSlot = 1;
export const storyFlowPromptSlot = 2;
export const escalationPromptSlot = 3;

// Autoplay prompts stage phone-app beats as a private [[plan]] followed by a
// [commands: ...] request; the plan is control text and must never reach the
// chat as story output.
export function stripAutoplayPlanBlocks(text: string) {
  return text
    .replace(/\[\[[\s\S]*?\]\]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
