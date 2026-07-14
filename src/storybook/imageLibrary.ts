import type { ChatImageAttachment, MessageRecord } from '../types';
import { isRpPictureGalleryId } from '../chat/rpPictures';
import {
  nextStorybookCharacterImageId,
  storybookCharacterImageOwnerIdBase,
  type RpStorybookCharacterImage,
  type RpStorybookV1,
} from '../nodes/rp-storybook-v1/model';

export type StorybookImageLibraryEnsureResult = {
  storybook: RpStorybookV1;
  addedCount: number;
  updatedCount: number;
  imageIds: string[];
  images: RpStorybookCharacterImage[];
};

export type StorybookImageLibraryEnsureOptions = {
  receivedFrom?: string;
  imageAccess?: boolean;
};

export function storybookImageSourceById(
  storybooks: Iterable<RpStorybookV1>,
  imageId: string,
) {
  const normalizedImageId = imageId.trim();
  if (!normalizedImageId) {
    return undefined;
  }
  let fallback: { image: RpStorybookCharacterImage; ownerName: string } | undefined;
  for (const storybook of storybooks) {
    for (const character of storybook.characters) {
      const image = character.images.find((entry) => entry.id === normalizedImageId);
      if (image) {
        const source = { image, ownerName: character.name || character.id };
        if (!image.receivedFrom && !image.imageAccess) {
          return source;
        }
        fallback ??= source;
      }
    }
  }
  return fallback;
}

export function storybookImageById(storybooks: Iterable<RpStorybookV1>, imageId: string) {
  return storybookImageSourceById(storybooks, imageId)?.image;
}

export function storybookImageForAttachment(
  storybook: RpStorybookV1 | undefined,
  characterSourceId: string | undefined,
  attachment: ChatImageAttachment | undefined,
) {
  if (!storybook || !characterSourceId || !attachment) {
    return undefined;
  }
  return storybook.characters
    .find((character) => character.id === characterSourceId)
    ?.images.find(
      (image) => image.id === attachment.id && image.dataUrl === attachment.dataUrl,
    );
}

export function storybookImageDescriptions(storybooks: Iterable<RpStorybookV1>) {
  const descriptions = new Map<string, { description: string; external: boolean }>();
  for (const storybook of storybooks) {
    storybook.characters.forEach((character) => {
      character.images.forEach((image) => {
        const external = !!image.receivedFrom || image.imageAccess === true;
        const current = descriptions.get(image.id);
        if (!current || (current.external && !external)) {
          descriptions.set(image.id, { description: image.description, external });
        }
      });
    });
  }
  return new Map(
    [...descriptions].map(([imageId, entry]) => [imageId, entry.description]),
  );
}

export function withStorybookImageDescriptionUpdated(
  storybook: RpStorybookV1,
  imageId: string,
  dataUrl: string,
  description: string,
) {
  const normalizedImageId = imageId.trim();
  const normalizedDescription = description.trim();
  let updatedCount = 0;
  const characters = storybook.characters.map((character) => ({
    ...character,
    images: character.images.map((image) => {
      const sameImage =
        (!!dataUrl && image.dataUrl === dataUrl) ||
        (!!normalizedImageId && !dataUrl && image.id === normalizedImageId);
      if (
        !sameImage ||
        image.description === normalizedDescription
      ) {
        return image;
      }
      updatedCount += 1;
      return { ...image, description: normalizedDescription };
    }),
  }));
  return {
    storybook: updatedCount ? { ...storybook, characters } : storybook,
    updatedCount,
  };
}

