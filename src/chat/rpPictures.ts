import type { ChatImageAttachment, MessageRecord } from '../types';

const rpPictureReferencePattern = /^RP[ _]+Picture[ _]+(\d+)$/i;

function rpPictureNumber(value: string | undefined) {
  const match = value?.trim().match(rpPictureReferencePattern);
  if (!match) {
    return undefined;
  }
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function rpPictureGalleryId(value: string | undefined) {
  const number = rpPictureNumber(value);
  return number === undefined
    ? undefined
    : `RP_Picture_${String(number).padStart(2, '0')}`;
}

export function nextRpPictureName(messages: readonly MessageRecord[]) {
  const existingNumbers = messages
    .map((message) => rpPictureNumber(message.rpImageName))
    .filter((value): value is number => value !== undefined);
  const nextNumber = (existingNumbers.length ? Math.max(...existingNumbers) : 0) + 1;
  return `RP_Picture_${String(nextNumber).padStart(2, '0')}`;
}

export function isRpPictureGalleryId(value: string | undefined) {
  const normalizedValue = value?.trim();
  return !!normalizedValue && rpPictureGalleryId(normalizedValue) === normalizedValue;
}

export function rpPicturePhoneAttachment(
  messages: readonly MessageRecord[],
  imageReference: string | undefined,
): ChatImageAttachment | undefined {
  const normalizedReference = imageReference?.trim();
  if (!normalizedReference) {
    return undefined;
  }
  const referencedGalleryId = rpPictureGalleryId(normalizedReference);

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.channel === 'phone' || message.phoneMessage || !message.imageAttachments?.length) {
      continue;
    }
    for (const attachment of message.imageAttachments) {
      const pictureName = message.rpImageName?.trim() || attachment.name.trim();
      const galleryId = rpPictureGalleryId(pictureName);
      const matchesReference =
        attachment.id.trim() === normalizedReference ||
        pictureName === normalizedReference ||
        (!!galleryId && galleryId === referencedGalleryId);
      if (!matchesReference || !galleryId) {
        continue;
      }
      return {
        ...attachment,
        id: galleryId,
        name: galleryId,
        description:
          message.rpImageDescription?.trim() ||
          attachment.description?.trim() ||
          undefined,
      };
    }
  }
  return undefined;
}
