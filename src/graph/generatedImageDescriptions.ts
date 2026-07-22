import type { NodeLlmApi } from '../llm/NodeLlmApi';
import type { ChatImageAttachment } from '../types';

type GeneratedImageDescriptionOptions = {
  images: ChatImageAttachment[];
  generationPrompt: string;
  llm: Pick<NodeLlmApi, 'supportsVision' | 'complete'>;
  connectionId?: string;
  nodeId?: string;
  signal?: AbortSignal;
  warn: (message: string) => void;
};

export async function withGeneratedImageDescriptions({
  images,
  generationPrompt,
  llm,
  connectionId,
  nodeId,
  signal,
  warn,
}: GeneratedImageDescriptionOptions): Promise<ChatImageAttachment[]> {
  let visionEnabled: boolean;
  try {
    visionEnabled = await llm.supportsVision(
      connectionId,
      'Generated image captioning',
      signal,
    );
  } catch (error) {
    warn(
      `Generated images were stored without descriptions because vision support could not be checked: ${error instanceof Error ? error.message : String(error)}`,
    );
    return images;
  }
  if (!visionEnabled) {
    return images;
  }

  const describedImages: ChatImageAttachment[] = [];
  for (const [index, image] of images.entries()) {
    try {
      const caption = await llm.complete({
        connectionId,
        nodeId,
        label: `Action: Describe generated image ${index + 1}`,
        prompt: [
          'Inspect the attached generated image itself and write one factual 20 to 40 word description for a roleplay image library.',
          'Describe only content that is visibly present: people, appearance, clothing, pose, action, setting, mood, lighting, and framing.',
          'The generation request below is context for intended identities only. When it conflicts with the visible image, follow the visible image.',
          '',
          `Generation request: ${generationPrompt}`,
          '',
          'Return only the description as plain text, without a label, quotation marks, JSON, or Markdown.',
        ].join('\n'),
        images: [image],
        maxTokens: 160,
        temperature: 0.2,
        signal,
      });
      const description = caption.text.trim();
      describedImages.push(description ? { ...image, description } : image);
    } catch (error) {
      warn(
        `Generated image ${index + 1} could not be captioned and was stored without a description: ${error instanceof Error ? error.message : String(error)}`,
      );
      describedImages.push(image);
    }
  }
  return describedImages;
}
