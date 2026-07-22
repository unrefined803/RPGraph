import type { ChatImageAttachment, MessageRecord, WorkflowNode } from '../types';
import { isRpPictureGalleryId } from '../chat/rpPictures';
import {
  nextStorybookCharacterImageId,
  parseRpStorybookJson,
  storybookCharacterImageOwnerIdBase,
  type RpStorybookCharacterImage,
  type RpStorybook,
} from '../nodes/rp-storybook/model';

export type StorybookImageLibraryEnsureResult = {
  storybook: RpStorybook;
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
  storybooks: Iterable<RpStorybook>,
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

export function storybookImageById(storybooks: Iterable<RpStorybook>, imageId: string) {
  return storybookImageSourceById(storybooks, imageId)?.image;
}

// Streaming previews resolve image ids on every output chunk; cache parsed
// storybooks per node so multi-megabyte image JSON is not reparsed each time.
const parsedStorybookCacheByNodeId = new Map<string, { json: string; storybook: RpStorybook }>();

export function storybookImageSourceByIdFromNodes(
  nodes: readonly WorkflowNode[],
  imageId: string | undefined,
) {
  const normalizedImageId = imageId?.trim();
  if (!normalizedImageId) {
    return undefined;
  }
  const storybooks: RpStorybook[] = [];
  for (const node of nodes) {
    if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook' || !node.data.storybookJson) {
      continue;
    }
    const cached = parsedStorybookCacheByNodeId.get(node.id);
    if (cached && cached.json === node.data.storybookJson) {
      storybooks.push(cached.storybook);
      continue;
    }
    try {
      const storybook = parseRpStorybookJson(node.data.storybookJson);
      parsedStorybookCacheByNodeId.set(node.id, { json: node.data.storybookJson, storybook });
      storybooks.push(storybook);
    } catch {
      parsedStorybookCacheByNodeId.delete(node.id);
      // Storybook validation reports invalid JSON through its normal UI path.
    }
  }
  return storybookImageSourceById(storybooks, normalizedImageId);
}

export function storybookImageForAttachment(
  storybook: RpStorybook | undefined,
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

export function storybookImageDescriptions(storybooks: Iterable<RpStorybook>) {
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
  storybook: RpStorybook,
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
  currentStorybook: RpStorybook,
  nextStorybook: RpStorybook,
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
  storybook: RpStorybook,
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
  allImages: RpStorybookCharacterImage[],
) {
  const preferredId = image.id.trim();
  if (!preferredId) {
    return undefined;
  }
  const conflictingImage = allImages.find(
    (entry) => entry.id === preferredId && entry.dataUrl !== image.dataUrl,
  );
  if (conflictingImage) {
    return undefined;
  }
  return {
    id: preferredId,
    name: image.name.trim() || preferredId,
  };
}

export function withImagesEnsuredForStorybookCharacter(
  storybook: RpStorybook,
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
    const imageDescription = trimmedDescription || image.description?.trim() || '';
    const existingImage = existingImageByDataUrl.get(image.dataUrl);
    if (existingImage) {
      const nextDescription = imageDescription && !existingImage.description.trim()
        ? imageDescription
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
      ? receivedImageIdentity(image, allImages)
      : undefined;
    const id = receivedIdentity?.id ?? nextStorybookCharacterImageId(ownerBase, nextImages, usedImageIds);
    const name = receivedIdentity?.name ?? id;
    usedImageIds.add(id);
    const nextImage = storybookImageFromAttachment(image, id, name, imageDescription, options);
    existingImageByDataUrl.set(image.dataUrl, nextImage);
    nextImages.push(nextImage);
    allImages.push(nextImage);
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