export function withChangedStorybookImageDescriptionsSynchronized(
  currentStorybook: RpStorybookV1,
  nextStorybook: RpStorybookV1,
) {
  const currentImages = new Map(
    currentStorybook.characters.flatMap((character) =>
      character.images.map((image) => [`${character.id}\n${image.id}\n${image.dataUrl}`, image] as const),
    ),
  );
  let synchronizedStorybook = nextStorybook;
  nextStorybook.characters.forEach((character) => {
    character.images.forEach((image) => {
      const currentImage = currentImages.get(`${character.id}\n${image.id}\n${image.dataUrl}`);
      if (!currentImage || currentImage.description === image.description) {
        return;
      }
      synchronizedStorybook = withStorybookImageDescriptionUpdated(
        synchronizedStorybook,
        image.id,
        image.dataUrl,
        image.description,
      ).storybook;
    });
  });
  return synchronizedStorybook;
}

export function withStorybookExternalImagesPruned(
  storybook: RpStorybookV1,
  messages: readonly MessageRecord[],
) {
  const usedImageIds = new Set<string>();
  const usedDataUrls = new Set<string>();
  messages.forEach((message) => {
    message.imageAttachments?.forEach((image) => {
      const imageId = image.id.trim();
      if (imageId) {
        usedImageIds.add(imageId);
      }
      if (image.dataUrl) {
        usedDataUrls.add(image.dataUrl);
      }
    });
    message.phoneImageIds?.forEach((imageId) => {
      const normalizedImageId = imageId.trim();
      if (normalizedImageId) {
        usedImageIds.add(normalizedImageId);
      }
    });
    // Social photo posts keep their linked Gallery image alive.
    const socialImageId = message.socialPost?.imageId?.trim();
    if (socialImageId) {
      usedImageIds.add(socialImageId);
    }
  });

  let removedCount = 0;
  const characters = storybook.characters.map((character) => {
    const images = character.images.filter((image) => {
      const external = !!image.receivedFrom || image.imageAccess === true;
      if (
        !external ||
        usedImageIds.has(image.id) ||
        usedDataUrls.has(image.dataUrl)
      ) {
        return true;
      }
      removedCount += 1;
      return false;
    });
    if (images.length === character.images.length) {
      return character;
    }
    const profileImage = character.profileImage && images.some((image) => image.id === character.profileImage?.imageId)
      ? character.profileImage
      : undefined;
    return {
      ...character,
      images,
      ...(profileImage ? { profileImage } : { profileImage: undefined }),
    };
  });

  return {
    storybook: removedCount > 0 ? { ...storybook, characters } : storybook,
    removedCount,
  };
}

function isStorybookCompatibleImage(image: ChatImageAttachment) {
  return image.mimeType === 'image/jpeg' && image.dataUrl.startsWith('data:image/jpeg;base64,');
}

function storybookImageFromAttachment(
  image: ChatImageAttachment,
  id: string,
  name: string,
  description: string,
  options: StorybookImageLibraryEnsureOptions,
): RpStorybookCharacterImage {
  const receivedFrom = options.receivedFrom?.trim();
  const imageAccess = options.imageAccess === true;
  return {
    id,
    name: name || id,
    mimeType: 'image/jpeg',
    size: image.size || image.dataUrl.length,
    dataUrl: image.dataUrl,
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {}),
    description: description.trim(),
    ...(receivedFrom ? { receivedFrom } : {}),
    ...(imageAccess ? { imageAccess: true } : {}),
  };
}

function receivedImageIdentity(
  image: ChatImageAttachment,
  currentImages: RpStorybookCharacterImage[],
) {
  const preferredId = image.id.trim();
  if (!preferredId) {
    return undefined;
  }
  const conflictingImage = currentImages.find((entry) => entry.id === preferredId && entry.dataUrl !== image.dataUrl);
  if (conflictingImage) {
    return undefined;
  }
  return {
    id: preferredId,
    name: image.name.trim() || preferredId,
  };
}

