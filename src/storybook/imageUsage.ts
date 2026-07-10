import type { RpStorybookV1 } from '../nodes/rp-storybook-v1/model';
import type { MessageRecord } from '../types';

export function storybookImageIdsUsedByMessages(messages: MessageRecord[]) {
  const imageIds = new Set<string>();
  messages.forEach((message) => {
    if (message.role !== 'user' && message.role !== 'output') {
      return;
    }
    message.imageAttachments?.forEach((image) => {
      if (image.id.trim()) {
        imageIds.add(image.id.trim());
      }
    });
    message.phoneImageIds?.forEach((imageId) => {
      if (imageId.trim()) {
        imageIds.add(imageId.trim());
      }
    });
    // Social photo posts link their image by Storybook/Gallery id.
    const socialImageId = message.socialPost?.imageId?.trim();
    if (socialImageId) {
      imageIds.add(socialImageId);
    }
  });
  return imageIds;
}

export function withStorybookImageDescriptions(
  messages: MessageRecord[],
  descriptionsById: ReadonlyMap<string, string>,
) {
  return messages.map((message) => {
    const imageIds = message.phoneImageIds?.map((imageId) => imageId.trim()).filter(Boolean) ?? [];
    if (imageIds.length !== 1 || !descriptionsById.has(imageIds[0]!)) {
      return message;
    }
    const description = descriptionsById.get(imageIds[0]!) || undefined;
    return message.phoneImageDescription === description
      ? message
      : { ...message, phoneImageDescription: description };
  });
}

export function usedStorybookImageIdsRemoved(
  currentStorybook: RpStorybookV1,
  nextStorybook: RpStorybookV1,
  usedImageIds: ReadonlySet<string>,
) {
  const imageIdCounts = (storybook: RpStorybookV1) => {
    const counts = new Map<string, number>();
    storybook.characters.forEach((character) => {
      character.images.forEach((image) => {
        counts.set(image.id, (counts.get(image.id) ?? 0) + 1);
      });
    });
    return counts;
  };
  const currentImageIdCounts = imageIdCounts(currentStorybook);
  const nextImageIdCounts = imageIdCounts(nextStorybook);
  return [...usedImageIds].filter(
    (imageId) =>
      (currentImageIdCounts.get(imageId) ?? 0) > (nextImageIdCounts.get(imageId) ?? 0),
  );
}