export function withImagesEnsuredForStorybookCharacter(
  storybook: RpStorybookV1,
  characterSourceId: string,
  images: ChatImageAttachment[],
  description: string,
  options: StorybookImageLibraryEnsureOptions = {},
): StorybookImageLibraryEnsureResult {
  const characterIndex = storybook.characters.findIndex((character) => character.id === characterSourceId);
  if (characterIndex < 0 || images.length === 0) {
    return { storybook, addedCount: 0, updatedCount: 0, imageIds: [], images: [] };
  }

  const character = storybook.characters[characterIndex];
  const existingImageByDataUrl = new Map(character.images.map((image) => [image.dataUrl, image]));
  const usedImageIds = new Set(storybook.characters.flatMap((entry) => entry.images.map((image) => image.id)));
  const ownerBase = storybookCharacterImageOwnerIdBase(character.name, character.id);
  const nextImages = [...character.images];
  const allImages = storybook.characters.flatMap((entry) => entry.images);
  const trimmedDescription = description.trim();
  const receivedFrom = options.receivedFrom?.trim();
  const imageAccess = options.imageAccess === true;
  const imageIds: string[] = [];
  const ensuredImages: RpStorybookCharacterImage[] = [];
  let updatedCount = 0;

  images.forEach((image) => {
    if (!isStorybookCompatibleImage(image)) {
      return;
    }
    const existingImage = existingImageByDataUrl.get(image.dataUrl);
    if (existingImage) {
      const nextDescription = trimmedDescription && !existingImage.description.trim()
        ? trimmedDescription
        : existingImage.description;
      const receivedImageAccess = !!receivedFrom && existingImage.imageAccess === true;
      const nextReceivedFrom = existingImage.receivedFrom || receivedImageAccess
        ? receivedFrom || existingImage.receivedFrom
        : undefined;
      if (
        nextDescription !== existingImage.description ||
        nextReceivedFrom !== existingImage.receivedFrom ||
        receivedImageAccess
      ) {
        const { imageAccess: _imageAccess, ...existingWithoutImageAccess } = existingImage;
        const nextImage = {
          ...existingWithoutImageAccess,
          description: nextDescription,
          ...(nextReceivedFrom ? { receivedFrom: nextReceivedFrom } : {}),
          ...(!receivedImageAccess && existingImage.imageAccess ? { imageAccess: true as const } : {}),
        };
        const existingIndex = nextImages.findIndex((entry) => entry.id === existingImage.id);
        if (existingIndex >= 0) {
          nextImages[existingIndex] = nextImage;
        }
        existingImageByDataUrl.set(image.dataUrl, nextImage);
        ensuredImages.push(nextImage);
        updatedCount += 1;
      } else {
        ensuredImages.push(existingImage);
      }
      imageIds.push(existingImage.id);
      return;
    }

    const rpPictureIdentityAvailable = isRpPictureGalleryId(image.id) && !allImages.some(
      (entry) => entry.id === image.id.trim() && entry.dataUrl !== image.dataUrl,
    );
    const receivedIdentity = receivedFrom || imageAccess || rpPictureIdentityAvailable
      ? receivedImageIdentity(image, nextImages)
      : undefined;
    const id = receivedIdentity?.id ?? nextStorybookCharacterImageId(ownerBase, nextImages, usedImageIds);
    const name = receivedIdentity?.name ?? id;
    if (!receivedIdentity) {
      usedImageIds.add(id);
    }
    const nextImage = storybookImageFromAttachment(image, id, name, trimmedDescription, options);
    existingImageByDataUrl.set(image.dataUrl, nextImage);
    nextImages.push(nextImage);
    ensuredImages.push(nextImage);
    imageIds.push(id);
  });

  const addedCount = nextImages.length - character.images.length;
  if (addedCount === 0 && updatedCount === 0) {
    return { storybook, addedCount: 0, updatedCount: 0, imageIds, images: ensuredImages };
  }

  return {
    storybook: {
      ...storybook,
      characters: storybook.characters.map((entry, index) =>
        index === characterIndex ? { ...entry, images: nextImages } : entry
      ),
    },
    addedCount,
    updatedCount,
    imageIds,
    images: ensuredImages,
  };
}
